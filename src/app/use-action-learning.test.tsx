import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useActionLearning } from "./use-action-learning";
import { pickLearningStore } from "./learning-store";
import type { LearningSnapshot } from "./learning-store";
import type { SuggestedAction } from "./next-actions/types";
import { runTursoPipeline } from "./turso-pipeline";

vi.mock("./turso-pipeline", () => ({ runTursoPipeline: vi.fn() }));

// Holder for the real pickLearningStore so the default-mock implementation can
// call through. vi.hoisted runs before the hoisted vi.mock factory.
const stash = vi.hoisted(() => ({ real: null as null | typeof pickLearningStore }));
vi.mock("./learning-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./learning-store")>();
  stash.real = actual.pickLearningStore;
  return { ...actual, pickLearningStore: vi.fn() };
});

function action(source: SuggestedAction["source"], whyKey: string): SuggestedAction {
  return { id: `${source}:1:x`, source, title: { key: "x" as never }, why: { key: whyKey as never }, score: 40, tier: "soon", cta: { kind: "snooze", actionId: "x" } };
}
const cfg = (enabled: boolean) => ({ enabled, store: "local" as const });

beforeEach(() => {
  localStorage.clear();
  // Default: call through to the real store picker. restoreAllMocks() strips a
  // vi.fn's implementation, so re-establish the passthrough before every test.
  vi.mocked(pickLearningStore).mockImplementation((...args) => stash.real!(...args));
});
afterEach(() => vi.restoreAllMocks());

describe("useActionLearning", () => {
  it("records nothing when disabled", async () => {
    const { result } = renderHook(() => useActionLearning({ config: cfg(false), tursoConfig: null, isPopout: false }));
    await act(async () => { await result.current.record(action("raid", "wk"), "dismissed"); });
    expect(result.current.bias).toEqual({});
  });
  it("records when enabled and surfaces bias after enough evidence", async () => {
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false }));
    // 4 (not 3) dismissals: time-decay applied on each record shaves accumulated
    // counts a hair below the MIN_EVIDENCE=3 threshold when wall-clock advances a
    // ms between calls, so 4 clears it deterministically. Intent unchanged.
    await act(async () => {
      for (let i = 0; i < 4; i++) await result.current.record(action("raid", "wk"), "dismissed");
    });
    await waitFor(() => expect(result.current.bias["raid:wk"]).toBeLessThan(0));
  });
  it("setOverride pins bias; reset clears", async () => {
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false }));
    await act(async () => { await result.current.setOverride("raid:wk", "surface"); });
    await waitFor(() => expect(result.current.bias["raid:wk"]).toBeGreaterThan(0));
    await act(async () => { await result.current.reset(); });
    await waitFor(() => expect(result.current.bias).toEqual({}));
  });
  // §502 — a simulated signal must never teach the learning layer: it is not a
  // measured signal, and the flat list (which learning keys on) never holds it.
  it("records nothing for a forecast-sim action", async () => {
    const save = vi.fn(async () => {});
    vi.mocked(pickLearningStore).mockReturnValue({ load: async () => ({ state: {}, overrides: {} }), save });
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false }));
    await act(async () => { await result.current.record(action("forecast-sim", "actionForecastSimWhy"), "snoozed"); });
    expect(result.current.state).toEqual({});
    expect(save).not.toHaveBeenCalled();
    // Control: the same call for a measured source does write.
    await act(async () => { await result.current.record(action("milestone", "actionMilestoneWhyAtRisk"), "snoozed"); });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(Object.keys(result.current.state)).toEqual(["milestone:actionMilestoneWhyAtRisk"]);
  });

  it("does not record in a popout", async () => {
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: true }));
    await act(async () => { await result.current.record(action("raid", "wk"), "dismissed"); });
    expect(result.current.bias).toEqual({});
  });

  it("serializes rapid saves so the last write wins on an out-of-order async store", async () => {
    // A store whose save resolves OUT of order: the first save is slow, later
    // ones are fast. Without serialization the slow (stale) write would settle
    // last and revert the newer outcome. We capture saves in settle order and
    // assert the final settled write reflects all 3 increments.
    const settled: LearningSnapshot[] = [];
    let inFlight = 0;
    let maxConcurrent = 0;
    let n = 0;
    const store = {
      load: async (): Promise<LearningSnapshot> => ({ state: {}, overrides: {} }),
      save: (snap: LearningSnapshot): Promise<void> => {
        inFlight += 1;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        // First save slow (30ms), every later save fast (1ms): out-of-order
        // settling unless the hook chains them.
        const delay = n++ === 0 ? 30 : 1;
        return new Promise<void>((resolve) =>
          setTimeout(() => {
            settled.push(snap);
            inFlight -= 1;
            resolve();
          }, delay),
        );
      },
    };
    vi.mocked(pickLearningStore).mockReturnValue(store);

    const { result } = renderHook(() =>
      useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false }),
    );
    await act(async () => {
      for (let i = 0; i < 3; i++) await result.current.record(action("raid", "wk"), "dismissed");
    });

    await waitFor(() => expect(settled).toHaveLength(3));
    // Saves never overlap (each starts only after the previous settles) — this is
    // what serialization buys; without it maxConcurrent would be 3.
    expect(maxConcurrent).toBe(1);
    // Settle order is strictly increasing — the slow first write did NOT land last.
    // (Counts are ~1/2/3; decay-on-record can shave a hair, so compare ordering,
    // not exact integers.)
    const counts = settled.map((s) => s.state["raid:wk"].dismissed);
    expect(counts[0]).toBeLessThan(counts[1]);
    expect(counts[1]).toBeLessThan(counts[2]);
    // The LAST settled write carries the newest snapshot (== the hook's state).
    expect(counts[2]).toBeCloseTo(result.current.state["raid:wk"].dismissed, 5);
  });
});

