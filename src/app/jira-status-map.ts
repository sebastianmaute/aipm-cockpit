// src/app/jira-status-map.ts — pure mapping of Jira status categories to our status.
import type { Task, TaskStatus } from "./types";

/** Jira exposes 3 statusCategory keys; map to our nearest workflow status. */
export function jiraCategoryToStatus(categoryKey: string): TaskStatus {
  switch (categoryKey) {
    case "indeterminate": return "In Progress";
    case "done": return "Done";
    case "new":
    default: return "To Do";
  }
}

/** The Jira status category that can carry a given local status.
 *
 *  ★★★ The INVERSE of `jiraCategoryToStatus`, and deliberately lossy in the
 *  same direction. Jira exposes three categories; we have six statuses, so
 *  `On Hold`, `In Review` and `Cancelled` have no category of their own and
 *  `jiraCategoryToStatus` can never produce them. Comparing a local status to
 *  a remote one LITERALLY therefore reports a difference forever on such a
 *  row — not because the issue moved, but because the wire cannot say what we
 *  mean. Round-tripping through this function first compares the two at the
 *  granularity Jira actually carries (open-followups §226).
 *
 *  ★ `Cancelled` is `done`, not `indeterminate`: it is terminal, and Jira
 *  files cancelled / won't-do resolutions under the done category. Nothing is
 *  lost by it — a cancelled row facing a genuinely completed issue still
 *  differs on `completedDate`, which the caller tests separately. */
export function statusToJiraCategory(s: TaskStatus): string {
  switch (s) {
    case "To Do":
      return "new";
    case "Done":
    case "Cancelled":
      return "done";
    default:
      return "indeterminate";
  }
}

/** A task whose status is owned by Jira (read-only locally). */
export function isJiraSynced(task: Pick<Task, "jiraKey">): boolean {
  return !!task.jiraKey;
}
