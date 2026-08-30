// src/app/task-status.ts — pure, i18n-free task workflow-status engine.
import { DEFAULT_TASK_STATUS, TASK_STATUSES, type Task, type TaskStatus } from "./types";
import { isTaskDelivered } from "./task-closed";

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

/** How many rows break the pair invariant `status === "Done"` ⟺ `completedDate` set.
 *
 *  DIAGNOSTIC ONLY — repairs nothing and is on no load path. It exists because
 *  three open follow-ups (§226, §227, §228) all turn on how many stored rows
 *  are actually split, and none of them could be decided without a number.
 *
 *  ★ Written as the negation of the invariant itself, in ONE expression, so it
 *  cannot drift from the property it measures. That also makes it catch the
 *  `Cancelled`-with-a-stray-date row for free: the date is truthy and the
 *  status is not `Done`, so the biconditional fails — which is right, even
 *  though `reconcileStatusFromDate` repairs THAT row by clearing the date
 *  rather than by promoting the status.
 *
 *  ★ Emptiness is `!!completedDate`, the same test `isTaskDelivered`
 *  (task-closed.ts) and `reconcileStatusFromDate` use. Defining "has a date" a
 *  fourth way is how the four would drift. */
export function countSplitTaskPairs(tasks: readonly Task[]): number {
  let n = 0;
  for (const task of tasks) {
    if (!!task.completedDate !== (task.status === "Done")) n++;
  }
  return n;
}

/** Sort index following TASK_STATUSES order. Unknown => end. */
export function statusSortIndex(status: string): number {
  const i = TASK_STATUSES.indexOf(status as TaskStatus);
  return i === -1 ? TASK_STATUSES.length : i;
}

/** Which activity kind a status write should record, or `null` for none.
 *
 *  ★★★ DELIVERED, NOT CLOSED. `isTaskClosed` is Done OR Cancelled; cancelling a
 *    task would then report as a COMPLETION and un-cancelling as a REOPENING,
 *    which is the precise confusion `task-closed.ts` was split to prevent. Only
 *    delivery — a `completedDate` — is a completion.
 *
 *  ★★★ THE NUMERATOR IS SAFE; THE SERIES IS NOT — AND AN EARLIER REVISION HERE
 *    CLAIMED BOTH. It read "a writer that forgets to log costs an AUDIT ENTRY
 *    and can never move a metric", and the second half is FALSE. Only the
 *    numerator half holds: `deliveredBy` (`completion-trend.ts`) reduces over
 *    `tasks` alone, so no missing entry can move it. But both kinds returned
 *    here are members of `COUNT_KINDS`, and that set does TWO jobs — it admits
 *    an entry past the `continue` guard AND it decides which days SEED a point.
 *    A completion contributes `dTotal` 0 and still seeds its day, so a missed
 *    writer changes which days the reconstructed sparkline plots, and can drop
 *    it under the `days.length < 2` floor, rendering NO chart at all.
 *    Measured 2026-08-30 against the real module via `npx vite-node`, not
 *    reasoned: one task delivered 06-10, `currentDone` 1, `currentTotal` 2,
 *    today 06-21 gives `[06-10 → 100, 06-12 → 50]` with the `task.completed`
 *    entry present and `[]` with it removed. Pinned by the "a completion-only
 *    day" pair in `completion-trend.test.ts`.
 *
 *  ★★ The census in `status-activity-census.test.ts` is still a convenience
 *    rather than a load-bearing correctness gate — but NOT on that leg. It is
 *    FILE-GRANULAR: a file holding several status writers passes on any ONE of
 *    them, which is how `use-jira-sync.ts`'s conflict path could have stayed
 *    silent behind a green run while its two pull sites were adopted. Per-site
 *    tests are the only cover, and the census file states the same two reasons
 *    (granularity and spelling) in full. */
export function statusActivityKind(
  before: Pick<Task, "completedDate">,
  after: Pick<Task, "completedDate">,
): "task.completed" | "task.reopened" | null {
  const was = isTaskDelivered(before);
  const now = isTaskDelivered(after);
  if (was === now) return null;
  return now ? "task.completed" : "task.reopened";
}
