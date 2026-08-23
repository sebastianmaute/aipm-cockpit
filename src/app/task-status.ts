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

/** Normalize a raw/legacy task on LOAD. Two jobs, both idempotent:
 *  - status: absent/invalid derives from completedDate (set => Done, else To Do)
 *  - createdDate: absent falls back to lastUpdateDate, else "" (never invented)
 *  Runs on all six load paths, so it is the single backfill seam. */
export function migrateTask(task: Task): Task {
  const statusOk = typeof task.status === "string" && STATUS_SET.has(task.status);
  const createdOk = typeof task.createdDate === "string";
  if (statusOk && createdOk) return task;
  const out = { ...task };
  if (!statusOk) out.status = task.completedDate ? "Done" : DEFAULT_TASK_STATUS;
  if (!createdOk) out.createdDate = task.lastUpdateDate || "";
  return out;
}

/** Force the pair `status === "Done"` ⟺ `completedDate` set by trusting the DATE.
 *
 *  - a `completedDate` present  ⇒ `status` becomes "Done"
 *  - `status === "Done"` with no date ⇒ `status` becomes DEFAULT_TASK_STATUS
 *  - anything else is returned BY REFERENCE, unchanged
 *
 *  Invents no date and deletes none. Emptiness is `!!completedDate`, the same
 *  test `isTaskDelivered` (task-closed.ts) uses — defining "has a date" twice
 *  is how the two would drift.
 *
 *  ★★★ FOR SEED / IMPORT DATA ONLY. Today that is `sanitizeSeedTask`
 *  (templates.ts), whose two reads of the pair are independent. Do NOT call it
 *  on either Jira path: Jira's status comes from `statusCategory`, not from
 *  date presence, so this would rewrite a reopened issue's genuine
 *  "In Progress" into "To Do" purely because it carries no resolution date.
 *  Those paths derive both fields from one `statusKey` read and need nothing
 *  from here (AGENTS.md, task status model).
 *
 *  ★★ Not a load-path repair either. `migrateTask` runs on all six load paths
 *  and only backfills an ABSENT/INVALID status; teaching IT to reconcile would
 *  change every backend's load behaviour and would apply this date-wins rule
 *  to Jira rows, where it is wrong. */
export function reconcileStatusFromDate(task: Task): Task {
  if (task.completedDate) {
    return task.status === "Done" ? task : { ...task, status: "Done" };
  }
  if (task.status === "Done") {
    return { ...task, status: DEFAULT_TASK_STATUS };
  }
  return task;
}

/** Sort index following TASK_STATUSES order. Unknown => end. */
export function statusSortIndex(status: string): number {
  const i = TASK_STATUSES.indexOf(status as TaskStatus);
  return i === -1 ? TASK_STATUSES.length : i;
}
