// src/app/timelog-apply.ts — pure plan/apply of Timelog overlay actuals into budget allocations.
import type { BudgetBucket } from "./types";
import type { ActualsByBucket } from "./timelog-actuals";

export type ApplyDiffRow = { bucketId: number; period: string; current: number; next: number };

export function planApply(buckets: readonly BudgetBucket[], overlay: ActualsByBucket): ApplyDiffRow[] {
  const rows: ApplyDiffRow[] = [];
  for (const b of buckets) {
    const periods = overlay[b.id];
    if (!periods) continue;
    const first = b.allocations[0];
    for (const [period, cell] of Object.entries(periods)) {
      rows.push({ bucketId: b.id, period, current: first?.actualHours?.[period] ?? 0, next: cell.hours });
    }
  }
  return rows;
}

export function applyActualsToBuckets(buckets: readonly BudgetBucket[], overlay: ActualsByBucket): BudgetBucket[] {
  return buckets.map((b) => {
    const periods = overlay[b.id];
    if (!periods || b.allocations.length === 0) return b;
    const [first, ...rest] = b.allocations;
    const nextActual = { ...first.actualHours };
    for (const [period, cell] of Object.entries(periods)) nextActual[period] = cell.hours;
    return { ...b, allocations: [{ ...first, actualHours: nextActual }, ...rest] };
  });
}
