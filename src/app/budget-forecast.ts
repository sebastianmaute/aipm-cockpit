/**
 * Budget forecast (spec 2026-09-14-budget-forecast-union-design.md §5). Pure and
 * i18n-free. Two named forecasts from one set of facts:
 * - current pace — the value booked per working day over the last
 *   BURN_RATE_WINDOW_WORKING_DAYS working days, carried to the plan end;
 * - current efficiency — ETC = (BAC − EV) ÷ CPI.
 * Money is EUR, on the contract basis (BAC = `budgetValue`), never internal cost.
 */
import {
  calendarDaysBetween, countWorkingDays, addCalendarDays, isWorkingDay, nthWorkingDayAfter, workingDaysBefore,
  periodBounds, workingDaysInRange,
} from "./working-days";
import { computeBudgetReport, bucketActivePeriods, bucketRateRows, type BudgetReport } from "./budget-report";
import { computeBurndownSeries, type BurndownSeries } from "./budget-burndown";
import { resolveBucketChain } from "./budget-bucket-chain";
import { bucketPercentComplete } from "./budget-earned-value";
import { currencyToEur } from "./fx";
import { periodKeyForDate } from "./resource-capacity";
import { isDayKey, granularityOfPeriodKey } from "./actual-hours";
import type { Absence, BudgetBucket, FxRates, ResourcePlan, Resource, Role, Task } from "./types";

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
    // §5.2: "latest date carrying actual hours" — for a spread period entry
    // that is its `bookedFrom` (period start), never the last WORKING day the
    // spread loop happens to land the value on (a month total entered per
    // period must not read as "Last booking: <last working day>"). Mirrors
    // `first` above, which already uses `bookedFrom`.
    const lastBookingDate = booked.reduce<string | null>((m, d) => (d.bookedFrom < today && (m === null || d.bookedFrom > m) ? d.bookedFrom : m), null);
    return { unavailable: "no-burn", windowStart, windowEnd, lastBookingDate };
  }
  const burnRatePerDay = windowValue / BURN_RATE_WINDOW_WORKING_DAYS;
  const workingDaysLeft = countWorkingDays(addCalendarDays(today, 1), addCalendarDays(f.planEnd, 1), hs);
  const etc = burnRatePerDay * workingDaysLeft;
  const eac = f.ac + etc;
  const remaining = f.bac - f.ac;
  // Tolerance-safe ceil: a float division that lands exactly on an integer can
  // drift to n+epsilon (e.g. remaining = burn × 54 → remaining/burn =
  // 54.00000000000001), which would report one extra working day.
  const runOutDate = remaining <= 0 ? null : nthWorkingDayAfter(today, Math.ceil(remaining / burnRatePerDay - 1e-9), hs);
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

