// src/app/alloc-plan/alloc-ground-moves.ts
//
// Grounds ONE model alternative against the live workspace (§769). The model's task moves are UNTRUSTED:
// every task id and target is re-checked, each kept move is planned on its own with §774's planner, and any
// hour edit a linked move planned alone already covers is dropped. Moves can chain (A→B, then B→C), so what the
// TICKED moves do together is planned again by `planTickedMoves`, for the preview and at apply.
// Pure and deterministic; no React, no i18n.
import { type Resource, type Task } from "../types";
import { isTaskClosed } from "../task-closed";
import { resourceDisplayName } from "../resource-foundation";
import { absencesForResource, generatePeriods } from "../resource-capacity";
import { planHoursMoves, splitTaskHoursByPeriod, type HoursMovePlan, type OwnerChange } from "../reassign-hours";
import { type RawAllocAlternative } from "./alloc-alternatives";
import {
  cellKey,
  groundAllocationCells,
  type AllocGroundContext,
  type GroundedAllocCell,
  type SkippedCell,
} from "./alloc-plan";

export type MoveSkipReason = "unknown-task" | "closed" | "jira" | "same-owner" | "unknown-resource" | "duplicate";

export interface SkippedMove {
  taskId: number;
  toResourceId: number;
  reason: MoveSkipReason;
}

/** What the task and the touched resources looked like when grounded; the review window checks it before applying. */
export interface MoveSnapshot {
  owner: Pick<Task, "assignee" | "assigneeEmail" | "resourceId">;
  remainingEstimateMinutes?: number;
  startDate?: string;
  dueDate: string;
  status: Task["status"];
  /** Stored utilization (missing key = 0) of the receiver and, when linked, the giver, over every period the task
   *  splits into plus the plan's shortfall and receiver-cap periods: a period that moved nothing is still watched. */
  utilization: Record<number, Record<string, number>>;
  /** `capacityFingerprint` of the same people and periods: what else decides the hours they show there. */
  capacity: string;
}

export interface GroundedMove {
  key: string;
  taskId: number;
  taskName: string;
  fromResourceId?: number;
  fromLabel: string;
  toResourceId: number;
  toLabel: string;
  /** The task's live owner is a listed resource. ★ When false, a UI must NOT render `plan.moves[].reason`
   *  (noEstimate / unlinked): §774 never shows a reason for an unlinked owner, so it would be a new message. */
  linked: boolean;
  plan: HoursMovePlan;
  snapshot: MoveSnapshot;
}

export interface GroundedAlternative {
  summary: string;
  rationale?: string;
  moves: GroundedMove[];
  skippedMoves: SkippedMove[];
  cells: GroundedAllocCell[];
  skipped: SkippedCell[];
  truncated: boolean;
}

export interface MoveGroundContext extends AllocGroundContext {
  tasks: readonly Task[];
  today: string;
}

export function moveKey(m: { taskId: number }): string {
  return `move:${m.taskId}`;
}

/** Period keys whose stored value the plan changes: an edit carries the whole map, so unchanged keys are dropped. */
function changedKeys(edit: HoursMovePlan["edits"][number]): string[] {
  const keys = new Set([...Object.keys(edit.before.utilization), ...Object.keys(edit.after.utilization)]);
  return [...keys].filter((k) => (edit.before.utilization[k] ?? 0) !== (edit.after.utilization[k] ?? 0));
}

function snapshotOf(task: Task, plan: HoursMovePlan, ownerIds: readonly number[], ctx: MoveGroundContext): MoveSnapshot {
  const keys = new Set(splitTaskHoursByPeriod(task, ctx).map((x) => x.periodKey));
  for (const move of plan.moves) {
    for (const k of [...move.shortfallPeriods, ...move.receiverCapPeriods, ...move.perPeriod.map((p) => p.periodKey)]) keys.add(k);
  }
  const utilization: Record<number, Record<string, number>> = {};
  for (const id of ownerIds) {
    const stored = ctx.resources.find((r) => r.id === id)?.utilization ?? {};
    utilization[id] = Object.fromEntries([...keys].map((k) => [k, stored[k] ?? 0]));
  }
  return {
    capacity: capacityFingerprint(ownerIds, [...keys], ctx),
    owner: { assignee: task.assignee, assigneeEmail: task.assigneeEmail, resourceId: task.resourceId },
    remainingEstimateMinutes: task.remainingEstimateMinutes,
    startDate: task.startDate,
    dueDate: task.dueDate,
    status: task.status,
    utilization,
  };
}

