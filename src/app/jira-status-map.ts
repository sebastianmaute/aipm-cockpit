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

/** A task whose status is owned by Jira (read-only locally). */
export function isJiraSynced(task: Pick<Task, "jiraKey">): boolean {
  return !!task.jiraKey;
}
