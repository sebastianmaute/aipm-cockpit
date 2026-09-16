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

export type ForecastFactsByUnit = { eur: ForecastFacts; hours: ForecastFacts };

/**
 * One walk, two units (MR 3 addendum §3.1). € facts are exactly what
 * `forecastFacts` has always returned. Hours facts:
 * - BAC h = `report.project.budgetHours`, AC h = `report.project.actualHours`;
 * - EV h = Σ `br.ownBudget.budgetHours` × percent complete — the same OWN-budget
 *   basis BAC h sums (§550), so EV h ÷ BAC h = EV € ÷ BAC €. ★ Ruling 1 (MR 3)
 *   specified the REPORTED, spillover-inclusive basis here and is SUPERSEDED:
 *   it held only while BAC was spillover-inclusive too, and once §550 made BAC
 *   own-basis it let ΣEV exceed BAC. See the call site for the measurement;
 * - PV h from the burn-down hours series at `todayIndex`;
 * - dated values are hours, from the same day-key / spread-period rules.
 *
 * AC (§5.4/Ruling 1): per bucket, T&M → `BucketReport.consumedValue`
 * (external-EUR basis, already report-consistent); fixed price → the
 * UNCAPPED contract ratio `contract × actualHours ÷ budgetHours`, so an
 * overrun shows (the report's own `consumedValue` is capped at the contract
 * amount and must never be reused here).
 * EV (Ruling 2, re-based by §550): `Σ ownBudget.budgetValue ×
 * bucketPercentComplete(bucket, tasks) ÷ 100` over buckets with
 * `ownBudget.budgetValue > 0`; null (with the naming list) the moment any such
 * bucket has no resolvable percent complete. Ruling 2's SHAPE is unchanged —
 * only the basis moved from the reported budget value to the own one, in step
 * with BAC.
 * PV (Ruling 3): `totalBudgetValue − plannedRemainingValue[todayIndex]` of
 * the burn-down, 0 when `todayIndex === -1`.
 * Dated bookings (Ruling 4): only keys the report itself counts — a day key
 * whose owning period is active, or a period key at the live granularity
 * that is active, spread evenly over its working days (or placed on its
 * first calendar day when it has none). An entry with hours ≤ 0 carries no
 * booking date at all (excluded from `dated`).
 */
