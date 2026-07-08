// src/app/timelog-apply.ts — pure plan/apply of Timelog overlay actuals into budget allocations.
import type { BudgetBucket, BucketAllocation, DisciplineAllocation } from "./types";
import type { ActualsByBucket, HourCell } from "./timelog-actuals";

export type ApplyDiffRow = { bucketId: number; period: string; current: number; next: number };

// The allocation array that HOLDS actuals for a bucket: disciplineAllocations for
// a blended bucket, else the per-role allocations. A bucket with an EMPTY target
// array has nowhere to store actuals — apply must skip it (there is no "unassigned"
// role/discipline to fabricate), so the plan/affordance must not count it either.
function targetAllocations(b: BudgetBucket): readonly (BucketAllocation | DisciplineAllocation)[] {
  return b.planningMode === "blended" ? (b.disciplineAllocations ?? []) : b.allocations;
}

export function planApply(buckets: readonly BudgetBucket[], overlay: ActualsByBucket): ApplyDiffRow[] {
  const rows: ApplyDiffRow[] = [];
  for (const b of buckets) {
    const periods = overlay[b.id];
    if (!periods) continue;
    const first = targetAllocations(b)[0];
    if (!first) continue; // no allocation to receive actuals — apply would no-op, so don't count it
    for (const [period, cell] of Object.entries(periods)) {
      rows.push({ bucketId: b.id, period, current: first.actualHours[period] ?? 0, next: cell.hours });
    }
  }
  return rows;
}

// Immutably fold overlay period hours into the FIRST allocation's actualHours.
function withActuals<T extends { actualHours: Record<string, number> }>(
  list: readonly T[],
  periods: Record<string, HourCell>,
): T[] {
  const [first, ...rest] = list;
  const nextActual = { ...first.actualHours };
  for (const [period, cell] of Object.entries(periods)) nextActual[period] = cell.hours;
  return [{ ...first, actualHours: nextActual }, ...rest];
}

export function applyActualsToBuckets(buckets: readonly BudgetBucket[], overlay: ActualsByBucket): BudgetBucket[] {
  return buckets.map((b) => {
    const periods = overlay[b.id];
    if (!periods) return b;
    if (b.planningMode === "blended") {
      const list = b.disciplineAllocations ?? [];
      return list.length === 0 ? b : { ...b, disciplineAllocations: withActuals(list, periods) };
    }
    return b.allocations.length === 0 ? b : { ...b, allocations: withActuals(b.allocations, periods) };
  });
}

// Overlay buckets that carry booked hours but have NO target allocation to hold
// them — the panel surfaces these so the user knows to add a role/discipline line
// before actuals can be applied (see the missing-allocation notice).
export function bucketsMissingAllocations(buckets: readonly BudgetBucket[], overlay: ActualsByBucket): number[] {
  return buckets.filter((b) => overlay[b.id] && targetAllocations(b).length === 0).map((b) => b.id);
}