// §778 — one signal, one learning kind: a singular-count why key ("…One") is
// learned under its plural sibling, and rows or overrides already stored under
// the singular kind merge into it on load (and are written back merged).
describe("useActionLearning — count-variant why keys (§778)", () => {
  const ONE = "task-due:actionTaskWhySoonOne";
  const MANY = "task-due:actionTaskWhySoon";

  it("records a singular-count action under the plural kind", async () => {
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false }));
    await act(async () => { await result.current.record(action("task-due", "actionTaskWhySoonOne"), "acted"); });
    await waitFor(() => expect(Object.keys(result.current.state)).toEqual([MANY]));
  });

  it("merges stored singular rows and overrides on load, and saves them merged", async () => {
    localStorage.setItem("aipm-cockpit:action-learning", JSON.stringify({
      state: {
        [ONE]: { acted: 2, snoozed: 0, dismissed: 0, lastAt: 1000 },
        [MANY]: { acted: 1, snoozed: 0, dismissed: 1, lastAt: 1000 },
      },
      overrides: { [ONE]: "suppress" },
    }));
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false }));
    await waitFor(() => expect(result.current.state).toEqual({ [MANY]: { acted: 3, snoozed: 0, dismissed: 1, lastAt: 1000 } }));
    expect(result.current.overrides).toEqual({ [MANY]: "suppress" });
    expect(result.current.bias[MANY]).toBeLessThan(0);
    // The next write stores the merged snapshot; the singular row is gone.
    await act(async () => { await result.current.record(action("raid", "wk"), "acted"); });
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("aipm-cockpit:action-learning") ?? "{}");
      expect(Object.keys(stored.state).sort()).toEqual([MANY, "raid:wk"].sort());
      expect(stored.overrides).toEqual({ [MANY]: "suppress" });
    });
  });
});

