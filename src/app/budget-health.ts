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

/** Over-budget ratio health. Green below 90% of budget, Amber from 90% up to and
 *  including 100%, Red above 100%. null when there is no budget to compare against (budget is zero, negative, or non-finite). */
export function ratioHealth(actual: number, budget: number): Health | null {
  if (!(budget > 0)) return null;
  const r = actual / budget;
  if (r > BUDGET_OVER_RED) return "R";
  if (r >= BUDGET_OVER_AMBER) return "A";
  return "G";
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

/** Win/Loss health mirrors the consumption ratio (the two are inverse). Pass the
 *  raw `consumedValue` and `budgetValue` amounts — NOT the precomputed
 *  `winLossValue` difference from budget-report.ts. */
export function winLossHealth(consumedValue: number, budgetValue: number): Health | null {
  return ratioHealth(consumedValue, budgetValue);
}
