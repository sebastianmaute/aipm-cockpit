// src/app/task-closed.ts — the two questions a caller can ask about a finished
// task, kept apart on purpose.
//
// CLOSED   = the task will not be worked on again (Done or Cancelled). Use for
//            anything about ACTIVE work: overdue, due-soon, workload, forecast,
//            row styling, chasing the assignee.
// DELIVERED = the work was actually completed (Done, i.e. it carries a
//            completedDate). Use for anything counting OUTPUT: completion
//            percentage numerator, earned value, on-time/late.
//
// Cancelled is CLOSED but never DELIVERED. Reading `!!task.completedDate` as
// "closed" is what made cancelled tasks keep reporting as open and overdue.
import { isTaskFinished } from "./task-status";
import { type Task } from "./types";

export function isTaskClosed(task: Pick<Task, "status">): boolean {
  return isTaskFinished(task);
}

export function isTaskDelivered(task: Pick<Task, "completedDate">): boolean {
  return !!task.completedDate;
}

/** CLOSED but never DELIVERED — cancelled work, plus the `Done`-with-no-date
 *  rows. This is the "not part of the scope any more" question, the one that
 *  decides both the completion denominator and the R/A/G tally.
 *
 *  ★★ Shared rather than re-derived, and that is the whole point: `scopeCounts`
 *  (dashboard.ts) and `computeGroupHealth` (health.ts) render side by side in
 *  ONE card, so a second copy of `isTaskClosed(t) && !isTaskDelivered(t)` that
 *  drifts puts two tiles on one screen disagreeing about the same tasks. That
 *  has already happened once with `hasNoActiveScope`. */
export function isTaskOutOfScope(task: Pick<Task, "status" | "completedDate">): boolean {
  return isTaskClosed(task) && !isTaskDelivered(task);
}
