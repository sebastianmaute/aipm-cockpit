import { describe, expect, it } from "vitest";
import type { DatedValue, ForecastFacts, ForecastFactsByUnit } from "./budget-forecast";
import type { AppForecast } from "./forecast/app-forecast";
import { MIN_SPEND_WORKING_DAYS } from "./forecast/constants";
import { computeBudgetSim, withBudgetSim } from "./budget-sim";
import { forecastBundleFixture } from "../test/forecast-bundle-fixture";

const WINDOW = Array.from({ length: 12 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
const day = (date: string, value: number): DatedValue => ({ date, bookedFrom: date, value, spread: false });
const none = new Set<string>();

function facts(ac: number, bac: number, perDay: (i: number) => number): ForecastFacts {
  return {
    bac, ac, ev: null, pv: 0, bucketsMissingPercent: [],
    dated: WINDOW.map((d, i) => day(d, perDay(i))),
    planEnd: "2026-12-31", today: "2026-10-12", holidaySet: none, hasFixedPrice: false,
  };
}
const FACTS: ForecastFactsByUnit = {
  eur: facts(10_000, 20_000, () => 1_000),
  hours: facts(100, 200, () => 10),
};

function run(trialDays: number[]): AppForecast {
  const sorted = Int32Array.from(trialDays).sort();
  return {
    kind: "forecast", p50: "2026-11-02", p80: "2026-11-16", p95: null, chanceOnTime: 0.5, estimateCoverage: null,
    windowDays: WINDOW.length, distribution: sorted, trialDays: Int32Array.from(trialDays), windowDates: WINDOW,
    trials: trialDays.length, markers: { p50: 15, p80: 25, p95: 1301 }, milestones: [],
  };
}
const RUN = run([0, 5, 10, 15, 20, 25, 30, 1301]);
const BELOW_FLOOR: AppForecast = { kind: "insufficient", finished: 3, neededFinished: 10, days: 4, neededDays: 10 };

describe("computeBudgetSim", () => {
  it("returns null without a schedule run", () => {
    expect(computeBudgetSim(null, FACTS)).toBeNull();
  });

  it("schedule floor makes both units unavailable with reason schedule-floor", () => {
    const sim = computeBudgetSim(BELOW_FLOOR, FACTS);
    const unavailable = { kind: "unavailable", reason: "schedule-floor", spendDays: 0, neededSpendDays: MIN_SPEND_WORKING_DAYS };
    expect(sim).toEqual({ finish: { p50: null, p80: null, p95: null }, eur: unavailable, hours: unavailable });
  });

  it("finish dates are the run's P50/P80/P95", () => {
    expect(computeBudgetSim(RUN, FACTS)?.finish).toEqual({ p50: "2026-11-02", p80: "2026-11-16", p95: null });
  });

  it("eur and hours use their own dated values", () => {
    const sim = computeBudgetSim(RUN, FACTS);
    if (sim?.eur.kind !== "sim" || sim.hours.kind !== "sim") throw new Error("expected both units simulated");
    // Flat spend: cost = ac + days x per-day spend, so the seventh of eight sorted runs (30 days) is P80.
    expect(sim.eur.p80).toBe(10_000 + 30 * 1_000);
    expect(sim.hours.p80).toBe(100 + 30 * 10);
    expect(sim.eur.spendDays).toBe(WINDOW.length);
    // Hours facts with a different spend give a different hours P80; the money unit does not move.
    const other = computeBudgetSim(RUN, { eur: FACTS.eur, hours: facts(100, 200, () => 20) });
    if (other?.hours.kind !== "sim" || other.eur.kind !== "sim") throw new Error("expected both units simulated");
    expect(other.hours.p80).toBe(100 + 30 * 20);
    expect(other.eur.p80).toBe(sim.eur.p80);
  });

  it("memo returns the same object for the same inputs", () => {
    const a = computeBudgetSim(RUN, FACTS);
    expect(computeBudgetSim(RUN, FACTS)).toBe(a);
    // A different facts identity is a new input, even with equal contents.
    expect(computeBudgetSim(RUN, { ...FACTS })).not.toBe(a);
  });
});

describe("withBudgetSim", () => {
  it("withBudgetSim returns a new bundle and leaves the input untouched", () => {
    const bundle = forecastBundleFixture({ facts: FACTS });
    const out = withBudgetSim(bundle, RUN);
    expect(out).not.toBe(bundle);
    expect(bundle.sim).toBeUndefined();
    expect(out.sim).toBe(computeBudgetSim(RUN, FACTS));
    expect(out.eur).toBe(bundle.eur);
  });

  it("carries a null sim while the simulation is off", () => {
    expect(withBudgetSim(forecastBundleFixture({ facts: FACTS }), null).sim).toBeNull();
  });
});
