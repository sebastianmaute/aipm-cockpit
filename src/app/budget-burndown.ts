// Pure per-period burn-down series for the dashboard + budget report charts.
// Reads budgeted vs actual hours across all buckets, and € on the
// external-rate basis for T&M buckets / the contract-amount basis for
// fixed-price ones (§472 — see the `type === "fixed"` branch below), returns
// "remaining" arrays that descend over the plan periods — optionally sliced
// to a narrower x-axis span (see `span` below).
// No React, no I/O.

import { generatePeriods } from "./resource-capacity";
import { bucketRateRows, bucketActivePeriods, effectiveBudgetHours } from "./budget-report";
import { currencyToEur } from "./fx";
import { actualHoursIn } from "./actual-hours";
import type { Absence, BudgetBucket, FxRates, Resource, ResourcePlan, Role } from "./types";

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
  /** Same cache `computeBucketReport` reads through `currencyToEur` for a
   *  fixed-price bucket's contract amount (§472/§474/§475) — never re-derive
   *  a rate here. */
  fxRates: FxRates | null,
  /** Optional x-axis window. The plan periods are SLICED to it — never
   *  re-generated from these dates, because every bucket contribution is looked
   *  up by the plan-derived period key (bucketActivePeriods). Re-generating
   *  could produce keys that no longer match and silently drop hours. */
  span?: { start: string; end: string },
): BurndownSeries {
  const allPeriods = generatePeriods(plan.startDate, plan.endDate, plan.granularity);
  // Extend the window forward to today: a chart whose axis stops before today
  // draws the today marker on its last tick and reads as "actuals complete".
  // Forward only — a chain starting after today must still show its full future
  // glide-path from the chain start. `allPeriods` bounds the result either way.
  const effectiveEnd = span && today > span.end ? today : span?.end;
  const sliced = span && effectiveEnd !== undefined
    ? allPeriods.filter((p) => p.start >= span.start && p.start <= effectiveEnd)
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

    if (b.type === "fixed") {
      // §472: a fixed-price bucket is valued from its CONTRACT AMOUNT, never
      // hours × rate — mirrors computeBucketReport's `fixedPrice`/`consumedValue`
      // (budget-report.ts), through the SAME `currencyToEur` helper (§474/§475
      // unresolved-rate handling applies here unchanged). Hours are still summed
      // for the hours series (the chart's other axis), just not used to price
      // this bucket's €.
      //
      // The report's `budgetValue` is the full converted contract amount
      // regardless of hours; `consumedValue` is that amount scaled by the
      // actual/budget hours ratio and capped at the contract (0 when there are
      // no budgeted hours at all). Both totals are reproduced here exactly.
      // Budget is spread across this bucket's in-window periods by each
      // period's share of the budgeted hours (evenly when there are none).
      // Consumed is capped CUMULATIVELY: each period adds
      // min(contract, contract × cumulative actual / budget hours) minus the
      // same figure one period earlier. So an overrun shows in the period the
      // cap is reached, and later periods add 0 — capping the grand total once
      // and spreading it by actual hours would smear the overrun backwards and
      // show budget left in a period that had already exhausted it. The deltas
      // telescope, so an unclipped series still sums to the report's `consumedValue`.
      const fixedPriceEur = currencyToEur(b.fixedPriceAmount ?? 0, b, fxRates);
      const inWindow: { i: number; bh: number; ah: number }[] = [];
      let bucketBudgetHours = 0;
      // `indexByKey` only knows periods inside the CURRENT chart window (see
      // `periods`/`span` above) — a period from `active` outside it is
      // skipped by the `continue` below, so `bucketBudgetHours` and the
      // cumulative actual hours (and therefore every consumed ratio below)
      // are built from IN-WINDOW hours only. `computeBucketReport` has no such window
      // and always sums every active period, so the two can legitimately
      // diverge whenever a chart span clips a fixed-price bucket: the whole
      // contract amount is still spread over just the in-window periods here,
      // and if the window excludes ALL of the bucket's active periods, the
      // contract drops out of this chart entirely (contributes 0 to every
      // series) even though the report still counts it in full.
      for (const p of active) {
        const i = indexByKey.get(p.key);
        if (i === undefined) continue;
        let bh = 0;
        let ah = 0;
        for (const row of rows) {
          bh += effectiveBudgetHours(
            row, p, active, resources, workdayHours, holidaySet, plan.granularity, absences, budgetFollowsPlan, resourcesById,
          );
          ah += actualHoursIn(row.actualHours, p.key);
        }
        budgetH[i] += bh;
        actualH[i] += ah;
        bucketBudgetHours += bh;
        inWindow.push({ i, bh, ah });
      }
      const consumedAt = (cumActualHours: number) => bucketBudgetHours > 0
        ? Math.min(fixedPriceEur, fixedPriceEur * (cumActualHours / bucketBudgetHours))
        : 0;
      const evenShare = inWindow.length > 0 ? 1 / inWindow.length : 0;
      // Chronological order is what makes "cumulative" mean anything.
      const ordered = [...inWindow].sort((x, y) => x.i - y.i);
      let cumActualHours = 0;
      let cumConsumedEur = 0;
      for (const { i, bh, ah } of ordered) {
        const budgetShare = bucketBudgetHours > 0 ? bh / bucketBudgetHours : evenShare;
        budgetV[i] += fixedPriceEur * budgetShare;
        cumActualHours += ah;
        const nextConsumedEur = consumedAt(cumActualHours);
        actualV[i] += nextConsumedEur - cumConsumedEur;
        cumConsumedEur = nextConsumedEur;
      }
      continue;
    }

    for (const p of active) {
      const i = indexByKey.get(p.key);
      if (i === undefined) continue;
      for (const row of rows) {
        const bh = effectiveBudgetHours(
          row, p, active, resources, workdayHours, holidaySet, plan.granularity, absences, budgetFollowsPlan, resourcesById,
        );
        const ah = actualHoursIn(row.actualHours, p.key);
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
