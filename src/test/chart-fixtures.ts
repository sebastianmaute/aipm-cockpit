// Shared burn-down chart fixtures (MR 3 addendum §5.2 / Task 11's brief test
// table) — CHART_SERIES and CHART_FORECAST are hand-built plain objects, NOT
// run through the real `computeBurndownSeries`/`computeBudgetForecast`
// engines: the numbers are chosen to exercise the chart geometry's date math
// and forecast-segment placement directly (round period boundaries, a clean
// today mid-period, an ETC that lands the forecast lines below zero). Used by
// `src/app/burndown-geometry.test.ts` (Task 11) and reused as-is by Task 12's
// SVG-renderer test so both layers assert against one set of numbers.
import type { BurndownSeries } from "../app/budget-burndown";
import type { BudgetForecast } from "../app/budget-forecast";

export const CHART_SERIES: BurndownSeries = {
  periods: ["2026-01", "2026-02", "2026-03"],
  periodStarts: ["2026-01-01", "2026-02-01", "2026-03-01"],
  periodEnds: ["2026-01-31", "2026-02-28", "2026-03-31"],
  plannedRemainingHours: [60, 30, 0],
  plannedRemainingValue: [6_000, 3_000, 0],
  actualRemainingHours: [70, 50, null],
  actualRemainingValue: [7_000, 5_000, null],
  todayIndex: 1,
  totalBudgetHours: 90,
  totalBudgetValue: 9_000,
};

export const CHART_FORECAST: BudgetForecast = {
  facts: { bac: 9_000, ac: 4_000, remaining: 5_000, ev: 3_600, percentComplete: 40 },
  pace: {
    burnRatePerDay: 200, windowDays: 20, windowStart: "2026-01-19", windowEnd: "2026-02-13", spreadPeriodHoursUsed: false,
    workingDaysLeft: 30, etc: 6_000, eac: 10_000, vac: -1_000, runOutDate: "2026-03-20", daysBeforePlannedEnd: 11,
  },
  efficiency: { pv: 4_500, cpi: 0.9, spi: 0.8, etc: 7_000, eac: 11_000, vac: -2_000 },
  gap: null,
  hasFixedPrice: false,
};

// The hours-basis twin of CHART_FORECAST — every figure divided by 100 (the
// implicit €/hour ratio baked into CHART_SERIES: 9_000 € / 90 h), so it lines
// up with CHART_SERIES's hours arrays (total 90, last actual 50 at
// "2026-02-14" in burndown orientation → cumulative-spent 40, matching
// facts.ac here for a frameDiffers === false case). Used by Task 11's
// hours-unit + forecast coverage test.
export const CHART_FORECAST_HOURS: BudgetForecast = {
  facts: { bac: 90, ac: 40, remaining: 50, ev: 36, percentComplete: 40 },
  pace: {
    burnRatePerDay: 2, windowDays: 20, windowStart: "2026-01-19", windowEnd: "2026-02-13", spreadPeriodHoursUsed: false,
    workingDaysLeft: 30, etc: 60, eac: 100, vac: -10, runOutDate: "2026-03-20", daysBeforePlannedEnd: 11,
  },
  efficiency: { pv: 45, cpi: 0.9, spi: 0.8, etc: 70, eac: 110, vac: -20 },
  gap: null,
  hasFixedPrice: false,
};
