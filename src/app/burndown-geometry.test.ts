import { describe, it, expect } from "vitest";
import { buildChartModel, daysBetweenUtc, scaleDate, scaleValue, type ChartInput } from "./burndown-geometry";
import { CHART_SERIES, CHART_FORECAST } from "../test/chart-fixtures";
import type { BurndownSeries } from "./budget-burndown";
import type { BudgetForecast } from "./budget-forecast";

const base: ChartInput = {
  series: CHART_SERIES, unit: "eur", orientation: "burndown",
  forecast: CHART_FORECAST, evHistory: null, today: "2026-02-14", planEnd: "2026-03-31",
};

describe("scales", () => {
  it("counts UTC calendar days and maps dates and values linearly", () => {
    expect(daysBetweenUtc("2026-01-01", "2026-03-01")).toBe(59);
    expect(scaleDate("2026-01-16", ["2026-01-01", "2026-01-31"], 0, 300)).toBe(150);
    expect(scaleDate("2026-01-01", ["2026-01-01", "2026-01-01"], 10, 300)).toBe(10);
    expect(scaleValue(50, [0, 100], 200, 0)).toBe(100);
    expect(scaleValue(5, [5, 5], 200, 0)).toBe(200);
  });
});

describe("buildChartModel — burn-down, €", () => {
  const m = buildChartModel(base);
  it("plots planned from an origin at the first period start, then at period ends", () => {
    expect(m.planned).toEqual([
      { date: "2026-01-01", value: 9_000 }, { date: "2026-01-31", value: 6_000 },
      { date: "2026-02-28", value: 3_000 }, { date: "2026-03-31", value: 0 },
    ]);
  });
  it("ends the actual line at today", () => {
    expect(m.actual).toEqual([
      { date: "2026-01-01", value: 9_000 }, { date: "2026-01-31", value: 7_000 }, { date: "2026-02-14", value: 5_000 },
    ]);
    expect(m.today).toBe("2026-02-14");
  });
  it("extends both forecasts from the last actual point by their ETC, labelled with VAC", () => {
    expect(m.pace).toEqual({ from: { date: "2026-02-14", value: 5_000 }, to: { date: "2026-03-31", value: -1_000 }, endFigure: -1_000 });
    expect(m.efficiency?.to.value).toBe(-2_000);
    expect(m.efficiency?.endFigure).toBe(-2_000);
  });
  it("places the run-out at zero on its date, EV as work left, and opens the domain below zero", () => {
    expect(m.runOut).toEqual({ date: "2026-03-20", value: 0 });
    expect(m.ev).toEqual({ date: "2026-02-14", value: 5_400 });
    expect(m.yDomain).toEqual([-2_000, 9_000]);
    expect(m.xDomain).toEqual(["2026-01-01", "2026-03-31"]);
    expect(m.bacLine).toBeNull();
    expect(m.frameDiffers).toBe(false);
    expect(m.over).toBe(false);
    expect(m.empty).toBe(false);
  });
});

describe("buildChartModel — cumulative", () => {
  const m = buildChartModel({ ...base, orientation: "cumulative" });
  it("flips values to cumulative, labels ends with EAC and draws the BAC line", () => {
    expect(m.actual[m.actual.length - 1]).toEqual({ date: "2026-02-14", value: 4_000 });
    expect(m.pace?.to.value).toBe(10_000);
    expect(m.pace?.endFigure).toBe(10_000);
    expect(m.runOut).toEqual({ date: "2026-03-20", value: 9_000 });
    expect(m.ev?.value).toBe(3_600);
    expect(m.bacLine).toBe(9_000);
  });
  it("draws the earned-value history only here", () => {
    const evHistory = { available: true as const, points: [{ date: "2026-01-31", eur: 1_000, hours: 10 }, { date: "2026-02-14", eur: 3_600, hours: 36 }] };
    expect(buildChartModel({ ...base, orientation: "cumulative", evHistory }).evLine).toEqual([
      { date: "2026-01-01", value: 0 }, { date: "2026-01-31", value: 1_000 }, { date: "2026-02-14", value: 3_600 },
    ]);
    expect(buildChartModel({ ...base, evHistory }).evLine).toBeNull();
  });
  it("names the buckets that block the history", () => {
    const evHistory = { available: false as const, reason: "manual-percent" as const, buckets: [{ id: 2, name: "Design" }] };
    expect(buildChartModel({ ...base, orientation: "cumulative", evHistory }).evHistoryBlockedBy).toEqual(["Design"]);
  });
  it("returns null evLine when the history has no points", () => {
    const evHistory = { available: true as const, points: [] };
    expect(buildChartModel({ ...base, orientation: "cumulative", evHistory }).evLine).toBeNull();
  });
  it("reads the earned-value history in the hours unit", () => {
    const evHistory = { available: true as const, points: [{ date: "2026-01-31", eur: 1_000, hours: 10 }] };
    const m = buildChartModel({ ...base, unit: "hours", orientation: "cumulative", forecast: null, evHistory });
    expect(m.evLine).toEqual([{ date: "2026-01-01", value: 0 }, { date: "2026-01-31", value: 10 }]);
  });
});