export function forecastGap(p: PaceForecast, e: EfficiencyForecast, bac: number): ForecastGap | null {
  // A non-positive burn rate has no meaningful "extra working days" (division
  // by zero or a sign flip), so there is nothing to compare — null, not a
  // fabricated figure.
  if (p.burnRatePerDay <= 0) return null;
  const eacDifference = Math.abs(e.eac - p.eac);
  const percentOfBac = bac > 0 ? eacDifference / bac : 0;
  // Tolerance-safe ceil — see the matching comment on `runOutDate` above.
  const extra = Math.ceil(e.etc / p.burnRatePerDay - 1e-9) - p.workingDaysLeft;
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

// ---------------------------------------------------------------------------
// Assembler — turns the existing BudgetReport, buckets, rate rows and
// burn-down series into ForecastFacts, per spec §5.1–§5.4.

export type BudgetForecastInput = {
  report: BudgetReport; buckets: readonly BudgetBucket[]; roles: readonly Role[]; fxRates: FxRates | null;
  tasks: readonly Pick<Task, "id" | "status">[]; plan: ResourcePlan; burndown: BurndownSeries;
  holidaySet: ReadonlySet<string>; today: string;
};

/**
 * Builds `ForecastFacts` from a live `BudgetReport` + rate rows + burn-down
 * series (§5.1–§5.4):
 * - AC (§5.4/Ruling 1): per bucket, T&M → `BucketReport.consumedValue`
 *   (external-EUR basis, already report-consistent); fixed price → the
 *   UNCAPPED contract ratio `contract × actualHours ÷ budgetHours`, so an
 *   overrun shows (the report's own `consumedValue` is capped at the contract
 *   amount and must never be reused here).
 * - EV (Ruling 2): `Σ budgetValue × bucketPercentComplete(bucket, tasks) ÷ 100`
 *   over buckets with `budgetValue > 0`; null (with the naming list) the
 *   moment any such bucket has no resolvable percent complete.
 * - PV (Ruling 3): `totalBudgetValue − plannedRemainingValue[todayIndex]` of
 *   the burn-down, 0 when `todayIndex === -1`.
 * - Dated bookings (Ruling 4): only keys the report itself counts — a day key
 *   whose owning period is active, or a period key at the live granularity
 *   that is active, spread evenly over its working days (or placed on its
 *   first calendar day when it has none). An entry with hours ≤ 0 carries no
 *   booking date at all (excluded from `dated`).
 */
export function forecastFacts(input: BudgetForecastInput): ForecastFacts {
  const { report, buckets, roles, fxRates, tasks, plan, burndown, holidaySet, today } = input;
  const reportById = new Map(report.buckets.map((r) => [r.bucketId, r]));
  const dated: DatedValue[] = [];
  const bucketsMissingPercent: { id: number; name: string }[] = [];
  let ac = 0;
  let ev = 0;
  let hasFixedPrice = false;
  for (const bucket of buckets) {
    const br = reportById.get(bucket.id);
    if (!br) continue;
    const isFixed = bucket.type === "fixed";
    hasFixedPrice ||= isFixed;
    // §5.4: the uncapped contract ratio, so a fixed-price overrun shows.
    // ★ Review finding 1: `br.budgetHours` is `computeBucketReport`'s REPORTED
    // budget hours, i.e. own hours PLUS `spilloverInHours` rolled in from a
    // closed predecessor (budget-report.ts `reportedBudgetHours`). The report's
    // OWN fixed-price ratio (`consumedValue`, budget-report.ts ~362-364) and its
    // `budgetValue` (~359-361) are built from OWN hours only — spillover never
    // inflates a fixed-price bucket's denominator there. Dividing by the
    // spillover-inflated total here would understate the ratio (and, with a
    // negative spillover, could even zero AC out) relative to the report this
    // is meant to mirror. Subtract spillover back out to recover the same "own
    // hours" the report itself divides by.
    const ownBudgetHours = br.budgetHours - br.spilloverInHours;
    const fixedPerHour = isFixed && ownBudgetHours > 0
      ? currencyToEur(bucket.fixedPriceAmount ?? 0, bucket, fxRates) / ownBudgetHours
      : 0;
    ac += isFixed ? fixedPerHour * br.actualHours : br.consumedValue;
    if (br.budgetValue > 0) {
      const pct = bucketPercentComplete(bucket, tasks);
      if (pct === null) bucketsMissingPercent.push({ id: bucket.id, name: bucket.name });
      else ev += (br.budgetValue * pct) / 100;
    }
    const active = new Set(bucketActivePeriods(bucket, plan).map((p) => p.key));
    for (const row of bucketRateRows(bucket, roles)) {
      const perHour = isFixed ? fixedPerHour : row.rates.external;
      for (const [key, hours] of Object.entries(row.actualHours)) {
        // Ruling 4: hours ≤ 0 carry no booking date at all — a negative hand
        // correction is therefore excluded from the dated window BY DESIGN, so
        // Σ dated can legitimately differ from AC (`br.consumedValue`, which
        // still includes it) whenever negatives are present.
        if (!(hours > 0)) continue;
        if (isDayKey(key)) {
          if (active.has(periodKeyForDate(key, plan.granularity))) {
            dated.push({ date: key, bookedFrom: key, value: hours * perHour, spread: false });
          }
          continue;
        }
        if (granularityOfPeriodKey(key) !== plan.granularity || !active.has(key)) continue;
        const bounds = periodBounds(key);
        if (!bounds) continue;
        const days = workingDaysInRange(bounds.start, bounds.end, holidaySet);
        if (days.length === 0) {
          dated.push({ date: bounds.start, bookedFrom: bounds.start, value: hours * perHour, spread: true });
          continue;
        }
        const each = (hours * perHour) / days.length;
        for (const d of days) dated.push({ date: d, bookedFrom: bounds.start, value: each, spread: true });
      }
    }
  }
  const pv = burndown.todayIndex >= 0 ? burndown.totalBudgetValue - burndown.plannedRemainingValue[burndown.todayIndex] : 0;
  return {
    bac: report.project.budgetValue, ac, ev: bucketsMissingPercent.length > 0 ? null : ev, pv,
    bucketsMissingPercent, dated, planEnd: plan.endDate, today, holidaySet, hasFixedPrice,
  };
}

export function computeBudgetForecast(input: BudgetForecastInput): BudgetForecast {
  return computeForecastFromFacts(forecastFacts(input));
}

export type ProjectForecastArgs = {
  buckets: readonly BudgetBucket[]; plan: ResourcePlan; roles: readonly Role[]; resources: readonly Resource[];
  workdayHours: number; holidaySet: ReadonlySet<string>; absences: readonly Absence[];
  tasks: readonly Pick<Task, "id" | "status">[]; fxRates: FxRates | null; today: string;
};

/** Builds report, bucket chain and burn-down the way `budget-report-panel.tsx`
 *  does; null without buckets — there is nothing to forecast. */
export function computeProjectForecast(a: ProjectForecastArgs): BudgetForecast | null {
  if (a.buckets.length === 0) return null;
  const report = computeBudgetReport(a.buckets, a.plan, a.roles, a.resources, a.workdayHours, a.holidaySet, a.absences, [], a.fxRates);
  const chain = resolveBucketChain(a.buckets, { start: a.plan.startDate, end: a.plan.endDate });
  const burndown = computeBurndownSeries(
    a.buckets, a.plan, a.roles, a.resources, a.workdayHours, a.holidaySet, a.absences, a.today, a.fxRates,
    chain.kind === "chain" ? { start: chain.start, end: chain.end } : undefined,
  );
  return computeBudgetForecast({
    report, buckets: a.buckets, roles: a.roles, fxRates: a.fxRates, tasks: a.tasks, plan: a.plan, burndown,
    holidaySet: a.holidaySet, today: a.today,
  });
}