// §781 — an outcome, override or reset made BEFORE the mount load resolves used
// to set `dirtyRef`, drop the loaded snapshot and save only the new write. On
// Turso that save is a full rewrite of action_learning (clear + re-insert), so one
// early snooze wiped the GLOBAL learning table. Early writes now queue and apply
// on top of the loaded snapshot; nothing is saved until the load has resolved,
// and nothing at all after a FAILED load (the store's contents are unknown then).
describe("useActionLearning — writes before the load resolves (§781)", () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => { resolve = res; });
    return { promise, resolve };
  }
  const row = (acted: number) => ({ acted, snoozed: 0, dismissed: 0, lastAt: 1000 });
  const LOADED: LearningSnapshot = {
    state: { "raid:a": row(3), "milestone:b": row(2), "budget:c": row(1) },
    overrides: { "milestone:b": "suppress" },
  };

  it("merges an early outcome and override into the loaded snapshot instead of replacing it", async () => {
    const load = deferred<LearningSnapshot>();
    const save = vi.fn<(snap: LearningSnapshot) => Promise<void>>(async () => {});
    vi.mocked(pickLearningStore).mockReturnValue({ load: () => load.promise, save });
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false }));
    await act(async () => {
      await result.current.record(action("raid", "early"), "acted");
      await result.current.setOverride("budget:c", "surface");
    });
    expect(save).not.toHaveBeenCalled(); // nothing is written before the load resolves
    await act(async () => { load.resolve(LOADED); await load.promise; });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const saved = save.mock.calls[0][0];
    expect(Object.keys(saved.state).sort()).toEqual(["budget:c", "milestone:b", "raid:a", "raid:early"]);
    expect(saved.state["raid:a"]).toEqual(row(3));
    expect(saved.overrides).toEqual({ "milestone:b": "suppress", "budget:c": "surface" });
    expect(result.current.state).toEqual(saved.state);
  });

  it("keeps every stored row on the Turso path (the statements re-insert them all)", async () => {
    const pipeline = vi.mocked(runTursoPipeline);
    const load = deferred<Awaited<ReturnType<typeof runTursoPipeline>>>();
    const selectResult = {
      type: "ok" as const,
      response: {
        type: "execute",
        result: {
          cols: [{ name: "kind" }, { name: "acted" }, { name: "snoozed" }, { name: "dismissed" }, { name: "last_at" }, { name: "override" }],
          rows: [
            [{ value: "raid:a" }, { value: "3" }, { value: "0" }, { value: "0" }, { value: "1000" }, { value: "auto" }],
            [{ value: "milestone:b" }, { value: "2" }, { value: "0" }, { value: "0" }, { value: "1000" }, { value: "suppress" }],
          ],
        },
      },
    };
    pipeline.mockImplementationOnce(() => load.promise).mockImplementation(async () => []);
    const { result } = renderHook(() =>
      useActionLearning({ config: { enabled: true, store: "turso" }, tursoConfig: { httpUrl: "https://example.test", authToken: "" }, isPopout: false }),
    );
    await act(async () => { await result.current.record(action("raid", "early"), "snoozed"); });
    expect(pipeline).toHaveBeenCalledTimes(1); // only the load: no rewrite went out early
    await act(async () => { load.resolve([{ type: "ok" } as never, selectResult as never]); await load.promise; });
    await waitFor(() => expect(pipeline).toHaveBeenCalledTimes(2));
    const stmts = pipeline.mock.calls[1][1];
    const clearAt = stmts.findIndex((s) => s.sql.startsWith("DELETE") && s.sql.includes("action_learning"));
    const inserts = stmts.filter((s) => s.sql.startsWith("INSERT INTO action_learning"));
    const kinds = inserts.map((s) => (s.args?.[0] as { value: string }).value).sort();
    expect(clearAt).toBeGreaterThanOrEqual(0); // the store still rewrites in full...
    expect(kinds).toEqual(["milestone:b", "raid:a", "raid:early"]); // ...and every stored row is re-inserted
    const b = inserts.find((s) => (s.args?.[0] as { value: string }).value === "milestone:b");
    expect((b?.args?.[5] as { value: string }).value).toBe("suppress");
  });

  it("an early reset still clears everything, as the user asked", async () => {
    const load = deferred<LearningSnapshot>();
    const save = vi.fn<(snap: LearningSnapshot) => Promise<void>>(async () => {});
    vi.mocked(pickLearningStore).mockReturnValue({ load: () => load.promise, save });
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false }));
    await act(async () => { await result.current.reset(); });
    await act(async () => { load.resolve(LOADED); await load.promise; });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toEqual({ state: {}, overrides: {} });
    expect(result.current.state).toEqual({});
  });

  it("writes nothing after a failed load, so an unreadable store is never overwritten", async () => {
    const save = vi.fn<(snap: LearningSnapshot) => Promise<void>>(async () => {});
    vi.mocked(pickLearningStore).mockReturnValue({ load: () => Promise.reject(new Error("offline")), save });
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false }));
    await act(async () => { await result.current.record(action("raid", "early"), "acted"); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await result.current.record(action("raid", "late"), "acted"); });
    expect(Object.keys(result.current.state).sort()).toEqual(["raid:early", "raid:late"]); // kept in memory
    expect(save).not.toHaveBeenCalled();
  });
});
