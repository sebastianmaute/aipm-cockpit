import { isTaskFinished } from "./task-status";
import type { BudgetBucket, TaskStatus } from "./types";

/**
 * Minimal task shape this engine needs: enough to match a link and judge
 * completion. Deliberately structural (a bare `string` status, not the
 * `TaskStatus` union) rather than `Pick<Task, "id" | "status">` — callers
 * building this shape ad hoc (as tests do) shouldn't need every status
 * literal to line up with `TaskStatus`; `isTaskFinished` only cares whether
 * the value is "Done" or "Cancelled".
 */
type LinkableTask = {
  id: number;
  status: string;
};

/**
 * Resolves a bucket's percent-complete (0-100), or null when it can't be known.
 *
 * A manual `percentComplete` (including 0) always wins. Otherwise the value is
 * derived from the share of linked tasks that are finished (Done|Cancelled).
 * Dangling task ids (no longer present in `tasks`) are dropped before the
 * derivation; if none resolve, the result is null (no signal at all).
 */
export function bucketPercentComplete(
  bucket: Pick<BudgetBucket, "taskIds" | "percentComplete">,
  tasks: readonly LinkableTask[],
): number | null {
  if (bucket.percentComplete !== undefined) {
    return bucket.percentComplete;
  }

  const taskIds = bucket.taskIds ?? [];
  if (taskIds.length === 0) {
    return null;
  }

  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const resolved = taskIds
    .map((id) => tasksById.get(id))
    .filter((task): task is LinkableTask => task !== undefined);

  if (resolved.length === 0) {
    return null;
  }

  const finished = resolved.filter((task) =>
    isTaskFinished({ status: task.status as TaskStatus }),
  ).length;
  return (finished / resolved.length) * 100;
}

/**
 * Earned value = budgeted cost scaled by percent-complete. Null when progress
 * is unknown (never guess a 0% or 100% earned value from unknown progress).
 */
export function earnedValueFor(budgetedCost: number, pct: number | null): number | null {
  if (pct === null) {
    return null;
  }
  return (budgetedCost * pct) / 100;
}
