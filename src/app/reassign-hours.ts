// src/app/reassign-hours.ts — the pure planner for "reassigning a task moves its
// planned hours" (§774). No React, no i18n, no Date: `today` is passed in.
import { availableCapacityHours } from "./alloc-plan/alloc-plan";
import {
  absenceWorkdays,
  absencesForResource,
  generatePeriods,
  periodCapacityHours,
  periodKeyForDate,
  workdaysInRange,
  type Period,
} from "./resource-capacity";
import { isTaskClosed } from "./task-closed";
import { type Absence, type Resource, type ResourcePlan, type Task } from "./types";

export type NoMoveReason = "noEstimate" | "closed" | "unlinked" | "outsideWindow";
export interface OwnerChange { task: Task; fromResourceId: number | undefined; toResourceId: number | undefined }
export interface HoursMoveCtx { plan: ResourcePlan; absences: readonly Absence[]; workdayHours: number; holidaySet: ReadonlySet<string>; today: string }
export interface PeriodMove { periodKey: string; hours: number }
export interface TaskHoursMove {
  taskId: number; fromResourceId?: number; toResourceId?: number;
  perPeriod: PeriodMove[];          // moved, > 0 only
  movedHours: number; shortfallHours: number; receiverCapHours: number; outsideWindowHours: number;
  reason?: NoMoveReason;            // set when movedHours === 0 for one of the listed reasons
}
export interface OverCapacity { resourceId: number; periodKey: string; percent: number }
export interface ResourceUtilEdit { id: number; before: { utilization: Record<string, number> }; after: { utilization: Record<string, number> } }
export interface HoursMovePlan { moves: TaskHoursMove[]; nextResources: Resource[]; edits: ResourceUtilEdit[]; overCapacity: OverCapacity[] }

const MAX_PERCENT = 100;
const EPSILON = 1e-9;
/** A receiver within this many hours of capacity is not reported as over it. */
const OVER_CAPACITY_TOLERANCE_HOURS = 0.05;

const round1 = (n: number): number => Math.round(n * 10 + EPSILON) / 10;
const floor1 = (n: number): number => Math.floor(n * 10 + EPSILON) / 10;
const round2 = (n: number): number => Math.round(n * 100 + EPSILON) / 100;

function emptyMove(change: OwnerChange, reason?: NoMoveReason, outsideWindowHours = 0): TaskHoursMove {
  const move: TaskHoursMove = {
    taskId: change.task.id,
    perPeriod: [],
    movedHours: 0,
    shortfallHours: 0,
    receiverCapHours: 0,
    outsideWindowHours,
  };
  if (change.fromResourceId !== undefined) move.fromResourceId = change.fromResourceId;
  if (change.toResourceId !== undefined) move.toResourceId = change.toResourceId;
  if (reason) move.reason = reason;
  return move;
}

interface Share { period: Period; hours: number }
interface SpanSplit { shares: Share[]; outsideWindowHours: number }

/** Split `hours` across plan periods by workdays inside the span (Span/Split, R2).
 *  A task with no due date is treated like an overdue one: today's period. */
function splitAcrossPeriods(task: Task, hours: number, periods: readonly Period[], ctx: HoursMoveCtx): SpanSplit {
  const { today, holidaySet, plan } = ctx;
  const due = task.dueDate;
  const allIn = (date: string): SpanSplit => {
    const key = periodKeyForDate(date, plan.granularity);
    const p = periods.find((x) => x.key === key && x.start <= date && date <= x.end);
    return p ? { shares: [{ period: p, hours }], outsideWindowHours: 0 } : { shares: [], outsideWindowHours: hours };
  };
  if (!due || due < today) return allIn(today);
  const rawStart = task.startDate && task.startDate > today ? task.startDate : today;
  const spanStart = rawStart > due ? due : rawStart;
  const totalWorkdays = workdaysInRange(spanStart, due, holidaySet);
  if (totalWorkdays === 0) return allIn(due);
  const shares: Share[] = [];
  let insideWorkdays = 0;
  for (const p of periods) {
    const wd = workdaysInRange(p.start > spanStart ? p.start : spanStart, p.end < due ? p.end : due, holidaySet);
    if (wd > 0) {
      insideWorkdays += wd;
      shares.push({ period: p, hours: (hours * wd) / totalWorkdays });
    }
  }
  return { shares, outsideWindowHours: (hours * (totalWorkdays - insideWorkdays)) / totalWorkdays };
}

function absenceHoursFor(r: Resource, p: Period, abs: readonly Absence[], ctx: HoursMoveCtx): number {
  const override = r.absenceOverride?.[p.key];
  return override != null ? override : absenceWorkdays(abs, p.start, p.end, ctx.holidaySet) * ctx.workdayHours;
}

function withUtil(r: Resource, key: string, value: number): Resource {
  return { ...r, utilization: { ...r.utilization, [key]: value } };
}

