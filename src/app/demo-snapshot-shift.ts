// src/app/demo-snapshot-shift.ts
//
// Moves the demo's seeded Trends records (authored in the sample's own dates) to
// the real date and thins them to the user's capture cadence. Pure, no clock.

import { shiftDatesIn, shiftPeriodKey } from "./shift-workspace-dates";
import { bucketKey, type SnapshotCadence, type SnapshotRecord } from "./snapshot";
import type { PlanGranularity } from "./types";

/** Shifts every date of every record by `n` plan periods, then re-derives `id` and
 *  `bucket` from the moved `capturedAt`. A month shift clamps (Jan 30 → Feb 28), so two
 *  source Fridays can land in one bucket: the later source wins, as a live capture would. */
export function shiftDemoSnapshots(
  recs: readonly SnapshotRecord[],
  n: number,
  unit: PlanGranularity,
): SnapshotRecord[] {
  const byBucket = new Map<string, SnapshotRecord>();
  for (const r of recs) {
    const moved = shiftDatesIn(r, n, unit);
    const capturedAt = moved.capturedAt;
    const bucket = bucketKey(new Date(capturedAt), r.cadence);
    byBucket.set(bucket, {
      ...moved,
      id: capturedAt,
      bucket,
      // `shiftDatesIn` shifts period-shaped KEYS, not period VALUES, so each `period` moves here.
      series: moved.series.map((p) => ({ ...p, period: shiftPeriodKey(p.period, n, unit) })),
    });
  }
  return [...byBucket.values()].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

/** Weekly and daily keep every record; monthly keeps the last record of each calendar
 *  month (by `capturedAt`) and makes the first kept one the baseline. */
export function thinForCadence(recs: readonly SnapshotRecord[], cadence: SnapshotCadence): SnapshotRecord[] {
  if (cadence !== "monthly") return [...recs];
  const lastOfMonth = new Map<string, SnapshotRecord>();
  for (const r of [...recs].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))) {
    lastOfMonth.set(r.capturedAt.slice(0, 7), r);
  }
  return [...lastOfMonth.values()].map((r, i) => ({ ...r, isBaseline: i === 0 }));
}
