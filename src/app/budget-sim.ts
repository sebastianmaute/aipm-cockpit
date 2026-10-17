/**
 * The budget simulation on the forecast bundle (§502 part 3) — pure, i18n-free, React-free.
 *
 * Reads the ONE shared schedule run (`computeAppForecast`) and the pace forecast's own facts:
 * each trial's finish day draws that many working days of spend from the run's history window,
 * so the cost range and the finish dates come from the same 10,000 trials. `ac`, `bac` and the
 * dated values are the pace forecast's, already in the baseline currency (§476), never converted
 * again. Nothing here feeds the Budget health dot: `paceVacHealth` keeps reading the pace figure.
 */
import type { ForecastFacts, ForecastFactsByUnit } from "./budget-forecast";
import type { ForecastBundle } from "./budget-forecast-bundle";
import type { AppForecast } from "./forecast/app-forecast";
import { MAX_HORIZON_WORKING_DAYS, MIN_SPEND_WORKING_DAYS } from "./forecast/constants";
import { simulateCostAtFinish, spendSamples, type CostAtFinish } from "./forecast/cost";

export type BudgetSim = {
  /** Schedule finish dates from the same run (null = beyond the horizon). */
  finish: { p50: string | null; p80: string | null; p95: string | null };
  eur: CostAtFinish;
  hours: CostAtFinish;
};

/** The cost range when the schedule run is below its history floor (no trials to pair spend with). */
export const BELOW_SCHEDULE_FLOOR: CostAtFinish = {
  kind: "unavailable", reason: "schedule-floor", spendDays: 0, neededSpendDays: MIN_SPEND_WORKING_DAYS,
};

let memo: { forecast: AppForecast; facts: ForecastFactsByUnit; result: BudgetSim } | null = null;

/** One unit's cost range from a schedule run: each trial's finish day draws spend from the run's own
 *  history window. Shared with the Forecast view, which passes its What-if-adjusted run and its What-if
 *  capacity as `spendScale` (capacityPercent / 100); the bundle passes nothing (default 1). */
export function simulateCostFromRun(
  run: { trialDays: Int32Array; windowDates: readonly string[] }, f: ForecastFacts, seedTag: string, spendScale = 1,
): CostAtFinish {
  return simulateCostAtFinish({
    trialDays: run.trialDays,
    samples: spendSamples(f.dated, run.windowDates),
    ac: f.ac,
    bac: f.bac,
    seedTag,
    horizon: MAX_HORIZON_WORKING_DAYS,
    spendScale,
  });
}

let runMemo: {
  trialDays: Int32Array; windowDates: readonly string[]; f: ForecastFacts; seedTag: string; spendScale: number; result: CostAtFinish;
} | null = null;

function sameValues<T>(a: ArrayLike<T>, b: ArrayLike<T>): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** `simulateCostFromRun` with a single-entry memo keyed on the run's trial days and window dates BY VALUE
 *  (plus the facts' identity, the seed tag and the scale). The Forecast view rebuilds its run on a How-many
 *  target change, but the target draws from its own stream and leaves every trial day as it was, so the
 *  cost pass (about 13 to 110 ms) is not run again. Comparing 10,000 ints costs far less than the pass. */
export function simulateCostFromRunMemo(
  run: { trialDays: Int32Array; windowDates: readonly string[] }, f: ForecastFacts, seedTag: string, spendScale = 1,
): CostAtFinish {
  if (runMemo && runMemo.f === f && runMemo.seedTag === seedTag && runMemo.spendScale === spendScale
    && sameValues(runMemo.trialDays, run.trialDays) && sameValues(runMemo.windowDates, run.windowDates)) {
    return runMemo.result;
  }
  const result = simulateCostFromRun(run, f, seedTag, spendScale);
  runMemo = { trialDays: run.trialDays, windowDates: run.windowDates, f, seedTag, spendScale, result };
  return result;
}

/** null when the schedule run is absent (simulation off). Below the schedule floor both units are
 *  { kind: "unavailable", reason: "schedule-floor" } and `finish` is all null. Single-entry memo
 *  keyed by `forecast` and `facts` identity, as `computeAppForecast`. */
export function computeBudgetSim(forecast: AppForecast | null, facts: ForecastFactsByUnit): BudgetSim | null {
  if (forecast === null) return null;
  if (memo && memo.forecast === forecast && memo.facts === facts) return memo.result;
  const result: BudgetSim = forecast.kind === "forecast"
    ? {
        finish: { p50: forecast.p50, p80: forecast.p80, p95: forecast.p95 },
        eur: simulateCostFromRun(forecast, facts.eur, "eur"),
        hours: simulateCostFromRun(forecast, facts.hours, "hours"),
      }
    : { finish: { p50: null, p80: null, p95: null }, eur: BELOW_SCHEDULE_FLOOR, hours: BELOW_SCHEDULE_FLOOR };
  memo = { forecast, facts, result };
  return result;
}

/** The signature of everything the budget simulation changes in the burn tile's HEIGHT: whether it is on,
 *  whether a finish band is drawn, and per unit which line the tile shows (the range with or without the
 *  chance, or which missing-input reason). Both units, so a unit switch needs no extra input.
 *  `useMeasuredHeights` has no ResizeObserver, so a state missing here leaves the tile at a stale height. */
export function budgetSimContentKey(sim: BudgetSim | null | undefined): string {
  if (sim == null) return "bs:off";
  const unit = (c: CostAtFinish) => (c.kind === "sim" ? `sim:${c.chanceOverBudget !== null}:${c.p80 === "beyond"}` : c.reason);
  return `bs:${sim.finish.p50 !== null}:${unit(sim.eur)}:${unit(sim.hours)}`;
}

/** A NEW bundle with `sim` set; the input bundle is never mutated. */
export function withBudgetSim(bundle: ForecastBundle, forecast: AppForecast | null): ForecastBundle {
  return { ...bundle, sim: computeBudgetSim(forecast, bundle.facts) };
}
