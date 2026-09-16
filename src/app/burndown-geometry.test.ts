import { describe, it, expect } from "vitest";
import { buildChartModel, daysBetweenUtc, scaleDate, scaleValue, type ChartInput } from "./burndown-geometry";
import { CHART_SERIES, CHART_FORECAST, CHART_FORECAST_HOURS } from "../test/chart-fixtures";
import type { BurndownSeries } from "./budget-burndown";
import type { BudgetForecast } from "./budget-forecast";
import type { EvHistoryPoint, EvJoin, EvPartialBucket } from "./budget-ev-history";

const base: ChartInput = {
  series: CHART_SERIES, unit: "eur", orientation: "burndown",
  forecast: CHART_FORECAST, evHistory: null, today: "2026-02-14", planEnd: "2026-03-31",
};
/** An EV history point worth `eur` €, and eur/100 hours. */
function evPoint(
  date: string, eur: number,
  over: { partial?: EvPartialBucket[]; joins?: EvJoin[] } = {},
): EvHistoryPoint {
  return { date, eur, hours: eur / 100, partial: over.partial ?? [], joins: over.joins ?? [] };
}
const VENDOR: EvPartialBucket = { id: 3, name: "Vendor", createdDate: null, startDate: "2026-01-01" };
const OPS: EvPartialBucket = { id: 4, name: "Ops", createdDate: "2026-02-01", startDate: "2026-01-01" };

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
    expect(m.pace).toEqual({ from: { date: "2026-02-14", value: 5_000 }, to: { date: "2026-03-31", value: -1_000 }, endFigure: -1_000, vac: -1_000 });
    expect(m.efficiency?.to.value).toBe(-2_000);
    expect(m.efficiency?.endFigure).toBe(-2_000);
    expect(m.efficiency?.vac).toBe(-2_000);
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
    // The end LABEL is the EAC here, but `vac` stays the forecast's own VAC.
    expect(m.pace?.vac).toBe(-1_000);
    expect(m.efficiency?.endFigure).toBe(11_000);
    expect(m.efficiency?.vac).toBe(-2_000);
    expect(m.runOut).toEqual({ date: "2026-03-20", value: 9_000 });
    expect(m.ev?.value).toBe(3_600);
    expect(m.bacLine).toBe(9_000);
  });
  it("plots the full planned line in cumulative values, not just the burn-down reading", () => {
    // Pins the cumulative orientation's own transform (fromCumulative(total -
    // remaining) = total - remaining when down is false) so a mutant that
    // pushed the raw `remaining` for planned points — mathematically
    // indistinguishable from the correct value in burn-down orientation, since
    // fromCumulative flips it back there — is caught here instead.
    expect(m.planned).toEqual([
      { date: "2026-01-01", value: 0 }, { date: "2026-01-31", value: 3_000 },
      { date: "2026-02-28", value: 6_000 }, { date: "2026-03-31", value: 9_000 },
    ]);
  });
  it("draws the earned-value history only here", () => {
    const evHistory = { available: true as const, points: [evPoint("2026-01-31", 1_000), evPoint("2026-02-14", 3_600)] };
    const m = buildChartModel({ ...base, orientation: "cumulative", evHistory });
    expect(m.evSegments).toEqual([{ partial: false, points: [
      { date: "2026-01-01", value: 0 }, { date: "2026-01-31", value: 1_000 }, { date: "2026-02-14", value: 3_600 },
    ] }]);
    expect(m.evPartialNames).toEqual([]);
    expect(m.evJoins).toEqual([]);
    expect(m.evUnavailable).toBeNull();
    const down = buildChartModel({ ...base, evHistory });
    expect(down.evSegments).toBeNull();
    expect(down.evJoins).toEqual([]);
    expect(down.evPartialNames).toEqual([]);
  });
  it("names the buckets that have no earned-value history", () => {
    const evHistory = { available: false as const, reason: "no-earned-value" as const, buckets: [{ id: 2, name: "Design" }] };
    const m = buildChartModel({ ...base, orientation: "cumulative", evHistory });
    expect(m.evUnavailable).toEqual(["Design"]);
    expect(m.evSegments).toBeNull();
  });
  it("returns null evSegments when the history has no points", () => {
    const evHistory = { available: true as const, points: [] };
    expect(buildChartModel({ ...base, orientation: "cumulative", evHistory }).evSegments).toBeNull();
  });
  it("reads the earned-value history in the hours unit", () => {
    const evHistory = { available: true as const, points: [evPoint("2026-01-31", 1_000)] };
    const m = buildChartModel({ ...base, unit: "hours", orientation: "cumulative", forecast: null, evHistory });
    expect(m.evSegments).toEqual([{ partial: false, points: [{ date: "2026-01-01", value: 0 }, { date: "2026-01-31", value: 10 }] }]);
  });
});

