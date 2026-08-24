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

/** Force `status === "Done"` ⟺ `completedDate` set (DATE wins, except `Cancelled`).
 *
 *  - a `completedDate` on a `Cancelled` row ⇒ the DATE is cleared (see below)
 *  - a `completedDate` on any other non-Done row ⇒ `status` becomes "Done"
 *  - `status === "Done"` with no date ⇒ `status` becomes DEFAULT_TASK_STATUS
 *  - anything else is returned BY REFERENCE, unchanged
 *
 *  Invents no date, and deletes one in exactly ONE case: the `Cancelled` row
 *  above, where the STATUS wins because Cancelled is CLOSED but never DELIVERED
 *  (task-closed.ts). Emptiness is `!!completedDate`, the same test
 *  `isTaskDelivered` (task-closed.ts) uses — defining "has a date" twice is how
 *  the two would drift.
 *
 *  Does NOT validate `status`: an absent/invalid one is returned BY REFERENCE,
 *  so compose it with `migrateTask` (either order), as `sanitizeSeedTask`
 *  (templates.ts) does.
 *
 *  ★★★ FOR SEED / IMPORT DATA ONLY, and the reason is NOT the one an earlier
 *  revision gave. This is a strict NO-OP on every Jira patch, so routing either
 *  Jira path through it would buy nothing rather than protect anything: it
 *  writes `status` in only two cases (a date on a row that is neither Done nor
 *  Cancelled, and `Done` with no date), and `issueToTaskFields` derives BOTH
 *  fields from ONE `statusKey` read, so a Jira patch always pairs a truthy
 *  `completedDate` with `status === "Done"` and neither case can arise. The
 *  old reason — that it "would rewrite a reopened issue's genuine 'In Progress'
 *  into 'To Do'" — is FALSE: that input falls through both guards. The hazard
 *  that IS real runs the OTHER way: where a stale local date survives beside a
 *  non-Done status, date-wins promotes the row to Done. That is the
 *  open-followups §227 local-arm question, and it is why the prohibition still
 *  stands.
 *
 *  ★★ Not a load-path repair either. `migrateTask` runs on all six load paths
 *  and only backfills an ABSENT/INVALID status; teaching IT to reconcile would
 *  change every backend's load behaviour. */
export function reconcileStatusFromDate(task: Task): Task {
  if (task.completedDate) {
    if (task.status === "Done") return task;
    // Cancelled is CLOSED but never DELIVERED (task-closed.ts). Promoting it to
    // Done would turn an explicit human decision into delivered work, so for
    // this ONE status the STATUS wins and the stray date is cleared instead —
    // matching applyStatusChange, which writes "" for every non-Done status.
    if (task.status === "Cancelled") return { ...task, completedDate: "" };
    return { ...task, status: "Done" };
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
