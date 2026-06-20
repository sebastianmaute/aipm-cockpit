// src/app/task-kanban.ts — pure, i18n-free Kanban grouping.
import { TASK_STATUSES, type Task, type TaskStatus } from "./types";

/** Partition tasks into one bucket per TaskStatus (all buckets present, even empty).
 *  Input order is preserved within each bucket. */
export function groupByStatus(tasks: readonly Task[]): Record<TaskStatus, Task[]> {
  const out = {} as Record<TaskStatus, Task[]>;
  for (const s of TASK_STATUSES) out[s] = [];
  for (const task of tasks) out[task.status].push(task);
  return out;
}
