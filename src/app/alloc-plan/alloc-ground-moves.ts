// src/app/alloc-plan/alloc-ground-moves.ts
//
// Grounds ONE model alternative against the live workspace (§769). The model's task moves are UNTRUSTED:
// every task id and target is re-checked, each kept move is planned on its own with §774's planner (so
// ticking moves independently is exact), and any hour edit a linked move already covers is dropped.
// Pure and deterministic; no React, no i18n.
import { type Resource, type Task } from "../types";
import { isTaskClosed } from "../task-closed";
import { resourceDisplayName } from "../resource-foundation";
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
    owner: { assignee: task.assignee, assigneeEmail: task.assigneeEmail, resourceId: task.resourceId },
    remainingEstimateMinutes: task.remainingEstimateMinutes,
    startDate: task.startDate,
    dueDate: task.dueDate,
    status: task.status,
    utilization,
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
    const after = { assignee: toLabel, assigneeEmail: receiver.email ?? "", resourceId: toResourceId };
    const change: OwnerChange = {
      task: { ...task, ...after },
      fromResourceId: task.resourceId,
      toResourceId,
      fromAssignee: task.assignee,
    };
    const plan = planHoursMoves([change], ctx.resources, ctx);
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

/** Grounds one alternative: its moves first, then its hour edits, minus the edits a move already covers. */
export function groundAlternative(raw: RawAllocAlternative, ctx: MoveGroundContext): GroundedAlternative {
  const { moves, skippedMoves } = groundMoves(raw, ctx);
  const grounded = groundAllocationCells(raw.cells, ctx);

  const covered = new Set<string>();
  for (const move of moves) {
    for (const edit of move.plan.edits) {
      for (const periodKey of changedKeys(edit)) covered.add(cellKey({ resourceId: edit.id, periodKey }));
    }
  }
  const cells: GroundedAllocCell[] = [];
  const skipped: SkippedCell[] = [...grounded.skipped];
  for (const cell of grounded.cells) {
    if (covered.has(cellKey(cell))) skipped.push({ resourceId: cell.resourceId, periodKey: cell.periodKey, reason: "covered-by-move" });
    else cells.push(cell);
  }
  return { summary: raw.summary, rationale: raw.rationale, moves, skippedMoves, cells, skipped, truncated: grounded.truncated };
}