/** What decides the hours `ownerIds` show in `periodKeys` besides the stored value: each person's unit, their
 *  absence override per period, and the Absence records that apply to them (by link, else by name, as
 *  `absencesForResource` decides) and overlap those periods. A missing person fingerprints as null. */
export function capacityFingerprint(
  ownerIds: readonly number[],
  periodKeys: readonly string[],
  ctx: Pick<MoveGroundContext, "resources" | "absences" | "plan">,
): string {
  const keys = [...new Set(periodKeys)].sort();
  const wanted = new Set(keys);
  const periods = generatePeriods(ctx.plan.startDate, ctx.plan.endDate, ctx.plan.granularity).filter((p) => wanted.has(p.key));
  const people = [...new Set(ownerIds)].sort((a, b) => a - b).map((id) => {
    const r = ctx.resources.find((x) => x.id === id);
    if (!r) return [id, null];
    const absences = absencesForResource(ctx.absences, r)
      .filter((a) => periods.some((p) => a.startDate <= p.end && a.endDate >= p.start))
      .map((a) => `${a.id}:${a.type}:${a.startDate}:${a.endDate}`)
      .sort();
    return [id, r.utilizationMode, keys.map((k) => r.absenceOverride?.[k] ?? null), absences];
  });
  return JSON.stringify(people);
}

/** §769 "Apply" 1 — a move is stale when its task's owner, remaining estimate, dates or status changed since it was
 *  grounded, or anything that decides the planned hours of its giver and receiver in the periods it touches did: the
 *  stored value (missing = 0), the unit, an absence override, or an Absence record (`capacityFingerprint`). */
export function isMoveStale(move: GroundedMove, live: MoveGroundContext): boolean {
  const task = live.tasks.find((t) => t.id === move.taskId);
  if (!task) return true;
  const snap = move.snapshot;
  if (task.assignee !== snap.owner.assignee || task.assigneeEmail !== snap.owner.assigneeEmail || task.resourceId !== snap.owner.resourceId) return true;
  if (task.remainingEstimateMinutes !== snap.remainingEstimateMinutes || task.startDate !== snap.startDate) return true;
  if (task.dueDate !== snap.dueDate || task.status !== snap.status) return true;
  const ownerIds = Object.keys(snap.utilization).map(Number);
  const changedValue = Object.entries(snap.utilization).some(([id, watched]) => {
    const person = live.resources.find((r) => r.id === Number(id));
    return !person || Object.entries(watched).some(([key, value]) => (person.utilization[key] ?? 0) !== value);
  });
  if (changedValue) return true;
  const periodKeys = Object.keys(snap.utilization[ownerIds[0]] ?? {});
  return capacityFingerprint(ownerIds, periodKeys, live) !== snap.capacity;
}

/** The owner change the apply path (§774) plans for `task` handed to `receiver`; shared with the effect so both plan the same input. */
export function ownerChangeFor(task: Task, receiver: Resource): OwnerChange {
  return {
    task: { ...task, assignee: resourceDisplayName(receiver), assigneeEmail: receiver.email ?? "", resourceId: receiver.id },
    fromResourceId: task.resourceId,
    toResourceId: receiver.id,
    fromAssignee: task.assignee,
  };
}

