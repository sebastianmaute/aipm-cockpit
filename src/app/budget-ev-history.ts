/**
 * Derived earned-value history (MR 3 addendum §3.4, Option 1). Pure, i18n-free.
 * Per date and per budgeted bucket: share = linked tasks finished with a
 * completion date on or before that date ÷ resolved linked tasks. EV € = Σ
 * budgetValue × share, EV h = Σ reported budgetHours × share (§3.1 basis).
 * The TODAY point uses `bucketPercentComplete`, so the line ends exactly at the
 * forecast's EV; a finished task with no completion date (Cancelled) can only
 * be placed there. All or nothing: a hand-entered percent or an unlinked
 * budgeted bucket has no history, and a partial line would under-report EV.
 * Approximation by construction: today's links and budget apply to the past.
 */
import { bucketPercentComplete } from "./budget-earned-value";
import { isTaskFinished } from "./task-status";
import type { BudgetReport } from "./budget-report";
import type { BudgetBucket, Task } from "./types";

export type EvHistoryTask = Pick<Task, "id" | "status" | "completedDate">;
export type EvHistoryPoint = { date: string; eur: number; hours: number };
export type EvHistory =
  | { available: true; points: readonly EvHistoryPoint[] }
  | { available: false; reason: "manual-percent" | "no-linked-tasks"; buckets: readonly { id: number; name: string }[] };
export type EvHistoryInput = {
  report: BudgetReport; buckets: readonly BudgetBucket[]; tasks: readonly EvHistoryTask[];
  dates: readonly string[]; today: string;
};

type LinkedBucket = { bucket: BudgetBucket; eur: number; hours: number; resolved: readonly EvHistoryTask[] };

function finishedBy(task: EvHistoryTask, date: string): boolean {
  const done = task.completedDate ? task.completedDate.slice(0, 10) : "";
  return isTaskFinished(task) && done !== "" && done <= date;
}

export function computeEvHistory(input: EvHistoryInput): EvHistory {
  const { report, buckets, tasks, dates, today } = input;
  const reportById = new Map(report.buckets.map((r) => [r.bucketId, r]));
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const blocking: { id: number; name: string }[] = [];
  let anyManual = false;
  const linked: LinkedBucket[] = [];
  for (const bucket of buckets) {
    const br = reportById.get(bucket.id);
    if (!br || !(br.budgetValue > 0)) continue;
    if (bucket.percentComplete !== undefined) {
      anyManual = true;
      blocking.push({ id: bucket.id, name: bucket.name });
      continue;
    }
    const resolved = (bucket.taskIds ?? [])
      .map((id) => tasksById.get(id))
      .filter((task): task is EvHistoryTask => task !== undefined);
    if (resolved.length === 0) {
      blocking.push({ id: bucket.id, name: bucket.name });
      continue;
    }
    linked.push({ bucket, eur: br.budgetValue, hours: br.budgetHours, resolved });
  }
  if (blocking.length > 0) {
    return { available: false, reason: anyManual ? "manual-percent" : "no-linked-tasks", buckets: blocking };
  }
  const points = dates.map((date) => {
    let eur = 0;
    let hours = 0;
    for (const b of linked) {
      // `bucketPercentComplete` can only return null for a manual percent or an
      // empty resolved set, and both are excluded before a bucket reaches
      // `linked` (see the loop above) — so the non-null assertion is safe and
      // provably unreachable is left untested rather than faked (ruling P16).
      const share = date >= today
        ? bucketPercentComplete(b.bucket, b.resolved)! / 100
        : b.resolved.filter((task) => finishedBy(task, date)).length / b.resolved.length;
      eur += b.eur * share;
      hours += b.hours * share;
    }
    return { date, eur, hours };
  });
  return { available: true, points };
}