describe("buildChartModel — partial earned value and joins", () => {
  const cumulative = (points: EvHistoryPoint[], unit: ChartInput["unit"] = "eur") =>
    buildChartModel({ ...base, unit, orientation: "cumulative", forecast: null, evHistory: { available: true, points } });

  it("groups consecutive partial points into one segment that shares its boundary points", () => {
    const m = cumulative([
      evPoint("2026-01-10", 100, { partial: [VENDOR] }),
      evPoint("2026-01-20", 200, { partial: [VENDOR, OPS] }),
      evPoint("2026-01-31", 800, { joins: [{ id: 3, name: "Vendor", eur: 500, hours: 5 }] }),
      evPoint("2026-02-10", 900, { partial: [OPS] }),
      evPoint("2026-02-14", 1_000),
    ]);
    const at = (date: string, value: number) => ({ date, value });
    expect(m.evSegments).toEqual([
      { partial: true, points: [at("2026-01-01", 0), at("2026-01-10", 100), at("2026-01-20", 200)] },
      { partial: false, points: [at("2026-01-20", 200), at("2026-01-31", 800)] },
      { partial: true, points: [at("2026-01-31", 800), at("2026-02-10", 900)] },
      { partial: false, points: [at("2026-02-10", 900), at("2026-02-14", 1_000)] },
    ]);
    // Continuity: each segment starts where the previous one ended.
    const segments = m.evSegments ?? [];
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].points[0]).toEqual(segments[i - 1].points.at(-1));
    }
    expect(m.evPartialNames).toEqual([
      { names: "Vendor, Ops", created: false },
      { names: "Ops", created: true },
    ]);
  });

  it("calls a segment 'created later' only when every bucket in it was created after its start", () => {
    const late = { id: 3, name: "Vendor", createdDate: "2026-02-01", startDate: "2026-01-01" };
    const lateToo = { id: 4, name: "Ops", createdDate: "2026-03-01", startDate: "2026-01-15" };
    expect(cumulative([evPoint("2026-01-31", 0, { partial: [late, lateToo] }), evPoint("2026-02-14", 10)]).evPartialNames)
      .toEqual([{ names: "Vendor, Ops", created: true }]);
    const sameDay = { ...lateToo, createdDate: "2026-01-15" };
    expect(cumulative([evPoint("2026-01-31", 0, { partial: [late, sameDay] }), evPoint("2026-02-14", 10)]).evPartialNames)
      .toEqual([{ names: "Vendor, Ops", created: false }]);
    const undated = { ...late, startDate: null };
    expect(cumulative([evPoint("2026-01-31", 0, { partial: [undated] }), evPoint("2026-02-14", 10)]).evPartialNames)
      .toEqual([{ names: "Vendor", created: false }]);
  });

  it("labels a join at its point with the amount in the current unit", () => {
    const joins = [{ id: 3, name: "Vendor", eur: 500, hours: 5 }, { id: 4, name: "Ops", eur: 250, hours: 2.5 }];
    const points = [evPoint("2026-01-20", 0, { partial: [VENDOR] }), evPoint("2026-01-31", 800, { joins }), evPoint("2026-02-14", 1_000)];
    expect(cumulative(points).evJoins).toEqual([{ date: "2026-01-31", value: 800, amount: 750, label: "Vendor, Ops" }]);
    expect(cumulative(points, "hours").evJoins).toEqual([{ date: "2026-01-31", value: 8, amount: 7.5, label: "Vendor, Ops" }]);
  });

  it("drops a join whose amount shows as 0 in the current unit", () => {
    const joins = [{ id: 3, name: "Vendor", eur: 40, hours: 0.4 }, { id: 4, name: "Ops", eur: 0, hours: 0 }];
    const points = [evPoint("2026-01-20", 0, { partial: [VENDOR, OPS] }), evPoint("2026-01-31", 40, { joins }), evPoint("2026-02-14", 50)];
    // €: Vendor's 40 shows, Ops's 0 does not; hours: 0.4 h rounds to "0 h", so nothing is labelled.
    expect(cumulative(points).evJoins).toEqual([{ date: "2026-01-31", value: 40, amount: 40, label: "Vendor" }]);
    expect(cumulative(points, "hours").evJoins).toEqual([]);
  });
});

