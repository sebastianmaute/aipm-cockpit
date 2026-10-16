// §502 — the background forecast-history recorder. The forecast engine is
// stubbed: this pins WHEN a row is written and HOW, not the simulation.
import { renderHook } from "@testing-library/react";
import { useState, type SetStateAction } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showForecastView } from "../test/forecast-view";
import type { ForecastHistoryEntry } from "./forecast-history";
import {
  type ForecastHistoryRecorderDeps,
  isSharedStorage,
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
// One stable reader, as production passes: a fresh closure per render would re-run
// the effect on every rerender.
const EPOCH_0 = () => 0;

function deps(over: Partial<ForecastHistoryRecorderDeps> = {}): ForecastHistoryRecorderDeps {
  return {
    hydrated: true, isPopout: false, loadPending: false, holidaysReady: true,
    today: TODAY, tasks: TASKS, milestones: MILESTONES, planEnd: "2026-12-31",
    holidaySet: HOLIDAYS, settingsOverrides: { forecast: { showSimulation: true } }, features: [],
    forecastHistory: [], setForecastHistory: vi.fn(), getScopeEpoch: EPOCH_0, sharedStorage: true, ...over,
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
    showForecastView();
  });

  afterEach(() => vi.restoreAllMocks());

  it("does not write while the forecast view is held back, even with the switch stored on", () => {
    vi.restoreAllMocks();
    expect(run()).not.toHaveBeenCalled();
    expect(compute).not.toHaveBeenCalled();
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

  it("adopts a differing stored entry for today that it did not record, writing nothing", () => {
    // Every stored field is computed in holiday-adjusted working days, so a peer's
    // entry may differ from this tab's for a reason neither tab can correct.
    expect(run({ forecastHistory: [{ ...ENTRY, p50: "2026-10-30" }] })).not.toHaveBeenCalled();
  });

  it("upserts: a stale same-day entry is replaced, not duplicated", () => {
    const old = { ...ENTRY, date: "2026-10-14", p50: "2026-10-01" };
    const stale = { ...ENTRY, p50: "2026-10-30" };
    // The write is decided on the history it saw (nothing for today); by the time the
    // updater runs a peer's entry for today may have arrived, and it is replaced.
    const set = run({ forecastHistory: [old] });
    const updater = set.mock.calls[0][0] as (p: readonly ForecastHistoryEntry[]) => ForecastHistoryEntry[];
    expect(updater([old, stale])).toEqual([old, ENTRY]);
  });
  it.each([
    ["p50", { p50: "2026-11-02" }],
    ["p80", { p80: "2026-11-11" }],
    ["p95", { p95: "2026-11-21" }],
    ["chanceOnTime", { chanceOnTime: 0.4 }],
  ] as const)("writes when its own computed entry changes only in %s", (_label, diff) => {
    const set = vi.fn();
    const { rerender } = renderHook((tasks: ForecastHistoryRecorderDeps["tasks"]) =>
      useForecastHistoryRecorder(deps({ tasks, forecastHistory: [ENTRY], setForecastHistory: set })), { initialProps: TASKS });
    expect(set).not.toHaveBeenCalled();
    compute.mockReturnValue({ ...FORECAST, ...diff });
    rerender([]);
    expect(set).toHaveBeenCalledTimes(1);
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

  it("two clients with different holiday sets write once per day", () => {
    // Two recorders share ONE stored history (what the cross-tab broadcast, or a
    // device that loads after another saved, amounts to) but compute different entries,
    // because holidays are a per-device setting. Client B comes up only after A recorded
    // the day; two open across midnight are the "rule 1 applies on shared storage only" tests.
    const holidaysA = new Set<string>();
    const holidaysB = new Set<string>(["2026-10-20"]);
    compute.mockImplementation((a: { holidaySet: ReadonlySet<string> }) =>
      a.holidaySet === holidaysB ? { ...FORECAST, p50: "2026-11-02" } : FORECAST);
    const writes = vi.fn();
    const { result, rerender } = renderHook((bUp: boolean) => {
      const [history, setHistory] = useState<readonly ForecastHistoryEntry[]>([]);
      const writer = (tab: string): ForecastHistoryRecorderDeps["setForecastHistory"] => (u) => {
        writes(tab);
        setHistory(u);
      };
      useForecastHistoryRecorder(deps({ holidaySet: holidaysA, forecastHistory: history, setForecastHistory: writer("A") }));
      useForecastHistoryRecorder(deps({ hydrated: bUp, holidaySet: holidaysB, forecastHistory: history, setForecastHistory: writer("B") }));
      return history;
    }, { initialProps: false });
    expect(writes.mock.calls).toEqual([["A"]]);
    rerender(true);
    // B adopts A's entry instead of answering it, so A has nothing new to answer.
    expect(writes.mock.calls).toEqual([["A"]]);
    expect(result.current).toEqual([ENTRY]);
  });

  it("an idle tab writes nothing at the day change, and records the day on its next input change", () => {
    const set = vi.fn();
    const { rerender } = renderHook((p: { today: string; tasks: ForecastHistoryRecorderDeps["tasks"] }) =>
      useForecastHistoryRecorder(deps({ today: p.today, tasks: p.tasks, setForecastHistory: set })),
      { initialProps: { today: TODAY, tasks: TASKS } });
    expect(set).toHaveBeenCalledTimes(1);
    rerender({ today: "2026-10-16", tasks: TASKS });
    expect(set).toHaveBeenCalledTimes(1);
    rerender({ today: "2026-10-16", tasks: [] });
    expect(set).toHaveBeenCalledTimes(2);
    const updater = set.mock.calls[1][0] as (p: readonly ForecastHistoryEntry[]) => ForecastHistoryEntry[];
    expect(updater([ENTRY])).toEqual([ENTRY, { ...ENTRY, date: "2026-10-16" }]);
  });

  it.each([
    ["tasks", { tasks: [] }],
    ["milestones", { milestones: [] }],
    ["planEnd", { planEnd: "2027-01-31" }],
    ["holidaySet", { holidaySet: new Set<string>() }],
    ["scope epoch", { getScopeEpoch: () => 1 }],
  ] as const)("a day change together with a %s change is not idle and records the day", (_label, over) => {
    const set = vi.fn();
    const { rerender } = renderHook((p: Partial<ForecastHistoryRecorderDeps>) =>
      useForecastHistoryRecorder(deps({ setForecastHistory: set, ...p })), { initialProps: {} });
    expect(set).toHaveBeenCalledTimes(1);
    rerender({ today: "2026-10-16", ...over });
    expect(set).toHaveBeenCalledTimes(2);
  });

  it("a gate that reopens after the day changed counts as a load and records the day", () => {
    // Switch the simulation off overnight and on again the next morning: the inputs
    // are the same references, but this is not an idle tab at midnight.
    const set = vi.fn();
    const { rerender } = renderHook((p: Partial<ForecastHistoryRecorderDeps>) =>
      useForecastHistoryRecorder(deps({ setForecastHistory: set, ...p })), { initialProps: {} });
    expect(set).toHaveBeenCalledTimes(1);
    rerender({ settingsOverrides: undefined });
    rerender({ settingsOverrides: undefined, today: "2026-10-16" });
    rerender({ today: "2026-10-16" });
    expect(set).toHaveBeenCalledTimes(2);
  });
  it("leaves a peer's later differing entry alone once this tab recorded today", () => {
    const set = vi.fn();
    const { rerender } = renderHook((h: readonly ForecastHistoryEntry[]) =>
      useForecastHistoryRecorder(deps({ forecastHistory: h, setForecastHistory: set })), { initialProps: [] as readonly ForecastHistoryEntry[] });
    expect(set).toHaveBeenCalledTimes(1);
    rerender([{ ...ENTRY, p50: "2026-11-02" }]);
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("a tab whose own forecast changes after adopting a peer entry writes", () => {
    const set = vi.fn();
    const peer = [{ ...ENTRY, p50: "2026-11-02" }];
    const { rerender } = renderHook((tasks: ForecastHistoryRecorderDeps["tasks"]) =>
      useForecastHistoryRecorder(deps({ tasks, forecastHistory: peer, setForecastHistory: set })), { initialProps: TASKS });
    expect(set).not.toHaveBeenCalled();
    rerender([]);
    // Same inputs computing the same entry is no change: still nothing.
    expect(set).not.toHaveBeenCalled();
    compute.mockReturnValue({ ...FORECAST, p50: "2026-11-03" });
    rerender([]);
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("adopts a peer's entry for a new day even though it recorded yesterday", () => {
    // Its memory of yesterday's entry is not a record of today, even when the peer's
    // entry for today carries the same values as the one it wrote yesterday.
    const set = vi.fn();
    const tomorrow = "2026-10-16";
    const { rerender } = renderHook((p: { today: string; tasks: ForecastHistoryRecorderDeps["tasks"]; h: readonly ForecastHistoryEntry[] }) =>
      useForecastHistoryRecorder(deps({ today: p.today, tasks: p.tasks, forecastHistory: p.h, setForecastHistory: set })),
      { initialProps: { today: TODAY, tasks: TASKS, h: [] as readonly ForecastHistoryEntry[] } });
    expect(set).toHaveBeenCalledTimes(1);
    // A tasks change too, so this is not the idle day change (which never writes).
    compute.mockReturnValue({ ...FORECAST, p50: "2026-11-03" });
    rerender({ today: tomorrow, tasks: [], h: [ENTRY, { ...ENTRY, date: tomorrow }] });
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("rewrites today's entry when it is missing from the stored history", () => {
    const set = vi.fn();
    const { rerender } = renderHook((h: readonly ForecastHistoryEntry[]) =>
      useForecastHistoryRecorder(deps({ forecastHistory: h, setForecastHistory: set })), { initialProps: [] as readonly ForecastHistoryEntry[] });
    rerender([ENTRY]);
    rerender([]);
    expect(set).toHaveBeenCalledTimes(2);
  });

  describe("a stored entry that is not this tab's to answer (fix round 1)", () => {
    const X = FORECAST;
    const Y = { ...FORECAST, p50: "2026-11-02" };
    const asEntry = (f: typeof FORECAST): ForecastHistoryEntry => ({
      date: TODAY, p50: f.p50, p80: f.p80, p95: f.p95, chanceOnTime: f.chanceOnTime,
    });
    function mountRecorded() {
      const set = vi.fn();
      const { rerender } = renderHook((p: { tasks: ForecastHistoryRecorderDeps["tasks"]; h: readonly ForecastHistoryEntry[] }) =>
        useForecastHistoryRecorder(deps({ tasks: p.tasks, forecastHistory: p.h, setForecastHistory: set })),
        { initialProps: { tasks: TASKS, h: [] as readonly ForecastHistoryEntry[] } });
      expect(set).toHaveBeenCalledTimes(1); // baseline X, written
      return { set, rerender };
    }

    it("(i) does not write again when the stored entry already equals its new forecast", () => {
      const { set, rerender } = mountRecorded();
      compute.mockReturnValue(Y);
      rerender({ tasks: [], h: [asEntry(Y)] });
      expect(set).toHaveBeenCalledTimes(1);
    });

    it("(i-b) does not rewrite a SEEN entry its new forecast now equals", () => {
      // Adopt a peer's Y while computing a different entry; then its own forecast
      // moves to Y. The stored Y is SEEN and its forecast changed, but writing Y
      // again would change nothing but the array.
      const set = vi.fn();
      compute.mockReturnValue({ ...FORECAST, p50: "2026-11-04" });
      const { rerender } = renderHook((tasks: ForecastHistoryRecorderDeps["tasks"]) =>
        useForecastHistoryRecorder(deps({ tasks, forecastHistory: [asEntry(Y)], setForecastHistory: set })), { initialProps: TASKS });
      expect(set).not.toHaveBeenCalled();
      compute.mockReturnValue(Y);
      rerender([]);
      expect(set).not.toHaveBeenCalled();
    });

    it("(ii) adopts a peer's entry that arrives with a remote edit, though its own forecast changed too", () => {
      const { set, rerender } = mountRecorded();
      compute.mockReturnValue({ ...FORECAST, p50: "2026-11-04" }); // different holidays
      rerender({ tasks: [], h: [asEntry(Y)] });
      expect(set).toHaveBeenCalledTimes(1);
      // and again on the next remote edit with the peer's next entry
      compute.mockReturnValue({ ...FORECAST, p50: "2026-11-06" });
      rerender({ tasks: [], h: [asEntry({ ...FORECAST, p50: "2026-11-05" })] });
      expect(set).toHaveBeenCalledTimes(1);
    });

    it("(iii) writes a local edit over its own stored entry", () => {
      const { set, rerender } = mountRecorded();
      compute.mockReturnValue({ ...FORECAST, p50: "2026-11-07" });
      rerender({ tasks: [], h: [asEntry(X)] });
      expect(set).toHaveBeenCalledTimes(2);
    });
  });

  it("writes nothing after a SAME-project reload that brings a peer's differing entry", () => {
    // The conflict banner's Reload holds the load (loadPending true -> false) without
    // changing the project, so the scope epoch does not move. A behavioural pin only:
    // the peer's entry is adopted whether or not the memory survived the reload.
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

  it("keeps what it recorded across a SAME-project reload, so its own changed forecast is still written", () => {
    // The reload leaves today's stored entry as the one this tab wrote, and the
    // reloaded tasks change its forecast. A memory cleared on loadPending would adopt.
    const set = vi.fn();
    const { rerender } = renderHook((p: { tasks: ForecastHistoryRecorderDeps["tasks"]; h: readonly ForecastHistoryEntry[]; loadPending: boolean }) =>
      useForecastHistoryRecorder(deps({ tasks: p.tasks, forecastHistory: p.h, loadPending: p.loadPending, setForecastHistory: set })),
      { initialProps: { tasks: TASKS, h: [] as readonly ForecastHistoryEntry[], loadPending: false } });
    expect(set).toHaveBeenCalledTimes(1);
    rerender({ tasks: TASKS, h: [ENTRY], loadPending: false });
    rerender({ tasks: TASKS, h: [ENTRY], loadPending: true });
    compute.mockReturnValue({ ...FORECAST, p50: "2026-11-03" });
    rerender({ tasks: [], h: [ENTRY], loadPending: false });
    expect(set).toHaveBeenCalledTimes(2);
  });

  it("forgets what it recorded when the scope epoch moves, so another project's entry is not mistaken for its own", () => {
    const set = vi.fn();
    let epoch = 0;
    const getScopeEpoch = () => epoch;
    // The other project's stored entry happens to equal the one this tab wrote for
    // the first project: remembered, it would read as SEEN.
    const other = [ENTRY];
    const { rerender } = renderHook((p: { h: readonly ForecastHistoryEntry[]; loadPending: boolean }) =>
      useForecastHistoryRecorder(deps({ forecastHistory: p.h, loadPending: p.loadPending, setForecastHistory: set, getScopeEpoch })),
      { initialProps: { h: [] as readonly ForecastHistoryEntry[], loadPending: false } });
    expect(set).toHaveBeenCalledTimes(1);
    rerender({ h: [], loadPending: true });
    epoch = 1;
    // The other project computes its own entry, different from the one recorded under
    // epoch 0. Remembered across the move, that would read as "my own forecast
    // changed" over a SEEN entry and overwrite the other project's entry; forgotten,
    // the stored entry is adopted.
    compute.mockReturnValue({ ...FORECAST, p50: "2026-11-05" });
    rerender({ h: other, loadPending: false });
    expect(set).toHaveBeenCalledTimes(1);
  });
  describe("rule 1 applies on shared storage only", () => {
    it("isSharedStorage: Turso, SharePoint and the Turso portfolio are shared; browser and local files are not", () => {
      expect(isSharedStorage("turso", "file")).toBe(true);
      expect(isSharedStorage("sp-json", "file")).toBe(true);
      expect(isSharedStorage("sp-csv", "file")).toBe(true);
      expect(isSharedStorage("browser", "turso")).toBe(true);
      expect(isSharedStorage("browser", "file")).toBe(false);
      expect(isSharedStorage("local-json", "file")).toBe(false);
      expect(isSharedStorage("local-csv", "file")).toBe(false);
      expect(isSharedStorage("local-md", "file")).toBe(false);
    });

    it("two devices on shared storage, both open across midnight, write nothing at the day change", () => {
      // Spec §4.1: each DEVICE has its own copy of the history (no broadcast between devices), so a
      // midnight write from both would land on a revision the other already moved and pause a save.
      const holidaysB = new Set<string>(["2026-10-20"]);
      compute.mockImplementation((a: { holidaySet: ReadonlySet<string> }) =>
        a.holidaySet === holidaysB ? { ...FORECAST, p50: "2026-11-02" } : FORECAST);
      const writes = vi.fn();
      const writer = (tab: string, set: (u: SetStateAction<readonly ForecastHistoryEntry[]>) => void): ForecastHistoryRecorderDeps["setForecastHistory"] => (u) => {
        writes(tab);
        set(u);
      };
      const { rerender } = renderHook((today: string) => {
        const [historyA, setA] = useState<readonly ForecastHistoryEntry[]>([]);
        const [historyB, setB] = useState<readonly ForecastHistoryEntry[]>([]);
        // Stable writers, as the context setter is: a fresh one per render would re-run the effect.
        const [writeA] = useState(() => writer("A", setA));
        const [writeB] = useState(() => writer("B", setB));
        useForecastHistoryRecorder(deps({ today, forecastHistory: historyA, setForecastHistory: writeA }));
        useForecastHistoryRecorder(deps({ today, holidaySet: holidaysB, forecastHistory: historyB, setForecastHistory: writeB }));
      }, { initialProps: TODAY });
      const atLoad = writes.mock.calls.length;
      rerender("2026-10-16");
      rerender("2026-10-16");
      expect(writes.mock.calls.length).toBe(atLoad);
    });

    it("on single-device storage an idle tab records the new day at the day change", () => {
      const set = vi.fn();
      const { rerender } = renderHook((p: { today: string }) =>
        useForecastHistoryRecorder(deps({ today: p.today, setForecastHistory: set, sharedStorage: false })),
        { initialProps: { today: TODAY } });
      expect(set).toHaveBeenCalledTimes(1);
      rerender({ today: "2026-10-16" });
      expect(set).toHaveBeenCalledTimes(2);
      const updater = set.mock.calls[1][0] as (p: readonly ForecastHistoryEntry[]) => ForecastHistoryEntry[];
      expect(updater([ENTRY])).toEqual([ENTRY, { ...ENTRY, date: "2026-10-16" }]);
    });

    it("on single-device storage an idle tab adopts a peer tab's entry for the new day", () => {
      const set = vi.fn();
      const tomorrow = "2026-10-16";
      const { rerender } = renderHook((p: { today: string; h: readonly ForecastHistoryEntry[] }) =>
        useForecastHistoryRecorder(deps({ today: p.today, forecastHistory: p.h, setForecastHistory: set, sharedStorage: false })),
        { initialProps: { today: TODAY, h: [] as readonly ForecastHistoryEntry[] } });
      expect(set).toHaveBeenCalledTimes(1);
      rerender({ today: tomorrow, h: [ENTRY, { ...ENTRY, date: tomorrow, p50: "2026-11-02" }] });
      expect(set).toHaveBeenCalledTimes(1);
    });

    it("two tabs on single-device storage, both open across midnight, write at most once each and settle", () => {
      // The tabs share ONE history (the broadcast), but both effects can run before either write lands.
      const holidaysB = new Set<string>(["2026-10-20"]);
      compute.mockImplementation((a: { holidaySet: ReadonlySet<string> }) =>
        a.holidaySet === holidaysB ? { ...FORECAST, p50: "2026-11-02" } : FORECAST);
      const writes = vi.fn();
      const writer = (tab: string, set: (u: SetStateAction<readonly ForecastHistoryEntry[]>) => void): ForecastHistoryRecorderDeps["setForecastHistory"] => (u) => {
        writes(tab);
        set(u);
      };
      const { result, rerender } = renderHook((today: string) => {
        const [history, setHistory] = useState<readonly ForecastHistoryEntry[]>([]);
        const [writeA] = useState(() => writer("A", setHistory));
        const [writeB] = useState(() => writer("B", setHistory));
        useForecastHistoryRecorder(deps({ today, forecastHistory: history, setForecastHistory: writeA, sharedStorage: false }));
        useForecastHistoryRecorder(deps({ today, holidaySet: holidaysB, forecastHistory: history, setForecastHistory: writeB, sharedStorage: false }));
        return history;
      }, { initialProps: TODAY });
      const atLoad = writes.mock.calls.length;
      rerender("2026-10-16");
      rerender("2026-10-16");
      const midnight = writes.mock.calls.slice(atLoad).map((c) => c[0]);
      expect(midnight.filter((t) => t === "A").length).toBeLessThanOrEqual(1);
      expect(midnight.filter((t) => t === "B").length).toBeLessThanOrEqual(1);
      expect(midnight.length).toBeGreaterThanOrEqual(1);
      expect(result.current.filter((e) => e.date === "2026-10-16")).toHaveLength(1);
      const settled = writes.mock.calls.length;
      rerender("2026-10-16");
      expect(writes.mock.calls.length).toBe(settled);
    });
  });
});