function groundMoves(raw: RawAllocAlternative, ctx: MoveGroundContext): { moves: GroundedMove[]; skippedMoves: SkippedMove[] } {
  const taskById = new Map(ctx.tasks.map((t) => [t.id, t]));
  const resourceById = new Map<number, Resource>(ctx.resources.map((r) => [r.id, r]));
  const moves: GroundedMove[] = [];
  const skippedMoves: SkippedMove[] = [];
  const seen = new Set<number>();

  for (const { taskId, toResourceId } of raw.taskMoves) {
    const skip = (reason: MoveSkipReason): void => { skippedMoves.push({ taskId, toResourceId, reason }); };
    const task = taskById.get(taskId);
    const receiver = resourceById.get(toResourceId);
    if (!task) { skip("unknown-task"); continue; }
    // The first mention of a task wins, even when it is itself skipped below.
    if (seen.has(taskId)) { skip("duplicate"); continue; }
    seen.add(taskId);
    if (isTaskClosed(task)) { skip("closed"); continue; }
    if (task.jiraKey) { skip("jira"); continue; }
    if (!receiver) { skip("unknown-resource"); continue; }
    const giver = task.resourceId === undefined ? undefined : resourceById.get(task.resourceId);
    if (giver && task.resourceId === toResourceId) { skip("same-owner"); continue; }

    const toLabel = resourceDisplayName(receiver);
    const plan = planHoursMoves([ownerChangeFor(task, receiver)], ctx.resources, ctx);
    moves.push({
      key: moveKey({ taskId }),
      taskId,
      taskName: task.taskName,
      fromResourceId: giver ? task.resourceId : undefined,
      fromLabel: giver ? resourceDisplayName(giver) : task.assignee,
      toResourceId,
      toLabel,
      linked: giver !== undefined,
      plan,
      snapshot: snapshotOf(task, plan, giver ? [giver.id, toResourceId] : [toResourceId], ctx),
    });
  }
  return { moves, skippedMoves };
}

/** The keys (`cellKey`) of every stored cell a plan changes. */
function changedCellKeys(plan: HoursMovePlan): Set<string> {
  const keys = new Set<string>();
  for (const edit of plan.edits) {
    for (const periodKey of changedKeys(edit)) keys.add(cellKey({ resourceId: edit.id, periodKey }));
  }
  return keys;
}

export interface TickedMovesPlan {
  /** The ticked linked moves planned TOGETHER, in the alternative's order, exactly as §774 plans them on apply: a
   *  giver shared by two moves is taken once, and a receiver can pass on what an earlier move gave them. */
  plan: HoursMovePlan;
  /** Cell keys whose stored value that plan changes. A ticked hour edit on one of them must not be written: it
   *  would overwrite the moved hours with an absolute value planned without them. */
  changedCells: ReadonlySet<string>;
}

/** Plans the ticked linked moves together against `ctx` (the propose-time state for the preview, the live state on
 *  apply). Unticked and unlinked moves take no part: an unlinked one moves no hours. */
export function planTickedMoves(moves: readonly GroundedMove[], selected: ReadonlySet<string>, ctx: MoveGroundContext): TickedMovesPlan {
  const taskById = new Map(ctx.tasks.map((t) => [t.id, t]));
  const resourceById = new Map(ctx.resources.map((r) => [r.id, r]));
  const changes = moves.flatMap((m) => {
    const task = taskById.get(m.taskId);
    const receiver = resourceById.get(m.toResourceId);
    return selected.has(m.key) && m.linked && task && receiver ? [ownerChangeFor(task, receiver)] : [];
  });
  const plan = planHoursMoves(changes, ctx.resources, ctx);
  return { plan, changedCells: changedCellKeys(plan) };
}

/** Grounds one alternative: its moves first, then its hour edits, minus the edits a move planned alone covers. */
export function groundAlternative(raw: RawAllocAlternative, ctx: MoveGroundContext): GroundedAlternative {
  const { moves, skippedMoves } = groundMoves(raw, ctx);
  const grounded = groundAllocationCells(raw.cells, ctx);

  const covered = new Set(moves.flatMap((move) => [...changedCellKeys(move.plan)]));
  const cells: GroundedAllocCell[] = [];
  const skipped: SkippedCell[] = [...grounded.skipped];
  for (const cell of grounded.cells) {
    if (covered.has(cellKey(cell))) skipped.push({ resourceId: cell.resourceId, periodKey: cell.periodKey, reason: "covered-by-move" });
    else cells.push(cell);
  }
  return { summary: raw.summary, rationale: raw.rationale, moves, skippedMoves, cells, skipped, truncated: grounded.truncated };
}
