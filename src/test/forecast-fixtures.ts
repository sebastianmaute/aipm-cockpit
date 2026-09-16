// Shared forecast fixtures for MR 3 UI tests — the spec §7 scenarios.
// EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE, HOURS_FORECAST_EUR_WORSE and
// BUNDLE_HOURS_WORSE (its eur/hours members) go through the real
// `computeForecastFromFacts` engine, so every figure on those is one the
// engine can produce. MIX_HOURS_WORSE, MIX_EUR_WORSE and MIX_ON_PLAN are
// hand-built `RateMix` values (not run through `computeRateMix`) — their
// rows are constructed directly so the driver/signal/rate arithmetic in the
// text-builder tests can be pinned against known numbers.
import { computeForecastFromFacts, type BudgetForecast, type DatedValue, type ForecastFacts } from "../app/budget-forecast";
import { workingDaysBefore } from "../app/working-days";
import type { RateMix, RateMixRow } from "../app/budget-rate-mix";
import type { EvHistory } from "../app/budget-ev-history";
import type { ForecastBundle } from "../app/budget-forecasts";

const none = new Set<string>();
const day = (date: string, value: number): DatedValue => ({ date, bookedFrom: date, value, spread: false });
function facts(bac: number, ac: number, ev: number, pv: number, windowValue: number): ForecastFacts {
  return {
    bac, ac, ev, pv, bucketsMissingPercent: [],
    dated: [day("2026-01-05", ac - windowValue), ...workingDaysBefore("2026-09-14", 20, none).map((d) => day(d, windowValue / 20))],
    planEnd: "2026-12-18", today: "2026-09-14", holidaySet: none, hasFixedPrice: false,
  };
}

export const EUR_FORECAST: BudgetForecast = computeForecastFromFacts(facts(240_000, 168_000, 148_800, 176_000, 27_000));
export const HOURS_FORECAST_HOURS_WORSE: BudgetForecast = computeForecastFromFacts(facts(2_000, 1_450, 1_240, 176_000 / 120, 220));
export const HOURS_FORECAST_EUR_WORSE: BudgetForecast = computeForecastFromFacts(facts(2_000, 1_350, 1_240, 176_000 / 120, 205));

function row(id: number, name: string, rate: number, budget: number, booked: number, totalBooked: number): RateMixRow {
  const plannedShare = budget / 2_000;
  const bookedShare = booked / totalBooked;
  return {
    key: `role:${id}`, kind: "role", id, name, plannedRate: rate, budgetHours: budget, actualHours: booked,
    plannedShare, bookedShare, difference: bookedShare - plannedShare, usedOfBudget: booked / budget,
  };
}
function mixOf(booked: [number, number, number], signal: Pick<RateMix, "triggered" | "direction" | "severity">, driverIndex: number | null): RateMix {
  const total = booked[0] + booked[1] + booked[2];
  const rows = [
    row(1, "Consultant Senior", 150, 600, booked[0], total),
    row(2, "Consultant Regular", 120, 800, booked[1], total),
    row(3, "Consultant Junior", 90, 600, booked[2], total),
  ];
  return {
    drift: (168_000 / total) / 120 - 1, bookedRate: 168_000 / total, plannedRate: 120,
    budgetHours: 2_000, actualHours: total, budgetValue: 240_000, bookedValue: 168_000,
    // No fixed-price bucket in the §7 scenarios, so the scope disclosure is off
    // on all three; a test that wants it spreads a non-zero over the fixture.
    excludedActualHours: 0,
    rows, driver: driverIndex === null ? null : rows[driverIndex], ...signal,
  };
}

export const MIX_HOURS_WORSE: RateMix = mixOf([339, 572, 539], { triggered: true, direction: "hours-worse", severity: "warning" }, 2);
export const MIX_EUR_WORSE: RateMix = mixOf([505, 540, 305], { triggered: true, direction: "eur-worse", severity: "info" }, 0);
export const MIX_ON_PLAN: RateMix = mixOf([420, 560, 420], { triggered: false, direction: null, severity: null }, null);

export const EV_HISTORY: EvHistory = {
  available: true,
  points: [
    { date: "2026-03-31", eur: 60_000, hours: 500 },
    { date: "2026-06-30", eur: 110_000, hours: 917 },
    { date: "2026-09-14", eur: 148_800, hours: 1_240 },
  ],
};

export const BUNDLE_HOURS_WORSE: ForecastBundle = {
  eur: EUR_FORECAST, hours: HOURS_FORECAST_HOURS_WORSE, mix: MIX_HOURS_WORSE, evHistory: EV_HISTORY,
};
