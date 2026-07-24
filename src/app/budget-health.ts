// Pure RAG (Red/Amber/Green) thresholds for budget money/hours metrics.
// Single source of truth shared by the budget panel, budget report, and
// dashboard. No React, no I/O.

import type { Health } from "./health";

/** Ratio bands where exceeding budget is bad: Green <90%, Amber 90-100%, Red >100%. */
export const BUDGET_OVER_AMBER = 0.9;
export const BUDGET_OVER_RED = 1.0;
/** Contribution-margin Green threshold (percent). Negative margin is always Red. */
export const MARGIN_GREEN_PCT = 15;
/** Cost-performance index bands as percent (budgetCost/cost*100). Mirrors EVM CPI. */
export const COST_PERF_RED = 80;
export const COST_PERF_AMBER = 90;

/** Relative tolerance for the band comparisons. `budgetHours` and
 *  `plannedHours` are the same sum accumulated in different association orders
 *  (budget-report.ts sums a per-row subtotal for one and a flat running total
 *  for the other), so two mathematically equal figures differ by a few ULP.
 *  Without this a 6e-14 h difference paints an exactly-on-budget bucket Red.
 *  1e-9 sits orders of magnitude above double noise and far below any real
 *  overrun. */
export const RATIO_EPSILON = 1e-9;

/** Over-budget ratio health. Green below 90% of budget, Amber from 90% up to and
 *  including 100%, Red above 100% — each band edge carried by RATIO_EPSILON so
 *  float noise cannot tip a figure across it. null when there is no budget to
 *  compare against (budget is zero, negative, or non-finite).
 *
 *  Models CONSUMPTION: reaching 100% means the budget is fully spent, which is
 *  Amber by design. Plan-vs-budget adherence, where 100% means hitting the
 *  target exactly, is a different question and does not belong in these bands. */
export function ratioHealth(actual: number, budget: number): Health | null {
  if (!(budget > 0)) return null;
  const r = actual / budget;
  if (r > BUDGET_OVER_RED * (1 + RATIO_EPSILON)) return "R";
  if (r >= BUDGET_OVER_AMBER * (1 - RATIO_EPSILON)) return "A";
  return "G";
}

/**
 * Plan-vs-budget adherence: planning AT or UNDER budget is on target (Green),
 * over budget is Red.
 *
 * Deliberately NOT `ratioHealth`. That function models CONSUMPTION, where
 * reaching 100% means the budget is fully spent and must stay Amber. Here 100%
 * means the plan exactly matches the budget, which is the goal — so the two
 * cannot share bands. Do not "simplify" this into ratioHealth.
 */
export function planVsBudgetHealth(planned: number, budget: number): Health | null {
  if (!(budget > 0)) return null;
  return planned / budget > BUDGET_OVER_RED * (1 + RATIO_EPSILON) ? "R" : "G";
}

/** Contribution-margin health from a percent. Red below 0, Amber 0-15%, Green >=15%. */
export function marginHealth(percent: number | null): Health | null {
  if (percent === null) return null;
  if (percent < 0) return "R";
  if (percent < MARGIN_GREEN_PCT) return "A";
  return "G";
}

/** Cost-performance health from a percent (budgetCost/cost*100). R <80, A <90, G >=90. */
export function costPerformanceHealth(percent: number | null): Health | null {
  if (percent === null) return null;
  if (percent < COST_PERF_RED) return "R";
  if (percent < COST_PERF_AMBER) return "A";
  return "G";
}

/**
 * Health for the TRUE EVM cost-performance index (earned value ÷ actual cost,
 * a ratio around 1.0 — NOT a percent). Named distinctly from
 * `costPerformanceHealth` (which bands the pre-existing budgetCost/cost*100
 * "burn" ratio) so the two never collide: same direction (higher is better)
 * and the SAME band thresholds, just expressed on the 0-1 ratio scale via
 * `COST_PERF_RED`/`COST_PERF_AMBER` ÷ 100 — one source of truth for both
 * "cost performance" flavors. R <0.8, A <0.9, G >=0.9. */
export function costPerformanceIndexHealth(cpi: number | null): Health | null {
  if (cpi === null) return null;
  if (cpi < COST_PERF_RED / 100) return "R";
  if (cpi < COST_PERF_AMBER / 100) return "A";
  return "G";
}

/** Win/Loss health mirrors the consumption ratio (the two are inverse). Pass the
 *  raw `consumedValue` and `budgetValue` amounts — NOT the precomputed
 *  `winLossValue` difference from budget-report.ts. */
export function winLossHealth(consumedValue: number, budgetValue: number): Health | null {
  return ratioHealth(consumedValue, budgetValue);
}

/**
 * Margin RAG from an absolute margin amount + external (revenue) amount.
 * percent = margin / external * 100; null when external <= 0 (no revenue base).
 * Bands match marginHealth: G >= 15, A 0-15, R < 0.
 */
export function marginAmountHealth(margin: number, external: number): Health | null {
  if (!(external > 0) || !Number.isFinite(margin)) return null;
  return marginHealth((margin / external) * 100);
}

/** Per-period cell health. Identical to `ratioHealth` except that a CLOSED
 *  period which booked nothing against a real budget is Amber rather than Green:
 *  zero delivery in a period that has ended is not health, it is a signal.
 *  Dates are ISO `YYYY-MM-DD`, so lexical comparison is chronological. */
export function cellHealth(
  actual: number, budget: number, periodEnd: string, today: string,
): Health | null {
  if (!(budget > 0)) return null;
  if (actual === 0 && periodEnd < today) return "A";
  return ratioHealth(actual, budget);
}
