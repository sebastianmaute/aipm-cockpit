import { describe, expect, it } from "vitest";
import type { AppForecast } from "./forecast/app-forecast";
import { chancePercent, isDivergent, kpiSimulation, kpiSimulationGap } from "./kpi-simulation";

const INSUFFICIENT: Extract<AppForecast, { kind: "insufficient" }> = { kind: "insufficient", finished: 4, neededFinished: 10, days: 30, neededDays: 10 };

const forecast = (over: Partial<Extract<AppForecast, { kind: "forecast" }>> = {}): AppForecast => ({
  kind: "forecast",
  p50: "2026-11-02",
  p80: "2026-11-20",
  p95: "2026-12-10",
  chanceOnTime: 0.34,
  estimateCoverage: 0.41,
  windowDays: 60,
  distribution: Int32Array.from([5, 10, 15]),
  trials: 10000,
  markers: { p50: 10, p80: 20, p95: 30 },
  ...over,
});

describe("isDivergent", () => {
  it.each([
    [1.0, 0.49, true],
    [1.0, 0.5, false],
    [0.89, 0.8, true],
    [0.9, 0.8, false],
    [null, 0.1, false],
    [1.2, null, false],
  ])("isDivergent(%s, %s) is %s", (spi, chance, expected) => {
    expect(isDivergent(spi, chance)).toBe(expected);
  });
});

describe("kpiSimulation", () => {
  it("is null for an insufficient forecast", () => {
    expect(kpiSimulation(INSUFFICIENT, 1)).toBeNull();
  });

  it("is null when the P80 date is beyond the horizon", () => {
    expect(kpiSimulation(forecast({ p80: null }), 1)).toBeNull();
  });

  it("carries the figures, the divergence verdict and the explainer inputs", () => {
    const f = forecast();
    const sim = kpiSimulation(f, 1.1);
    expect(sim).toEqual({
      p80: "2026-11-20",
      chanceOnTime: 0.34,
      estimateCoverage: 0.41,
      divergent: true,
      explainer: { windowDays: 60, distribution: (f as { distribution: Int32Array }).distribution, trials: 10000, markers: { p50: 10, p80: 20, p95: 30 } },
    });
  });

  it("is not divergent when SPI is unknown", () => {
    expect(kpiSimulation(forecast(), null)?.divergent).toBe(false);
  });
});

describe("kpiSimulationGap", () => {
  it("names too few finished tasks first, even when the window is short too", () => {
    expect(kpiSimulationGap({ ...INSUFFICIENT, finished: 4, days: 3 })).toEqual({ kind: "finished", finished: 4, needed: 10 });
  });

  it("names the window when only the working days are short", () => {
    expect(kpiSimulationGap({ ...INSUFFICIENT, finished: 12, days: 6 })).toEqual({ kind: "days", days: 6, needed: 10 });
  });

  it("is beyond the horizon when the P80 date is", () => {
    expect(kpiSimulationGap(forecast({ p80: null }))).toEqual({ kind: "beyond" });
  });

  it("is null whenever kpiSimulation has cells to show", () => {
    expect(kpiSimulationGap(forecast())).toBeNull();
    expect(kpiSimulation(forecast(), 1)).not.toBeNull();
  });
});

describe("chancePercent — a simulated chance never reads as certainty", () => {
  it.each([
    [1, { kind: "exact", percent: 100 }],
    [0.996, { kind: "above99" }],
    [0.995, { kind: "above99" }],
    [0.994, { kind: "exact", percent: 99 }],
    [0.34, { kind: "exact", percent: 34 }],
    [0.006, { kind: "exact", percent: 1 }],
    [0.004, { kind: "below1" }],
    [0.0001, { kind: "below1" }],
    [0, { kind: "exact", percent: 0 }],
  ] as const)("%s -> %o", (chance, expected) => {
    expect(chancePercent(chance)).toEqual(expected);
  });
});