describe("buildChartModel — edges", () => {
  it("reads the hours arrays in the hours unit", () => {
    const m = buildChartModel({ ...base, unit: "hours", forecast: null });
    expect(m.total).toBe(90);
    expect(m.actual[m.actual.length - 1].value).toBe(50);
  });
  it("draws no forecast when it is unavailable or absent", () => {
    const unavailable = { ...CHART_FORECAST, pace: { unavailable: "no-burn", windowStart: "a", windowEnd: "b", lastBookingDate: null }, efficiency: { unavailable: "no-actual-cost" } } as BudgetForecast;
    const m = buildChartModel({ ...base, forecast: unavailable });
    expect(m.pace).toBeNull();
    expect(m.efficiency).toBeNull();
    expect(m.runOut).toBeNull();
  });
  it("omits a run-out after the plan end", () => {
    const late = { ...CHART_FORECAST, pace: { ...CHART_FORECAST.pace, runOutDate: "2026-04-10" } } as BudgetForecast;
    expect(buildChartModel({ ...base, forecast: late }).runOut).toBeNull();
  });
  it("flags a frame difference beyond the tolerance", () => {
    expect(buildChartModel({ ...base, forecast: { ...CHART_FORECAST, facts: { ...CHART_FORECAST.facts, bac: 9_001 } } }).frameDiffers).toBe(true);
    expect(buildChartModel({ ...base, forecast: { ...CHART_FORECAST, facts: { ...CHART_FORECAST.facts, ac: 4_000.4 } } }).frameDiffers).toBe(false);
  });
  it("marks over-budget and empty charts, and has no actual line before the first period", () => {
    expect(buildChartModel({ ...base, series: { ...CHART_SERIES, actualRemainingValue: [7_000, -500, null] } }).over).toBe(true);
    expect(buildChartModel({ ...base, series: { ...CHART_SERIES, totalBudgetValue: 0 } }).empty).toBe(true);
    const before = buildChartModel({ ...base, series: { ...CHART_SERIES, todayIndex: -1 }, today: "2025-12-01" });
    expect(before.actual).toEqual([]);
    expect(before.pace).toBeNull();
    expect(before.today).toBeNull();
  });
  it("has no forecast when there is no actual line at all (todayIndex -1)", () => {
    const m = buildChartModel({ ...base, series: { ...CHART_SERIES, todayIndex: -1 }, today: "2025-12-01" });
    expect(m.ev).toBeNull();
    expect(m.frameDiffers).toBe(false);
  });
  it("has no forecast facts.ev when the facts carry no EV", () => {
    const noEv = { ...CHART_FORECAST, facts: { ...CHART_FORECAST.facts, ev: null } };
    expect(buildChartModel({ ...base, forecast: noEv }).ev).toBeNull();
  });
  it("has an empty planned/actual/xDomain when the series has no periods at all", () => {
    const emptySeries: BurndownSeries = {
      periods: [], periodStarts: [], periodEnds: [],
      plannedRemainingHours: [], plannedRemainingValue: [],
      actualRemainingHours: [], actualRemainingValue: [],
      todayIndex: -1, totalBudgetHours: 0, totalBudgetValue: 0,
    };
    const m = buildChartModel({ ...base, series: emptySeries, forecast: null, today: "2026-02-14" });
    expect(m.planned).toEqual([]);
    expect(m.actual).toEqual([]);
    expect(m.xDomain).toEqual(["2026-03-31", "2026-03-31"]);
    expect(m.empty).toBe(true);
  });
  it("extends the x domain when the series runs past the plan end", () => {
    const longSeries: BurndownSeries = { ...CHART_SERIES, periodEnds: ["2026-01-31", "2026-02-28", "2026-04-15"] };
    const m = buildChartModel({ ...base, series: longSeries, forecast: null });
    expect(m.xDomain).toEqual(["2026-01-01", "2026-04-15"]);
  });
  it("skips an actual point whose remaining is unexpectedly null before today", () => {
    const series: BurndownSeries = { ...CHART_SERIES, actualRemainingValue: [7_000, null, null] };
    const m = buildChartModel({ ...base, series, forecast: null });
    expect(m.actual).toEqual([
      { date: "2026-01-01", value: 9_000 }, { date: "2026-01-31", value: 7_000 },
    ]);
  });
});