/** New stored value for `r` so its shown hours change by `delta` (negative = giver). */
function shiftedStoredValue(r: Resource, p: Period, delta: number, abs: readonly Absence[], ctx: HoursMoveCtx): number {
  const util = r.utilization[p.key] ?? 0;
  if (r.utilizationMode === "percent") {
    const net = availableCapacityHours(r, p, abs, ctx.workdayHours, ctx.holidaySet);
    if (net <= 0) return util;
    return Math.min(MAX_PERCENT, Math.max(0, round2(util + round2((delta / net) * 100))));
  }
  if (delta < 0) return Math.max(0, round1(util + delta));
  return round1(Math.max(util, absenceHoursFor(r, p, abs, ctx)) + delta);
}

/** The most the receiver can take in one period without leaving the stored range. */
function receiverRoomHours(r: Resource, p: Period, abs: readonly Absence[], ctx: HoursMoveCtx): number {
  if (r.utilizationMode !== "percent") return Infinity;
  const net = availableCapacityHours(r, p, abs, ctx.workdayHours, ctx.holidaySet);
  const util = r.utilization[p.key] ?? 0;
  return floor1((Math.max(0, MAX_PERCENT - util) / 100) * net);
}

export function planHoursMoves(
  changes: readonly OwnerChange[],
  resources: readonly Resource[],
  ctx: HoursMoveCtx,
): HoursMovePlan {
  const periods = generatePeriods(ctx.plan.startDate, ctx.plan.endDate, ctx.plan.granularity);
  const working = new Map<number, Resource>(resources.map((r) => [r.id, r]));
  const touchedReceivers = new Map<number, Set<string>>();
  const touched = new Set<number>();
  const moves: TaskHoursMove[] = [];

  for (const change of changes) {
    const { task, fromResourceId, toResourceId } = change;
    if (fromResourceId !== undefined && fromResourceId === toResourceId) continue;
    if (isTaskClosed(task)) { moves.push(emptyMove(change, "closed")); continue; }
    const minutes = task.remainingEstimateMinutes;
    if (minutes === undefined || !(minutes > 0)) { moves.push(emptyMove(change, "noEstimate")); continue; }
    const giver = fromResourceId === undefined ? undefined : working.get(fromResourceId);
    const receiver = toResourceId === undefined ? undefined : working.get(toResourceId);
    if (!giver || !receiver) { moves.push(emptyMove(change, "unlinked")); continue; }

    const split = splitAcrossPeriods(task, minutes / 60, periods, ctx);
    if (split.shares.length === 0) {
      moves.push(emptyMove(change, "outsideWindow", round1(split.outsideWindowHours)));
      continue;
    }
    const giverAbs = absencesForResource(ctx.absences, giver);
    const receiverAbs = absencesForResource(ctx.absences, receiver);
    const perPeriod: PeriodMove[] = [];
    let shortfall = 0;
    let receiverCap = 0;
    let giverNext = giver;
    let receiverNext = receiver;
    for (const { period, hours } of split.shares) {
      const want = round1(hours);
      const giverShown = floor1(periodCapacityHours(giverNext, period, giverAbs, ctx.workdayHours, ctx.holidaySet));
      const taken = Math.min(want, giverShown);
      shortfall += want - taken;
      const moved = Math.max(0, Math.min(taken, receiverRoomHours(receiverNext, period, receiverAbs, ctx)));
      receiverCap += taken - moved;
      if (moved <= 0) continue;
      giverNext = withUtil(giverNext, period.key, shiftedStoredValue(giverNext, period, -moved, giverAbs, ctx));
      receiverNext = withUtil(receiverNext, period.key, shiftedStoredValue(receiverNext, period, moved, receiverAbs, ctx));
      perPeriod.push({ periodKey: period.key, hours: moved });
      const keys = touchedReceivers.get(receiver.id) ?? new Set<string>();
      keys.add(period.key);
      touchedReceivers.set(receiver.id, keys);
    }
    if (perPeriod.length > 0) {
      working.set(giver.id, giverNext);
      working.set(receiver.id, receiverNext);
      touched.add(giver.id);
      touched.add(receiver.id);
    }
    const movedHours = round1(perPeriod.reduce((s, m) => s + m.hours, 0));
    moves.push({
      ...emptyMove(change, undefined, round1(split.outsideWindowHours)),
      perPeriod,
      movedHours,
      shortfallHours: round1(shortfall),
      receiverCapHours: round1(receiverCap),
    });
  }

  const nextResources = resources.map((r) => working.get(r.id) ?? r);
  const edits: ResourceUtilEdit[] = resources
    .filter((r) => touched.has(r.id))
    .map((r) => ({
      id: r.id,
      before: { utilization: { ...r.utilization } },
      after: { utilization: { ...(working.get(r.id) ?? r).utilization } },
    }));

  const overCapacity: OverCapacity[] = [];
  for (const [id, keys] of touchedReceivers) {
    const r = working.get(id);
    if (!r) continue;
    const abs = absencesForResource(ctx.absences, r);
    for (const p of periods.filter((x) => keys.has(x.key))) {
      const shown = periodCapacityHours(r, p, abs, ctx.workdayHours, ctx.holidaySet);
      const available = availableCapacityHours(r, p, abs, ctx.workdayHours, ctx.holidaySet);
      if (available > 0 && shown > available + OVER_CAPACITY_TOLERANCE_HOURS) {
        overCapacity.push({ resourceId: id, periodKey: p.key, percent: Math.round((shown / available) * 100) });
      }
    }
  }
  return { moves, nextResources, edits, overCapacity };
}
