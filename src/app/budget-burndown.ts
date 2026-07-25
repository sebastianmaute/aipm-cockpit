// Pure per-period burn-down series for the dashboard + budget report charts.
// Reads budgeted vs actual hours (and € on the external-rate basis) across all
// buckets, returns "remaining" arrays that descend over the plan periods —
// optionally sliced to a narrower x-axis span (see `span` below).
// No React, no I/O.

import { generatePeriods } from "./resource-capacity";
import { bucketRateRows, bucketActivePeriods, effectiveBudgetHours } from "./budget-report";
import type { Absence, BudgetBucket, Resource, ResourcePlan, Role } from "./types";

export type BurndownSeries = {
  periods: readonly string[];
  /** totalBudget - cumulative budgeted, per period (the planned glide-path). */
  plannedRemainingHours: readonly number[];
  plannedRemainingValue: readonly number[];
  /** totalBudget - cumulative actual, defined only up to todayIndex; null after.
   *  May be negative when actuals exceed the total budget (over-budget). */
  actualRemainingHours: readonly (number | null)[];
  actualRemainingValue: readonly (number | null)[];
  /** Index of the last period whose start is on or before `today`; -1 if all future. */
  todayIndex: number;
  totalBudgetHours: number;
  totalBudgetValue: number;
};

/** Derives per-period planned vs actual remaining hours and € across all buckets
 *  for the burn-down charts. `today` is an ISO date string (YYYY-MM-DD); actual
 *  remaining is defined only up to the period containing today.
 *
 *  Budget hours go through `effectiveBudgetHours` — the SAME single rule the
 *  budget report uses — so a follow-plan bucket's staffed rows derive their
 *  budget from live resource capacity, not the stale stored map (which is 0).
 *  Without this the totals collapse to 0 and the chart reads "no budget" even
 *  though the report shows real hours. */
export function computeBurndownSeries(
  buckets: readonly BudgetBucket[],
  plan: ResourcePlan,
  roles: readonly Role[],
  resources: readonly Resource[],
  workdayHours: number,
  holidaySet: ReadonlySet<string>,
  absences: readonly Absence[],
  today: string,
  /** Optional x-axis window. The plan periods are SLICED to it — never
   *  re-generated from these dates, because every bucket contribution is looked
   *  up by the plan-derived period key (bucketActivePeriods). Re-generating
   *  could produce keys that no longer match and silently drop hours. */
  span?: { start: string; end: string },
): BurndownSeries {
  const allPeriods = generatePeriods(plan.startDate, plan.endDate, plan.granularity);
  const sliced = span
    ? allPeriods.filter((p) => p.start >= span.start && p.start <= span.end)
    : allPeriods;
  // A span that selects nothing (e.g. buckets dated outside the plan) would make
  // an empty chart; fall back to the full range rather than render nothing.
  const periods = sliced.length > 0 ? sliced : allPeriods;
  const n = periods.length;
  const indexByKey = new Map(periods.map((p, i) => [p.key, i] as const));
  const budgetFollowsPlan = plan.budgetFollowsPlan ?? false;
  const resourcesById = new Map(resources.map((r) => [r.id, r] as const));
  const budgetH = new Array<number>(n).fill(0);
  const actualH = new Array<number>(n).fill(0);
  const budgetV = new Array<number>(n).fill(0);
  const actualV = new Array<number>(n).fill(0);

  for (const b of buckets) {
    const rows = bucketRateRows(b, roles);
    // Scope to the bucket's active periods and pass them as canonicalPeriods —
    // mirrors computeBucketReport so the burndown totals equal the report totals.
    const active = bucketActivePeriods(b, plan);
    for (const p of active) {
      const i = indexByKey.get(p.key);
      if (i === undefined) continue;
      for (const row of rows) {
        const bh = effectiveBudgetHours(
          row, p, active, resources, workdayHours, holidaySet, plan.granularity, absences, budgetFollowsPlan, resourcesById,
        );
        const ah = row.actualHours[p.key] ?? 0;
        budgetH[i] += bh;
        actualH[i] += ah;
        budgetV[i] += bh * row.rates.external;
        actualV[i] += ah * row.rates.external;
      }
    }
  }

  const totalBudgetHours = budgetH.reduce((a, v) => a + v, 0);
  const totalBudgetValue = budgetV.reduce((a, v) => a + v, 0);

  let todayIndex = -1;
  for (let i = 0; i < n; i++) if (periods[i].start <= today) todayIndex = i;

  const plannedRemainingHours: number[] = [];
  const plannedRemainingValue: number[] = [];
  const actualRemainingHours: (number | null)[] = [];
  const actualRemainingValue: (number | null)[] = [];
  let cumBH = 0, cumBV = 0, cumAH = 0, cumAV = 0;
  for (let i = 0; i < n; i++) {
    cumBH += budgetH[i]; cumBV += budgetV[i];
    cumAH += actualH[i]; cumAV += actualV[i];
    plannedRemainingHours.push(totalBudgetHours - cumBH);
    plannedRemainingValue.push(totalBudgetValue - cumBV);
    const inPast = i <= todayIndex;
    actualRemainingHours.push(inPast ? totalBudgetHours - cumAH : null);
    actualRemainingValue.push(inPast ? totalBudgetValue - cumAV : null);
  }

  return {
    periods: periods.map((p) => p.key),
    plannedRemainingHours, plannedRemainingValue,
    actualRemainingHours, actualRemainingValue,
    todayIndex, totalBudgetHours, totalBudgetValue,
  };
}
