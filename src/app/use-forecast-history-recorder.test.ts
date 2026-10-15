// §502 — the background forecast-history recorder. The forecast engine is
// stubbed: this pins WHEN a row is written and HOW, not the simulation.
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ForecastHistoryEntry } from "./forecast-history";
import {
  type ForecastHistoryRecorderDeps,
  useForecastHistoryRecorder,
} from "./use-forecast-history-recorder";

const compute = vi.hoisted(() => vi.fn());
vi.mock("./forecast/app-forecast", async (orig) => ({
  ...(await orig<typeof import("./forecast/app-forecast")>()),
  computeAppForecast: compute,
}));

const TODAY = "2026-10-15";
const FORECAST = {
  kind: "forecast",
  p50: "2026-11-01",
  p80: "2026-11-10",
  p95: "2026-11-20",
  chanceOnTime: 0.5,
};
const ENTRY: ForecastHistoryEntry = {
  date: TODAY, p50: "2026-11-01", p80: "2026-11-10", p95: "2026-11-20", chanceOnTime: 0.5,
};
const TASKS: ForecastHistoryRecorderDeps["tasks"] = [];
const MILESTONES: ForecastHistoryRecorderDeps["milestones"] = [];
const HOLIDAYS = new Set<string>();

function run(over: Partial<ForecastHistoryRecorderDeps> = {}) {
  const setForecastHistory = vi.fn();
  const deps: ForecastHistoryRecorderDeps = {
    hydrated: true, isPopout: false, loadPending: false, holidaysReady: true,
    today: TODAY, tasks: TASKS, milestones: MILESTONES, planEnd: "2026-12-31",
    holidaySet: HOLIDAYS, settingsOverrides: { forecast: { showSimulation: true } },
    forecastHistory: [], setForecastHistory, ...over,
  };
  renderHook(() => useForecastHistoryRecorder(deps));
  return setForecastHistory;
}

describe("useForecastHistoryRecorder", () => {
  beforeEach(() => {
    compute.mockReset();
    compute.mockReturnValue(FORECAST);
  });

  it("writes today's entry through a functional updater when ready", () => {
    const set = run();
    expect(compute).toHaveBeenCalledWith({
      tasks: TASKS, milestones: MILESTONES, planEnd: "2026-12-31", today: TODAY, holidaySet: HOLIDAYS,
    });
    // The engine memo keys on references: the SAME arrays/set must reach it.
    const args = compute.mock.calls[0][0];
    expect(args.tasks).toBe(TASKS);
    expect(args.milestones).toBe(MILESTONES);
    expect(args.holidaySet).toBe(HOLIDAYS);
    expect(set).toHaveBeenCalledTimes(1);
    const updater = set.mock.calls[0][0] as (p: readonly ForecastHistoryEntry[]) => ForecastHistoryEntry[];
    expect(updater([])).toEqual([ENTRY]);
  });

  it.each([
    ["switch off", { settingsOverrides: undefined }],
    ["popout", { isPopout: true }],
    ["load pending", { loadPending: true }],
    ["not hydrated", { hydrated: false }],
    ["holidays not ready", { holidaysReady: false }],
  ] as const)("does not write when %s", (_label, over) => {
    expect(run(over)).not.toHaveBeenCalled();
  });

  it("does not write when the history is insufficient", () => {
    compute.mockReturnValue({ kind: "insufficient" });
    expect(run()).not.toHaveBeenCalled();
  });

  it("does not write when today's stored entry already equals the computed one", () => {
    expect(run({ forecastHistory: [ENTRY] })).not.toHaveBeenCalled();
  });

  it("writes when today's stored entry differs", () => {
    expect(run({ forecastHistory: [{ ...ENTRY, p50: "2026-10-30" }] })).toHaveBeenCalledTimes(1);
  });

  it("upserts: a stale same-day entry is replaced, not duplicated", () => {
    const old = { ...ENTRY, date: "2026-10-14", p50: "2026-10-01" };
    const stale = { ...ENTRY, p50: "2026-10-30" };
    const set = run({ forecastHistory: [old, stale] });
    const updater = set.mock.calls[0][0] as (p: readonly ForecastHistoryEntry[]) => ForecastHistoryEntry[];
    expect(updater([old, stale])).toEqual([old, ENTRY]);
  });
});