describe("buildChartModel — edges", () => {
  it("reads the hours arrays in the hours unit", () => {
    const m = buildChartModel({ ...base, unit: "hours", forecast: null });
    expect(m.total).toBe(90);
    expect(m.actual[m.actual.length - 1].value).toBe(50);
  });
  it("plots the full planned line from the hours arrays, not the € ones", () => {
    // Pins `plannedRemaining = eurUnit ? …Value : …Hours` end to end — a
    // mutant that always read the € array would still pass a total/last-point
    // check (values happen to differ) but fails this full-array comparison
    // against the hours figures (60,30,0 vs €'s 6000,3000,0).
    const m = buildChartModel({ ...base, unit: "hours", forecast: null });
    expect(m.planned).toEqual([
      { date: "2026-01-01", value: 90 }, { date: "2026-01-31", value: 60 },
      { date: "2026-02-28", value: 30 }, { date: "2026-03-31", value: 0 },
    ]);
  });
  it("computes forecast segments in the hours unit", () => {
    const m = buildChartModel({ ...base, unit: "hours", forecast: CHART_FORECAST_HOURS });
    expect(m.total).toBe(90);
    expect(m.pace).toEqual({ from: { date: "2026-02-14", value: 50 }, to: { date: "2026-03-31", value: -10 }, endFigure: -10, vac: -10 });
    expect(m.efficiency?.to.value).toBe(-20);
    expect(m.efficiency?.endFigure).toBe(-20);
    expect(m.efficiency?.vac).toBe(-20);
    expect(m.frameDiffers).toBe(false);
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
  it("has no forecast segments or run-out for an overdue project (Controller ruling: last.date >= planEnd)", () => {
    // Monthly plan ending mid-month, today after it — the shape from the
    // review finding: a forecast segment from the last actual point to
    // planEnd would run backward/vertical instead of forward.
    const overdueSeries: BurndownSeries = {
      periods: ["2026-03"], periodStarts: ["2026-03-01"], periodEnds: ["2026-03-31"],
      plannedRemainingHours: [0], plannedRemainingValue: [0],
      actualRemainingHours: [10], actualRemainingValue: [1_000],
      todayIndex: 0, totalBudgetHours: 90, totalBudgetValue: 9_000,
    };
    const m = buildChartModel({ ...base, series: overdueSeries, today: "2026-03-20", planEnd: "2026-03-15" });
    expect(m.pace).toBeNull();
    expect(m.efficiency).toBeNull();
    expect(m.runOut).toBeNull();
    // The actual line itself is untouched by the overdue guard.
    expect(m.actual.length).toBeGreaterThan(0);
    expect(m.actual[m.actual.length - 1]).toEqual({ date: "2026-03-20", value: 1_000 });
  });
  it("has no forecast segments exactly at the plan-end boundary (last.date === planEnd)", () => {
    const m = buildChartModel({ ...base, planEnd: "2026-02-14" });
    expect(m.pace).toBeNull();
    expect(m.efficiency).toBeNull();
    expect(m.runOut).toBeNull();
  });
  it("still has a forecast the day before the plan end (last.date < planEnd)", () => {
    const m = buildChartModel({ ...base, planEnd: "2026-02-15" });
    expect(m.pace).not.toBeNull();
    expect(m.efficiency).not.toBeNull();
  });
});
