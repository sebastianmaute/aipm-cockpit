// src/app/alloc-plan/alloc-ground-moves.ts
//
// Grounds ONE model alternative against the live workspace (§769). The model's task moves are UNTRUSTED:
// every task id and target is re-checked, each kept move is planned on its own with §774's planner (so
// ticking moves independently is exact), and any hour edit a linked move already covers is dropped.
// Pure and deterministic; no React, no i18n.
import { type Resource, type Task } from "../types";
import { isTaskClosed } from "../task-closed";
import { resourceDisplayName } from "../resource-foundation";
import { planHoursMoves, type HoursMovePlan, type OwnerChange } from "../reassign-hours";
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
  /** Stored utilization of the giver and receiver for every period key the plan edits. */
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
  /** The task's live owner is a listed resource. */
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

function snapshotOf(task: Task, plan: HoursMovePlan): MoveSnapshot {
  const utilization: Record<number, Record<string, number>> = {};
  for (const edit of plan.edits) {
    const stored: Record<string, number> = {};
    for (const k of changedKeys(edit)) stored[k] = edit.before.utilization[k] ?? 0;
    utilization[edit.id] = stored;
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
  const kept = new Set<number>();

  for (const { taskId, toResourceId } of raw.taskMoves) {
    const skip = (reason: MoveSkipReason): void => { skippedMoves.push({ taskId, toResourceId, reason }); };
    const task = taskById.get(taskId);
    const receiver = resourceById.get(toResourceId);
    if (!task) { skip("unknown-task"); continue; }
    if (isTaskClosed(task)) { skip("closed"); continue; }
    if (task.jiraKey) { skip("jira"); continue; }
    if (!receiver) { skip("unknown-resource"); continue; }
    const giver = task.resourceId === undefined ? undefined : resourceById.get(task.resourceId);
    if (giver && task.resourceId === toResourceId) { skip("same-owner"); continue; }
    if (kept.has(taskId)) { skip("duplicate"); continue; }
    kept.add(taskId);

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
      snapshot: snapshotOf(task, plan),
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
