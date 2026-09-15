/**
 * Budget forecast (spec 2026-09-14-budget-forecast-union-design.md §5). Pure and
 * i18n-free. Two named forecasts from one set of facts:
 * - current pace — the value booked per working day over the last
 *   BURN_RATE_WINDOW_WORKING_DAYS working days, carried to the plan end;
 * - current efficiency — ETC = (BAC − EV) ÷ CPI.
 * Money is EUR, on the contract basis (BAC = `budgetValue`), never internal cost.
 */
import { calendarDaysBetween, countWorkingDays, addCalendarDays, isWorkingDay, nthWorkingDayAfter, workingDaysBefore } from "./working-days";

export const BURN_RATE_WINDOW_WORKING_DAYS = 20;
export const FORECAST_GAP_WARNING_RATIO = 0.10;
export const PACE_VAC_RED_RATIO = 0.10;

export type PaceForecast = {
  burnRatePerDay: number; windowDays: number; windowStart: string; windowEnd: string;
  spreadPeriodHoursUsed: boolean; workingDaysLeft: number;
  etc: number; eac: number; vac: number; runOutDate: string | null; daysBeforePlannedEnd: number | null;
};
export type PaceUnavailable =
  | { unavailable: "not-enough-bookings"; firstBookingDate: string | null; bookedWorkingDays: number; availableFrom: string | null }
  | { unavailable: "no-burn"; windowStart: string; windowEnd: string; lastBookingDate: string | null };
export type EfficiencyForecast = { pv: number; cpi: number; spi: number | null; etc: number; eac: number; vac: number };
export type EfficiencyUnavailable =
  | { unavailable: "needs-percent-complete"; bucketsMissingPercent: readonly { id: number; name: string }[] }
  | { unavailable: "no-actual-cost" }
  | { unavailable: "no-earned-value" };
export type ForecastGap = { eacDifference: number; percentOfBac: number; severity: "info" | "warning"; extraWorkingDays: number | null };
export type BudgetForecast = {
  facts: { bac: number; ac: number; remaining: number; ev: number | null; percentComplete: number | null };
  pace: PaceForecast | PaceUnavailable;
  efficiency: EfficiencyForecast | EfficiencyUnavailable;
  gap: ForecastGap | null;
  hasFixedPrice: boolean;
};
export type DatedValue = { date: string; bookedFrom: string; value: number; spread: boolean };
export type ForecastFacts = {
  bac: number; ac: number; ev: number | null; pv: number;
  bucketsMissingPercent: readonly { id: number; name: string }[];
  dated: readonly DatedValue[];
  planEnd: string; today: string; holidaySet: ReadonlySet<string>; hasFixedPrice: boolean;
};

export function isPaceAvailable(p: BudgetForecast["pace"]): p is PaceForecast {
  return !("unavailable" in p);
}

export function isEfficiencyAvailable(e: BudgetForecast["efficiency"]): e is EfficiencyForecast {
  return !("unavailable" in e);
}

function pace(f: ForecastFacts): PaceForecast | PaceUnavailable {
  const { today, holidaySet: hs } = f;
  const booked = f.dated;
  const first = booked.reduce<string | null>((m, d) => (m === null || d.bookedFrom < m ? d.bookedFrom : m), null);
  const bookedWorkingDays = first === null ? 0 : countWorkingDays(first, today, hs);
  if (bookedWorkingDays < BURN_RATE_WINDOW_WORKING_DAYS) {
    let availableFrom: string | null = null;
    if (first !== null) {
      const start = isWorkingDay(first, hs) ? first : nthWorkingDayAfter(first, 1, hs);
      const last = nthWorkingDayAfter(start, BURN_RATE_WINDOW_WORKING_DAYS - 1, hs);
      availableFrom = nthWorkingDayAfter(last, 1, hs);
    }
    return { unavailable: "not-enough-bookings", firstBookingDate: first, bookedWorkingDays, availableFrom };
  }
  const window = workingDaysBefore(today, BURN_RATE_WINDOW_WORKING_DAYS, hs);
  const inWindow = new Set(window);
  const windowStart = window[0];
  const windowEnd = window[window.length - 1];
  let windowValue = 0;
  let spreadPeriodHoursUsed = false;
  for (const d of booked) {
    if (!inWindow.has(d.date)) continue;
    windowValue += d.value;
    if (d.spread) spreadPeriodHoursUsed = true;
  }
  if (windowValue <= 0) {
    const lastBookingDate = booked.reduce<string | null>((m, d) => (d.date < today && (m === null || d.date > m) ? d.date : m), null);
    return { unavailable: "no-burn", windowStart, windowEnd, lastBookingDate };
  }
  const burnRatePerDay = windowValue / BURN_RATE_WINDOW_WORKING_DAYS;
  const workingDaysLeft = countWorkingDays(addCalendarDays(today, 1), addCalendarDays(f.planEnd, 1), hs);
  const etc = burnRatePerDay * workingDaysLeft;
  const eac = f.ac + etc;
  const remaining = f.bac - f.ac;
  const runOutDate = remaining <= 0 ? null : nthWorkingDayAfter(today, Math.ceil(remaining / burnRatePerDay), hs);
  return {
    burnRatePerDay, windowDays: BURN_RATE_WINDOW_WORKING_DAYS, windowStart, windowEnd, spreadPeriodHoursUsed,
    workingDaysLeft, etc, eac, vac: f.bac - eac, runOutDate,
    daysBeforePlannedEnd: runOutDate === null ? null : calendarDaysBetween(runOutDate, f.planEnd),
  };
}

function efficiency(f: ForecastFacts): EfficiencyForecast | EfficiencyUnavailable {
  if (f.ev === null) return { unavailable: "needs-percent-complete", bucketsMissingPercent: f.bucketsMissingPercent };
  if (f.ac === 0) return { unavailable: "no-actual-cost" };
  if (f.ev === 0) return { unavailable: "no-earned-value" };
  const cpi = f.ev / f.ac;
  const etc = (f.bac - f.ev) / cpi;
  const eac = f.ac + etc;
  return { pv: f.pv, cpi, spi: f.pv === 0 ? null : f.ev / f.pv, etc, eac, vac: f.bac - eac };
}

export function forecastGap(p: PaceForecast, e: EfficiencyForecast, bac: number): ForecastGap {
  const eacDifference = Math.abs(e.eac - p.eac);
  const percentOfBac = bac > 0 ? eacDifference / bac : 0;
  const extra = Math.ceil(e.etc / p.burnRatePerDay) - p.workingDaysLeft;
  return {
    eacDifference, percentOfBac,
    severity: percentOfBac >= FORECAST_GAP_WARNING_RATIO ? "warning" : "info",
    extraWorkingDays: extra > 0 ? extra : null,
  };
}

export function paceVacHealth(vac: number, bac: number): "R" | "A" | "G" | null {
  if (bac <= 0) return null;
  if (vac >= 0) return "G";
  return -vac / bac >= PACE_VAC_RED_RATIO ? "R" : "A";
}

export function computeForecastFromFacts(f: ForecastFacts): BudgetForecast {
  const p = pace(f);
  const e = efficiency(f);
  return {
    facts: {
      bac: f.bac, ac: f.ac, remaining: f.bac - f.ac, ev: f.ev,
      percentComplete: f.ev === null || f.bac <= 0 ? null : (f.ev / f.bac) * 100,
    },
    pace: p,
    efficiency: e,
    gap: isPaceAvailable(p) && isEfficiencyAvailable(e) ? forecastGap(p, e, f.bac) : null,
    hasFixedPrice: f.hasFixedPrice,
  };
}
