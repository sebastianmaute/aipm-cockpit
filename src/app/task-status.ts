// src/app/task-status.ts — pure, i18n-free task workflow-status engine.
import { DEFAULT_TASK_STATUS, TASK_STATUSES, type Task, type TaskStatus } from "./types";

const STATUS_SET = new Set<string>(TASK_STATUSES);

/** Done and Cancelled are terminal. Cancelled is "finished" for hiding and for
 *  active-surface exclusion, but it is NOT "completed" (no completedDate). */
export function isTaskFinished(task: Pick<Task, "status">): boolean {
  return task.status === "Done" || task.status === "Cancelled";
}

/** Change a task's status while preserving the invariant
 *  `status==="Done" ⟺ completedDate set`. Pure: returns a new object. */
export function applyStatusChange(task: Task, next: TaskStatus, today: string): Task {
  if (next === "Done") {
    return { ...task, status: "Done", completedDate: task.completedDate || today };
  }
  return { ...task, status: next, completedDate: "" };
}

/** Normalize a raw/legacy task to a valid status. Absent/invalid status derives
 *  from completedDate (set => Done, else To Do). Valid status is kept as-is. */
export function migrateTaskStatus(task: Task): Task {
  if (typeof task.status === "string" && STATUS_SET.has(task.status)) return task;
  const derived: TaskStatus = task.completedDate ? "Done" : DEFAULT_TASK_STATUS;
  return { ...task, status: derived };
}

/** Sort index following TASK_STATUSES order. Unknown => end. */
export function statusSortIndex(status: string): number {
  const i = TASK_STATUSES.indexOf(status as TaskStatus);
  return i === -1 ? TASK_STATUSES.length : i;
}
