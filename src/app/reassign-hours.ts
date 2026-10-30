// src/app/reassign-hours.ts — the pure planner for "reassigning a task moves its
// planned hours" (§774). No React, no i18n, no Date: `today` is passed in.
import {
  absenceWorkdays,
  availableCapacityHours,
  absencesForResource,
  generatePeriods,
  periodCapacityHours,
  periodKeyForDate,
  workdaysInRange,
  type Period,
} from "./resource-capacity";
import { HOURS_MAP_MAX } from "./sanitize-entities";
import { isTaskClosed } from "./task-closed";
import { type Absence, type Resource, type ResourcePlan, type Task } from "./types";

export type NoMoveReason = "noEstimate" | "closed" | "unlinked" | "outsideWindow";
export interface OwnerChange {
  task: Task; fromResourceId: number | undefined; toResourceId: number | undefined;
  /** The old owner's free-text name (R14). Blank together with no `fromResourceId` means the task had NO
   *  owner, and gaining one is silent. Omitted, the old owner counts as present (an unlinked one gets a notice). */
  fromAssignee?: string;
}
export interface HoursMoveCtx { plan: ResourcePlan; absences: readonly Absence[]; workdayHours: number; holidaySet: ReadonlySet<string>; today: string }
export interface PeriodMove { periodKey: string; hours: number }
export interface TaskHoursMove {
  taskId: number; fromResourceId?: number; toResourceId?: number;
  perPeriod: PeriodMove[];          // moved, > 0 only
  movedHours: number; shortfallHours: number; receiverCapHours: number; outsideWindowHours: number;
  reason?: NoMoveReason;            // set when movedHours === 0 for one of the listed reasons
  /** Periods where the old owner's plan held less than the share. */
  shortfallPeriods: string[];
  /** Periods where the receiver had no room left, and which limit stopped it: 100 % for a percent-mode
   *  receiver, the stored maximum (`HOURS_MAP_MAX`) for an hours-mode one (the limit only when capped). */
  receiverCapPeriods: string[];
  receiverCapLimit?: "percent" | "hours";
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
/** Strips float noise (8.25 - 1 = 7.25, never 7.249999…) without rounding a real fraction away. */
const cleanFloat = (n: number): number => Math.round(n * 1e6) / 1e6;

function emptyMove(change: OwnerChange, reason?: NoMoveReason, outsideWindowHours = 0): TaskHoursMove {
  const move: TaskHoursMove = {
    taskId: change.task.id,
    perPeriod: [],
    movedHours: 0,
    shortfallHours: 0,
    receiverCapHours: 0,
    outsideWindowHours,
    shortfallPeriods: [],
    receiverCapPeriods: [],
  };
  if (change.fromResourceId !== undefined) move.fromResourceId = change.fromResourceId;
  if (change.toResourceId !== undefined) move.toResourceId = change.toResourceId;
  if (reason) move.reason = reason;
  return move;
}

interface Share { period: Period; hours: number }
interface SpanSplit { shares: Share[]; outsideWindowHours: number }

/** Round `raw` to tenths so they still sum to `total` (rounded to a tenth): largest remainder first. */
function toTenths(raw: readonly number[], total: number): number[] {
  const tenths = raw.map((x) => x * 10);
  const floors = tenths.map((x) => Math.floor(x + EPSILON));
  let rest = Math.round(total * 10 + EPSILON) - floors.reduce((a, b) => a + b, 0);
  const order = tenths.map((x, i) => ({ i, frac: x - floors[i] })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    floors[i] += 1;
    rest -= 1;
  }
  return floors.map((f) => f / 10);
}

/** Split `hours` across plan periods by workdays inside the span (Span/Split, R2).
 *  A task with no due date is treated like an overdue one: today's period. */
function splitAcrossPeriods(task: Task, hours: number, periods: readonly Period[], ctx: HoursMoveCtx): SpanSplit {
  const { today, holidaySet, plan } = ctx;
  const due = task.dueDate;
  const allIn = (date: string): SpanSplit => {
    const key = periodKeyForDate(date, plan.granularity);
    const p = periods.find((x) => x.key === key && x.start <= date && date <= x.end);
    return p ? { shares: [{ period: p, hours: round1(hours) }], outsideWindowHours: 0 } : { shares: [], outsideWindowHours: round1(hours) };
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
  const outsideRaw = (hours * (totalWorkdays - insideWorkdays)) / totalWorkdays;
  const rounded = toTenths([...shares.map((x) => x.hours), outsideRaw], hours);
  return {
    shares: shares.map((x, i) => ({ period: x.period, hours: rounded[i] })).filter((x) => x.hours > 0),
    outsideWindowHours: rounded[rounded.length - 1],
  };
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
    // Shown hours match the moved hours to about 0.01 h: stored percent rounds (once) to 0.01.
    return Math.min(MAX_PERCENT, Math.max(0, round2(util + (delta / net) * 100)));
  }
  // Hours are NOT rounded to a tenth: the delta already is one, and rounding the result would rewrite a stored value
  // the user typed (8.25 → 7.3) and create hours. Only float noise is stripped.
  if (delta < 0) return Math.max(0, cleanFloat(util + delta));
  return cleanFloat(Math.max(util, absenceHoursFor(r, p, abs, ctx)) + delta);
}

/** The most the receiver can take in one period without leaving the stored range. */
function receiverRoomHours(r: Resource, p: Period, abs: readonly Absence[], ctx: HoursMoveCtx): number {
  if (r.utilizationMode !== "percent") {
    // `sanitizeResource` clamps hours to HOURS_MAP_MAX on load; more would vanish on the next reload.
    const util = r.utilization[p.key] ?? 0;
    return floor1(Math.max(0, HOURS_MAP_MAX - Math.max(util, absenceHoursFor(r, p, abs, ctx))));
  }
  const net = availableCapacityHours(r, p, abs, ctx.workdayHours, ctx.holidaySet);
  const util = r.utilization[p.key] ?? 0;
  return floor1((Math.max(0, MAX_PERCENT - util) / 100) * net);
}

/** Per resource, per period: the SHOWN hours the plan moves (negative for a giver). Built from the moves, so it
 *  is exact, not re-derived from rounded stored values. With `present`, a move whose giver or receiver is not in it
 *  (deleted in the same tick) is left out whole, so the other moves in that period still go through. */
export type ShownDeltas = ReadonlyMap<number, ReadonlyMap<string, number>>;

export function plannedShownDeltas(plan: HoursMovePlan, present?: ReadonlySet<number>): ShownDeltas {
  const out = new Map<number, Map<string, number>>();
  const add = (id: number, key: string, h: number) => {
    const keys = out.get(id) ?? new Map<string, number>();
    keys.set(key, (keys.get(key) ?? 0) + h);
    out.set(id, keys);
  };
  for (const m of plan.moves) {
    if (m.fromResourceId === undefined || m.toResourceId === undefined) continue;
    if (present && !(present.has(m.fromResourceId) && present.has(m.toResourceId))) continue;
    for (const p of m.perPeriod) {
      add(m.fromResourceId, p.periodKey, -p.hours);
      add(m.toResourceId, p.periodKey, p.hours);
    }
  }
  return out;
}

/** Per (resource, period): the shown hours to apply. Unscaled moves are the plan's own tenths. In a scaled period
 *  every share is FLOORED to a tenth on both sides (no giver is ever asked for more than it shows, even when it shows
 *  a non-tenth amount), the moved total is the smaller side's sum, and each side splits it within its caps. */
function scaledShares(rows: readonly Resource[], deltas: ShownDeltas, scale: ReadonlyMap<string, number>): (id: number, key: string) => number {
  const out = new Map<string, number>();
  const at = (id: number, key: string) => `${id}|${key}`;
  const byKey = new Map<string, { id: number; d: number }[]>();
  for (const r of rows) {
    for (const [key, d] of deltas.get(r.id) ?? []) byKey.set(key, [...(byKey.get(key) ?? []), { id: r.id, d }]);
  }
  for (const [key, entries] of byKey) {
    const f = scale.get(key) ?? 1;
    if (f >= 1) {
      for (const { id, d } of entries) out.set(at(id, key), d);
      continue;
    }
    const receivers = entries.filter((e) => e.d > 0);
    const givers = entries.filter((e) => e.d < 0);
    const tenthsCap = (d: number) => Math.floor(Math.abs(d) * f * 10 + EPSILON);
    const recCaps = receivers.map((e) => tenthsCap(e.d));
    const giverCaps = givers.map((e) => tenthsCap(e.d));
    const total = Math.min(recCaps.reduce((a, b) => a + b, 0), giverCaps.reduce((a, b) => a + b, 0));
    // Each side splits `total` in proportion to its caps by largest remainder. No share exceeds its cap: a share's raw
    // value is cap × total / sum ≤ cap (total ≤ sum), and only a share with a fractional raw value — so below its cap —
    // gets the extra tenth.
    const split = (caps: number[]) => {
      const sum = caps.reduce((x, y) => x + y, 0);
      return sum === 0 ? caps.map(() => 0) : toTenths(caps.map((cap) => (cap / sum) * total / 10), total / 10);
    };
    split(recCaps).forEach((h, i) => out.set(at(receivers[i].id, key), h));
    split(giverCaps).forEach((h, i) => out.set(at(givers[i].id, key), -h));
  }
  return (id, key) => out.get(at(id, key)) ?? 0;
}

/**
 * Apply planned shown-hour moves to `rows` as they are NOW — for a live state that moved under the plan in the same
 * tick (the hook writes the plan's own `after` values when nothing moved, so undo, redo and the forward write agree).
 * ★ Conservation: per period, every move is scaled by the smallest fraction that still fits — a giver can give at most
 * the hours it shows now, a receiver can take at most its room now (100 % or HOURS_MAP_MAX). Every scaled share is
 * FLOORED to a tenth on both sides and both sides move the same total (`scaledShares`), so rounding never creates an
 * hour. Each person's stored value is then converted from SHOWN hours with the planner's own rule
 * (`shiftedStoredValue`), absences included; a percent value rounds to 0.01 %, so the two sides agree to about
 * 0.01 h. The fraction is one per period across the whole plan, so in a batch one constrained pair scales the others
 * in that period too (total still conserved); the notice keeps the plan's numbers.
 */
export function applyShownDeltas(rows: readonly Resource[], deltas: ShownDeltas, ctx: HoursMoveCtx): Resource[] {
  const periods = new Map(generatePeriods(ctx.plan.startDate, ctx.plan.endDate, ctx.plan.granularity).map((p) => [p.key, p]));
  const scale = new Map<string, number>();
  // Safety net: a delta for a person not in `rows` stops its periods, so nobody gains from a missing giver. The hook
  // never reaches it: it drops a deleted person's moves first (`plannedShownDeltas(plan, present)`).
  const present = new Set(rows.map((r) => r.id));
  for (const [id, keys] of deltas) if (!present.has(id)) for (const key of keys.keys()) scale.set(key, 0);
  for (const r of rows) {
    const abs = absencesForResource(ctx.absences, r);
    for (const [key, d] of deltas.get(r.id) ?? []) {
      const p = periods.get(key);
      if (!p || d === 0) continue;
      const fit = d < 0
        ? Math.max(d, -periodCapacityHours(r, p, abs, ctx.workdayHours, ctx.holidaySet))
        : Math.min(d, receiverRoomHours(r, p, abs, ctx));
      scale.set(key, Math.min(scale.get(key) ?? 1, Math.max(0, fit / d)));
    }
  }
  const hoursFor = scaledShares(rows, deltas, scale);
  return rows.map((r) => {
    const keys = deltas.get(r.id);
    if (!keys) return r;
    const abs = absencesForResource(ctx.absences, r);
    let next = r;
    for (const [key] of keys) {
      const p = periods.get(key);
      const h = hoursFor(r.id, key);
      if (!p || h === 0) continue;
      next = withUtil(next, key, shiftedStoredValue(next, p, h, abs, ctx));
    }
    return next;
  });
}

/** The remaining estimate of `task` split by workdays across the plan's periods, in tenths of an hour
 *  (the same figures `planHoursMoves` starts from, before the giver's and receiver's caps). Empty for no
 *  estimate or when the whole span lies outside the plan window. */
export function splitTaskHoursByPeriod(task: Task, ctx: HoursMoveCtx): { periodKey: string; hours: number }[] {
  const minutes = task.remainingEstimateMinutes;
  if (minutes === undefined || !(minutes > 0)) return [];
  const periods = generatePeriods(ctx.plan.startDate, ctx.plan.endDate, ctx.plan.granularity);
  return splitAcrossPeriods(task, minutes / 60, periods, ctx).shares.map((x) => ({ periodKey: x.period.key, hours: round1(x.hours) }));
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
    if (fromResourceId === toResourceId) continue; // owner unchanged (or both unset): nothing to move
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
    const shortfallPeriods: string[] = [];
    const receiverCapPeriods: string[] = [];
    let giverNext = giver;
    let receiverNext = receiver;
    for (const { period, hours } of split.shares) {
      const want = round1(hours);
      const giverShown = floor1(periodCapacityHours(giverNext, period, giverAbs, ctx.workdayHours, ctx.holidaySet));
      const taken = Math.min(want, giverShown);
      shortfall += want - taken;
      if (want - taken > EPSILON) shortfallPeriods.push(period.key);
      const moved = Math.max(0, Math.min(taken, receiverRoomHours(receiverNext, period, receiverAbs, ctx)));
      receiverCap += taken - moved;
      if (taken - moved > EPSILON) receiverCapPeriods.push(period.key);
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
      shortfallPeriods,
      receiverCapPeriods,
      ...(receiverCapPeriods.length > 0
        ? { receiverCapLimit: receiver.utilizationMode === "percent" ? ("percent" as const) : ("hours" as const) }
        : {}),
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