export function forecastFactsByUnit(input: BudgetForecastInput): ForecastFactsByUnit {
  const { report, buckets, roles, fxRates, tasks, plan, burndown, holidaySet, today } = input;
  const reportById = new Map(report.buckets.map((r) => [r.bucketId, r]));
  const datedEur: DatedValue[] = [];
  const datedHours: DatedValue[] = [];
  const bucketsMissingPercent: { id: number; name: string }[] = [];
  let ac = 0;
  let ev = 0;
  let evHours = 0;
  let hasFixedPrice = false;
  for (const bucket of buckets) {
    const br = reportById.get(bucket.id);
    if (!br) continue;
    const isFixed = bucket.type === "fixed";
    hasFixedPrice ||= isFixed;
    // §5.4: the uncapped contract ratio, so a fixed-price overrun shows.
    // ★ Review finding 1: `br.budgetHours` is `computeBucketReport`'s REPORTED
    // budget hours, i.e. own hours PLUS `spilloverInHours` rolled in from a
    // closed predecessor. The report's OWN fixed-price ratio (`consumedValue`)
    // and its `budgetValue` are built from OWN hours only — spillover never
    // inflates a fixed-price bucket's denominator there. Dividing by the
    // spillover-inflated total here would understate the ratio (and, with a
    // negative spillover, could even zero AC out) relative to the report this
    // is meant to mirror.
    // ★ This used to hand-derive `br.budgetHours - br.spilloverInHours`. It now
    // reads the report's own field so there is ONE definition of own budget in
    // the codebase — see `OwnBudgetFigures` in budget-report.ts, which also
    // explains why that subtraction is NOT valid for value.
    const ownBudgetHours = br.ownBudget.budgetHours;
    const fixedPerHour = isFixed && ownBudgetHours > 0
      ? currencyToEur(bucket.fixedPriceAmount ?? 0, bucket, fxRates) / ownBudgetHours
      : 0;
    ac += isFixed ? fixedPerHour * br.actualHours : br.consumedValue;
    // ★★★ OWN budget, in BOTH units. Ruling 1 (MR 3) said the opposite — EV on
    // the REPORTED, spillover-inclusive basis — and it is SUPERSEDED by the
    // §550 project-rollup fix, not worked around.
    //
    // Ruling 1 was sound while BAC was itself the sum of the reported per-bucket
    // budgets: both sides carried a closed predecessor's remainder twice, so the
    // EV ÷ BAC ratio still came out right. §550 fixed BAC to sum each bucket's
    // OWN budget (the remainder is a REALLOCATION, not new scope), which left EV
    // as the only spillover-inclusive term and broke the one invariant that must
    // never break: ΣEV ≤ BAC. Measured on a two-bucket fixture, both buckets
    // 100% complete, predecessor closed: EV € 26000 against BAC € 20000 — a
    // finished project reporting 130% complete, SPI 1.3, a NEGATIVE ETC of
    // −1615 and an EAC of 5385 BELOW the 7000 already spent.
    //
    // ★★ The gate is `ownBudget.budgetValue`, the same quantity EV now derives
    // from. Gating on the reported value instead would demand a percent-complete
    // from a bucket holding nothing but spilled-in budget — one that contributes
    // exactly 0 to EV — and blank the project's whole EV when it has none.
    // Mirrors `evRelevant`'s `budgetCost > 0` gate in budget-report.ts: gate on
    // what you divide, not on a neighbouring figure.
    if (br.ownBudget.budgetValue > 0) {
      const pct = bucketPercentComplete(bucket, tasks);
      if (pct === null) {
        bucketsMissingPercent.push({ id: bucket.id, name: bucket.name });
      } else {
        ev += (br.ownBudget.budgetValue * pct) / 100;
        evHours += (br.ownBudget.budgetHours * pct) / 100;
      }
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
            datedEur.push({ date: key, bookedFrom: key, value: hours * perHour, spread: false });
            datedHours.push({ date: key, bookedFrom: key, value: hours, spread: false });
          }
          continue;
        }
        if (granularityOfPeriodKey(key) !== plan.granularity || !active.has(key)) continue;
        const bounds = periodBounds(key);
        if (!bounds) continue;
        const days = workingDaysInRange(bounds.start, bounds.end, holidaySet);
        if (days.length === 0) {
          datedEur.push({ date: bounds.start, bookedFrom: bounds.start, value: hours * perHour, spread: true });
          datedHours.push({ date: bounds.start, bookedFrom: bounds.start, value: hours, spread: true });
          continue;
        }
        // € keeps its exact original expression so existing € pins stay bit-identical.
        const eachEur = (hours * perHour) / days.length;
        const eachHours = hours / days.length;
        for (const d of days) {
          datedEur.push({ date: d, bookedFrom: bounds.start, value: eachEur, spread: true });
          datedHours.push({ date: d, bookedFrom: bounds.start, value: eachHours, spread: true });
        }
      }
    }
  }
  const at = burndown.todayIndex;
  const pv = at >= 0 ? burndown.totalBudgetValue - burndown.plannedRemainingValue[at] : 0;
  const pvHours = at >= 0 ? burndown.totalBudgetHours - burndown.plannedRemainingHours[at] : 0;
  const missing = bucketsMissingPercent.length > 0;
  const common = { bucketsMissingPercent, planEnd: plan.endDate, today, holidaySet, hasFixedPrice };
  return {
    eur: { bac: report.project.budgetValue, ac, ev: missing ? null : ev, pv, dated: datedEur, ...common },
    hours: {
      bac: report.project.budgetHours, ac: report.project.actualHours, ev: missing ? null : evHours, pv: pvHours,
      dated: datedHours, ...common,
    },
  };
}

export function forecastFacts(input: BudgetForecastInput): ForecastFacts {
  return forecastFactsByUnit(input).eur;
}

export function computeBudgetForecast(input: BudgetForecastInput): BudgetForecast {
  return computeForecastFromFacts(forecastFacts(input));
}

export function computeBudgetForecastsByUnit(input: BudgetForecastInput): { eur: BudgetForecast; hours: BudgetForecast } {
  const facts = forecastFactsByUnit(input);
  return { eur: computeForecastFromFacts(facts.eur), hours: computeForecastFromFacts(facts.hours) };
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
