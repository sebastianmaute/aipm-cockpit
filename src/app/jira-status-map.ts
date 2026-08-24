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

/** The three status categories Jira exposes. */
export type JiraStatusCategory = "new" | "indeterminate" | "done";

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
 *  differs on `completedDate`, which the caller tests separately.
 *
 *  ★ A `Record<TaskStatus, …>` rather than a switch, matching `STATUS_LABEL_KEY`
 *  (task-status-ui.ts): a seventh `TaskStatus` then fails to COMPILE here
 *  instead of falling into a `default:` arm and silently becoming
 *  `indeterminate`, which could be wrong in either direction depending on what
 *  the new status means. */
const STATUS_TO_JIRA_CATEGORY: Record<TaskStatus, JiraStatusCategory> = {
  "To Do": "new",
  "In Progress": "indeterminate",
  "On Hold": "indeterminate",
  "In Review": "indeterminate",
  "Cancelled": "done",
  "Done": "done",
};

export function statusToJiraCategory(s: TaskStatus): JiraStatusCategory {
  return STATUS_TO_JIRA_CATEGORY[s];
}

/** A task whose status is owned by Jira (read-only locally). */
export function isJiraSynced(task: Pick<Task, "jiraKey">): boolean {
  return !!task.jiraKey;
}
