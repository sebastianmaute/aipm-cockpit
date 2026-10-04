// A hand-built `ForecastBundle` for export tests (open-followups §545): both
// forecasts available, a warning-level gap, and a rate mix with no driver.
import type { BudgetForecast } from "../app/budget-forecast";
import type { ForecastBundle } from "../app/budget-forecast-bundle";
import type { RateMix } from "../app/budget-rate-mix";

type AvailablePace = Extract<BudgetForecast["pace"], { eac: number }>;

export const FIXTURE_EUR_FORECAST: BudgetForecast = {
  facts: { bac: 20000, ac: 9000, remaining: 11000, ev: 7000, percentComplete: 35 },
  pace: {
    burnRatePerDay: 300, windowDays: 20, windowStart: "2026-06-01", windowEnd: "2026-06-30",
    spreadPeriodHoursUsed: false, workingDaysLeft: 40,
    etc: 12000, eac: 21000, vac: -1000, runOutDate: "2026-08-20", daysBeforePlannedEnd: 5,
  },
  efficiency: { pv: 8000, cpi: 0.78, spi: 0.9, etc: 16000, eac: 25000, vac: -5000 },
  gap: { eacDifference: 4000, percentOfBac: 0.2, severity: "warning", extraWorkingDays: null },
  hasFixedPrice: false,
};

export const FIXTURE_HOURS_FORECAST: BudgetForecast = {
  ...FIXTURE_EUR_FORECAST,
  facts: { ...FIXTURE_EUR_FORECAST.facts, bac: 200, ac: 90, remaining: 110 },
  pace: { ...(FIXTURE_EUR_FORECAST.pace as AvailablePace), eac: 210, vac: -10 },
  efficiency: { pv: 80, cpi: 0.78, spi: 0.9, etc: 160, eac: 250, vac: -50 },
};

export const FIXTURE_RATE_MIX = {
  triggered: false, direction: null, severity: null,
  drift: 0, bookedRate: 105, plannedRate: 105, budgetHours: 200, actualHours: 90,
  budgetValue: 21000, bookedValue: 9450, rows: [], driver: null, excludedActualHours: 0,
} as unknown as RateMix;

export function forecastBundleFixture(over: Partial<ForecastBundle> = {}): ForecastBundle {
  return {
    eur: FIXTURE_EUR_FORECAST, hours: FIXTURE_HOURS_FORECAST, mix: FIXTURE_RATE_MIX,
    evHistory: { available: true, points: [] }, history: null, ...over,
  } as ForecastBundle;
}
