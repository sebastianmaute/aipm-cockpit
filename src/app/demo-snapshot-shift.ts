// src/app/demo-snapshot-shift.ts
//
// Moves the demo's seeded Trends records (authored in the sample's own dates) to
// the real date and thins them to the user's capture cadence. Pure, no clock.

import { mondayOf, shiftDatesIn, shiftPeriodKey } from "./shift-workspace-dates";
import { bucketKey, type SnapshotCadence, type SnapshotRecord } from "./snapshot";
import type { PlanGranularity } from "./types";

const WEEK_MS = 7 * 86_400_000;

/** Shifts every date inside every record by `n` plan periods, as the workspace's own dates move,
 *  but moves every `capturedAt` by one whole number of weeks, chosen so the latest capture lands
 *  in the week before `today`'s, then re-derives `id` and `bucket` from it. ★ A capture moved
 *  by months lands on a different weekday per record, which empties some weekly buckets and
 *  doubles up others. ★★ Weeks derived from the month shift kept the weekdays but still left the
 *  last capture up to three weeks before today's week (a month shift is a calendar-month count),
 *  and Trends draws a gap for each week between it and the live capture. */
export function shiftDemoSnapshots(
  recs: readonly SnapshotRecord[],
  n: number,
  unit: PlanGranularity,
  today: string,
): SnapshotRecord[] {
  const latest = recs.reduce<string | null>((m, r) => (m === null || r.capturedAt > m ? r.capturedAt : m), null);
  const weeks = latest === null ? 0
    : (Date.parse(mondayOf(today)) - Date.parse(mondayOf(latest.slice(0, 10)))) / WEEK_MS - 1;
  const byBucket = new Map<string, SnapshotRecord>();
  for (const r of recs) {
    const moved = shiftDatesIn(r, n, unit);
    const capturedAt = new Date(Date.parse(r.capturedAt) + weeks * WEEK_MS).toISOString();
    const bucket = bucketKey(new Date(capturedAt), r.cadence);
    byBucket.set(bucket, {
      ...moved,
      capturedAt,
      id: capturedAt,
      bucket,
      // `shiftDatesIn` shifts period-shaped KEYS, not period VALUES, so each `period` moves here.
      series: moved.series.map((p) => ({ ...p, period: shiftPeriodKey(p.period, n, unit) })),
    });
  }
  return [...byBucket.values()].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

/** Weekly and daily keep every record unchanged (no daily data exists to replay, so daily
 *  shows gap markers). Monthly keeps the last record of each calendar month (by `capturedAt`),
 *  relabels it `cadence: "monthly"` with its monthly `bucket` so gap detection sees no gaps,
 *  and makes the first kept one the baseline. */
export function thinForCadence(recs: readonly SnapshotRecord[], cadence: SnapshotCadence): SnapshotRecord[] {
  if (cadence !== "monthly") return [...recs];
  const lastOfMonth = new Map<string, SnapshotRecord>();
  for (const r of [...recs].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))) {
    lastOfMonth.set(r.capturedAt.slice(0, 7), r);
  }
  return [...lastOfMonth.values()].map((r, i) => ({
    ...r,
    cadence: "monthly",
    bucket: bucketKey(new Date(r.capturedAt), "monthly"),
    isBaseline: i === 0,
  }));
}
