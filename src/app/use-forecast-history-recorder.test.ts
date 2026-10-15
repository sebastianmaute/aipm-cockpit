// §502 — the background forecast-history recorder. The forecast engine is
// stubbed: this pins WHEN a row is written and HOW, not the simulation.
import { renderHook } from "@testing-library/react";
import { useState } from "react";
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

function deps(over: Partial<ForecastHistoryRecorderDeps> = {}): ForecastHistoryRecorderDeps {
  return {
    hydrated: true, isPopout: false, loadPending: false, holidaysReady: true,
    today: TODAY, tasks: TASKS, milestones: MILESTONES, planEnd: "2026-12-31",
    holidaySet: HOLIDAYS, settingsOverrides: { forecast: { showSimulation: true } },
    forecastHistory: [], setForecastHistory: vi.fn(), getScopeEpoch: () => 0, ...over,
  };
}

function run(over: Partial<ForecastHistoryRecorderDeps> = {}) {
  const setForecastHistory = vi.fn();
  const d = deps({ setForecastHistory, ...over });
  renderHook(() => useForecastHistoryRecorder(d));
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
  it.each([
    ["p80", { p80: "2026-11-11" }],
    ["p95", { p95: "2026-11-21" }],
    ["chanceOnTime", { chanceOnTime: 0.4 }],
  ] as const)("writes when today's stored entry differs only in %s", (_label, diff) => {
    expect(run({ forecastHistory: [{ ...ENTRY, ...diff }] })).toHaveBeenCalledTimes(1);
  });

  it("with a real stateful history, writes exactly once and then stops", () => {
    const writes = vi.fn();
    renderHook(() => {
      const [history, setHistory] = useState<readonly ForecastHistoryEntry[]>([]);
      const setForecastHistory: ForecastHistoryRecorderDeps["setForecastHistory"] = (u) => {
        writes();
        setHistory(u);
      };
      useForecastHistoryRecorder(deps({ forecastHistory: history, setForecastHistory }));
      return history;
    });
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it("two tabs that disagree settle: the later writer of the day wins, no ping-pong", () => {
    // Two recorders share ONE stored history (what the cross-tab broadcast amounts
    // to) but compute different entries, e.g. different holiday settings per device.
    const holidaysA = new Set<string>();
    const holidaysB = new Set<string>(["2026-10-20"]);
    compute.mockImplementation((a: { holidaySet: ReadonlySet<string> }) =>
      a.holidaySet === holidaysB ? { ...FORECAST, p50: "2026-11-02" } : FORECAST);
    const writes = vi.fn();
    const { result } = renderHook(() => {
      const [history, setHistory] = useState<readonly ForecastHistoryEntry[]>([]);
      const writer = (tab: string): ForecastHistoryRecorderDeps["setForecastHistory"] => (u) => {
        writes(tab);
        setHistory(u);
      };
      useForecastHistoryRecorder(deps({ holidaySet: holidaysA, forecastHistory: history, setForecastHistory: writer("A") }));
      useForecastHistoryRecorder(deps({ holidaySet: holidaysB, forecastHistory: history, setForecastHistory: writer("B") }));
      return history;
    });
    // A writes first, B answers once, and nobody writes again: exactly [A, B].
    expect(writes.mock.calls).toEqual([["A"], ["B"]]);
    expect(result.current).toHaveLength(1);
    expect(result.current[0].p50).toBe("2026-11-02");
  });
  it("leaves a peer's later differing entry alone once this tab recorded today", () => {
    const set = vi.fn();
    const { rerender } = renderHook((h: readonly ForecastHistoryEntry[]) =>
      useForecastHistoryRecorder(deps({ forecastHistory: h, setForecastHistory: set })), { initialProps: [] as readonly ForecastHistoryEntry[] });
    expect(set).toHaveBeenCalledTimes(1);
    rerender([{ ...ENTRY, p50: "2026-11-02" }]);
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("writes again when its own computed entry changes after it recorded today", () => {
    const set = vi.fn();
    const peer = [{ ...ENTRY, p50: "2026-11-02" }];
    const { rerender } = renderHook((tasks: ForecastHistoryRecorderDeps["tasks"]) =>
      useForecastHistoryRecorder(deps({ tasks, forecastHistory: peer, setForecastHistory: set })), { initialProps: TASKS });
    expect(set).toHaveBeenCalledTimes(1);
    compute.mockReturnValue({ ...FORECAST, p50: "2026-11-03" });
    rerender([]);
    expect(set).toHaveBeenCalledTimes(2);
  });

  it("rewrites today's entry when it is missing from the stored history", () => {
    const set = vi.fn();
    const { rerender } = renderHook((h: readonly ForecastHistoryEntry[]) =>
      useForecastHistoryRecorder(deps({ forecastHistory: h, setForecastHistory: set })), { initialProps: [] as readonly ForecastHistoryEntry[] });
    rerender([ENTRY]);
    rerender([]);
    expect(set).toHaveBeenCalledTimes(2);
  });

  it("keeps what it recorded across a SAME-project reload, so a peer's entry is still left alone", () => {
    // The conflict banner's Reload holds the load (loadPending true -> false) without
    // changing the project, so the scope epoch does not move.
    const set = vi.fn();
    const peer = [{ ...ENTRY, p50: "2026-11-02" }];
    const { rerender } = renderHook((p: { h: readonly ForecastHistoryEntry[]; loadPending: boolean }) =>
      useForecastHistoryRecorder(deps({ forecastHistory: p.h, loadPending: p.loadPending, setForecastHistory: set })),
      { initialProps: { h: [] as readonly ForecastHistoryEntry[], loadPending: false } });
    expect(set).toHaveBeenCalledTimes(1);
    rerender({ h: peer, loadPending: false });
    rerender({ h: peer, loadPending: true });
    rerender({ h: peer, loadPending: false });
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("forgets what it recorded when the scope epoch moves, so another project's entry is not mistaken for its own", () => {
    const set = vi.fn();
    let epoch = 0;
    const getScopeEpoch = () => epoch;
    const other = [{ ...ENTRY, p50: "2026-11-09" }];
    const { rerender } = renderHook((p: { h: readonly ForecastHistoryEntry[]; loadPending: boolean }) =>
      useForecastHistoryRecorder(deps({ forecastHistory: p.h, loadPending: p.loadPending, setForecastHistory: set, getScopeEpoch })),
      { initialProps: { h: [] as readonly ForecastHistoryEntry[], loadPending: false } });
    expect(set).toHaveBeenCalledTimes(1);
    rerender({ h: [], loadPending: true });
    epoch = 1;
    rerender({ h: other, loadPending: false });
    expect(set).toHaveBeenCalledTimes(2);
    const updater = set.mock.calls[1][0] as (p: readonly ForecastHistoryEntry[]) => ForecastHistoryEntry[];
    expect(updater(other)).toEqual([ENTRY]);
  });
});
