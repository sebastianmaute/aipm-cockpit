/**
 * Derived earned-value history, rule 1A′ (spec §5.1). Pure, i18n-free.
 * Per date and per budgeted bucket, a share of the bucket's OWN budget
 * (`ownBudget.*`, the basis `budget-forecast.ts` uses since §550 — the
 * reported twins would count a closed donor's remainder twice):
 * - before the bucket's `startDate`: 0, known (no such work in the plan);
 * - task-linked: linked tasks finished by that date ÷ resolved linked tasks;
 * - hand-entered: the latest snapshot record on or before that date;
 * - otherwise (no record yet, or task links that resolve to no tasks — treated
 *   the same as an unrecorded manual bucket): 0, UNKNOWN, and the point lists
 *   the bucket in `partial`.
 * A bucket that becomes known after an unknown point is a `join` there, with
 * the amount it brings in, so the step does not read as a sudden delivery.
 * The TODAY point uses `bucketPercentComplete`, so the line ends exactly at the
 * forecast's EV: a bucket with no current percent adds 0 there, as it does to
 * the forecast's EV, and is listed in `partial` like on any other point; a
 * bucket first known today is a `join` there. It is any date on or
 * after today AND always the last date: once today is past the last plan
 * period, `actualPointDates` ends at that period's end, which precedes today.
 * Unavailable only when no budgeted bucket yields earned value at all — every
 * one has no current percent, so it can never be known after its start.
 * Approximation by construction: today's links and budget apply to the past.
 */
import { bucketPercentComplete } from "./budget-earned-value";
import { isTaskFinished } from "./task-status";
import type { BudgetReport } from "./budget-report";
import type { SnapshotRecord } from "./snapshot";
import type { BudgetBucket, Task } from "./types";

export type EvHistoryTask = Pick<Task, "id" | "status" | "completedDate">;
export type BucketProgressRecord = { date: string; pct: number };
/** `startDate` is null for an undated bucket; the chart compares it with
 *  `createdDate` to say whether the bucket was created after it started. */
export type EvPartialBucket = { id: number; name: string; createdDate: string | null; startDate: string | null };
export type EvJoin = { id: number; name: string; eur: number; hours: number };
export type EvHistoryPoint = {
  date: string; eur: number; hours: number;
  partial: readonly EvPartialBucket[]; // empty ⇒ this point is complete
  joins: readonly EvJoin[]; // buckets whose record begins at this point
};
export type EvHistory =
  | { available: true; points: readonly EvHistoryPoint[] }
  | { available: false; reason: "no-earned-value"; buckets: readonly { id: number; name: string }[] };
export type EvHistoryInput = {
  report: BudgetReport; buckets: readonly BudgetBucket[]; tasks: readonly EvHistoryTask[];
  dates: readonly string[]; today: string;
  progress: ReadonlyMap<number, readonly BucketProgressRecord[]>;
};

type Value = { share: number; known: boolean };
type Tracked = { bucket: BudgetBucket; eur: number; hours: number; valueAt: (date: string, isToday: boolean) => Value };

const UNKNOWN: Value = { share: 0, known: false };

/** Per bucket, its recorded percents by capture day, ascending; the last capture of a day wins. */
export function bucketProgressSeries(
  snapshots: readonly Pick<SnapshotRecord, "capturedAt" | "bucketProgress">[],
): ReadonlyMap<number, readonly BucketProgressRecord[]> {
  const byBucket = new Map<number, Map<string, number>>();
  const ordered = [...snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  for (const snap of ordered) {
    const date = snap.capturedAt.slice(0, 10);
    for (const { bucketId, pctComplete } of snap.bucketProgress) {
      const days = byBucket.get(bucketId) ?? new Map<string, number>();
      days.set(date, pctComplete);
      byBucket.set(bucketId, days);
    }
  }
  return new Map([...byBucket].map(([id, days]) => [
    id,
    [...days].map(([date, pct]) => ({ date, pct })).sort((a, b) => a.date.localeCompare(b.date)),
  ]));
}

function finishedBy(task: EvHistoryTask, date: string): boolean {
  const done = task.completedDate ? task.completedDate.slice(0, 10) : "";
  return isTaskFinished(task) && done !== "" && done <= date;
}

function valueFn(
  bucket: BudgetBucket, resolved: readonly EvHistoryTask[], records: readonly BucketProgressRecord[],
): (date: string, isToday: boolean) => Value {
  const now = bucketPercentComplete(bucket, resolved);
  return (date, isToday) => {
    if (isToday) return now === null ? UNKNOWN : { share: now / 100, known: true };
    if (bucket.startDate && date < bucket.startDate) return { share: 0, known: true };
    if (bucket.percentComplete !== undefined) {
      const latest = records.filter((record) => record.date <= date).at(-1);
      return latest ? { share: latest.pct / 100, known: true } : UNKNOWN;
    }
    if (resolved.length === 0) return UNKNOWN;
    return { share: resolved.filter((task) => finishedBy(task, date)).length / resolved.length, known: true };
  };
}

function trackBuckets(input: EvHistoryInput): Tracked[] {
  const reportById = new Map(input.report.buckets.map((r) => [r.bucketId, r]));
  const tasksById = new Map(input.tasks.map((task) => [task.id, task]));
  const tracked: Tracked[] = [];
  for (const bucket of input.buckets) {
    const br = reportById.get(bucket.id);
    if (!br || !(br.ownBudget.budgetValue > 0)) continue;
    const resolved = (bucket.taskIds ?? [])
      .map((id) => tasksById.get(id))
      .filter((task): task is EvHistoryTask => task !== undefined);
    const valueAt = valueFn(bucket, resolved, input.progress.get(bucket.id) ?? []);
    tracked.push({ bucket, eur: br.ownBudget.budgetValue, hours: br.ownBudget.budgetHours, valueAt });
  }
  return tracked;
}

export function computeEvHistory(input: EvHistoryInput): EvHistory {
  const { dates, today } = input;
  const tracked = trackBuckets(input);
  // Only a bucket with neither a hand-entered percent nor any resolvable task
  // link (no `taskIds` at all, or every linked task deleted) can stay unknown
  // after its start, so this is "no bucket yields earned value".
  if (tracked.length > 0 && tracked.every((t) => !t.valueAt(today, true).known)) {
    return { available: false, reason: "no-earned-value", buckets: tracked.map((t) => ({ id: t.bucket.id, name: t.bucket.name })) };
  }
  let previous: readonly Value[] | null = null;
  const points = dates.map((date, i): EvHistoryPoint => {
    const isToday = date >= today || i === dates.length - 1;
    const values = tracked.map((t) => t.valueAt(date, isToday));
    const partial: EvPartialBucket[] = [];
    const joins: EvJoin[] = [];
    let eur = 0;
    let hours = 0;
    tracked.forEach((t, k) => {
      const { share, known } = values[k];
      eur += t.eur * share;
      hours += t.hours * share;
      const { id, name } = t.bucket;
      if (!known) {
        partial.push({ id, name, createdDate: t.bucket.createdDate ?? null, startDate: t.bucket.startDate || null });
      }
      if (known && previous !== null && !previous[k].known) {
        joins.push({ id, name, eur: t.eur * share, hours: t.hours * share });
      }
    });
    previous = values;
    return { date, eur, hours, partial, joins };
  });
  return { available: true, points };
}
