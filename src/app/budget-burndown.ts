// Pure per-period burn-down series for the dashboard + budget report charts.
// Reads budgeted vs actual hours (and € on the external-rate basis) across all
// buckets, returns "remaining" arrays that descend over the plan periods.
// No React, no I/O.

import { generatePeriods } from "./resource-capacity";
import { bucketRateRows } from "./budget-report";
import type { BudgetBucket, ResourcePlan, Role } from "./types";

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
 *  remaining is defined only up to the period containing today. */
export function computeBurndownSeries(
  buckets: readonly BudgetBucket[],
  plan: ResourcePlan,
  roles: readonly Role[],
  today: string,
): BurndownSeries {
  const periods = generatePeriods(plan.startDate, plan.endDate, plan.granularity);
  const n = periods.length;
  const budgetH = new Array<number>(n).fill(0);
  const actualH = new Array<number>(n).fill(0);
  const budgetV = new Array<number>(n).fill(0);
  const actualV = new Array<number>(n).fill(0);

  for (const b of buckets) {
    const rows = bucketRateRows(b, roles);
    periods.forEach((p, i) => {
      for (const row of rows) {
        const bh = row.budgetHours[p.key] ?? 0;
        const ah = row.actualHours[p.key] ?? 0;
        budgetH[i] += bh;
        actualH[i] += ah;
        budgetV[i] += bh * row.rates.external;
        actualV[i] += ah * row.rates.external;
      }
    });
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
