import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useActionLearning, LEARNING_LOAD_RETRY_MS } from "./use-action-learning";
import { pickLearningStore } from "./learning-store";
import type { LearningSnapshot } from "./learning-store";
import type { SuggestedAction } from "./next-actions/types";
import { runTursoPipeline } from "./turso-pipeline";
import { StorageNotReadyError } from "./workspace";

vi.mock("./turso-pipeline", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./turso-pipeline")>()),
  runTursoPipeline: vi.fn(),
}));

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
    const { result } = renderHook(() => useActionLearning({ config: cfg(false), tursoConfig: null, isPopout: false, hydrated: true }));
    await act(async () => { await result.current.record(action("raid", "wk"), "dismissed"); });
    expect(result.current.bias).toEqual({});
  });
  it("records when enabled and surfaces bias after enough evidence", async () => {
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false, hydrated: true }));
    // 4 (not 3) dismissals: time-decay applied on each record shaves accumulated
    // counts a hair below the MIN_EVIDENCE=3 threshold when wall-clock advances a
    // ms between calls, so 4 clears it deterministically. Intent unchanged.
    await act(async () => {
      for (let i = 0; i < 4; i++) await result.current.record(action("raid", "wk"), "dismissed");
    });
    await waitFor(() => expect(result.current.bias["raid:wk"]).toBeLessThan(0));
  });
  it("setOverride pins bias; reset clears", async () => {
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false, hydrated: true }));
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
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false, hydrated: true }));
    await act(async () => { await result.current.record(action("forecast-sim", "actionForecastSimWhy"), "snoozed"); });
    expect(result.current.state).toEqual({});
    expect(save).not.toHaveBeenCalled();
    // Control: the same call for a measured source does write.
    await act(async () => { await result.current.record(action("milestone", "actionMilestoneWhyAtRisk"), "snoozed"); });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(Object.keys(result.current.state)).toEqual(["milestone:actionMilestoneWhyAtRisk"]);
  });

  it("does not record in a popout", async () => {
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: true, hydrated: true }));
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
      useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false, hydrated: true }),
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
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false, hydrated: true }));
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
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false, hydrated: true }));
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
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false, hydrated: true }));
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
      useActionLearning({ config: { enabled: true, store: "turso" }, tursoConfig: { httpUrl: "https://example.test", authToken: "" }, isPopout: false, hydrated: true }),
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
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false, hydrated: true }));
    await act(async () => { await result.current.reset(); });
    await act(async () => { load.resolve(LOADED); await load.promise; });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toEqual({ state: {}, overrides: {} });
    expect(result.current.state).toEqual({});
  });

  it("saves nothing while the store cannot be read, so an unread store is never overwritten", async () => {
    const save = vi.fn<(snap: LearningSnapshot) => Promise<void>>(async () => {});
    vi.mocked(pickLearningStore).mockReturnValue({ load: () => Promise.reject(new StorageNotReadyError("storage-unreachable")), save });
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false, hydrated: true }));
    await act(async () => { await result.current.record(action("raid", "early"), "acted"); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await result.current.record(action("raid", "late"), "acted"); });
    expect(Object.keys(result.current.state).sort()).toEqual(["raid:early", "raid:late"]); // kept in memory
    expect(save).not.toHaveBeenCalled();
  });
});

// §781 (round 2) — the two remaining sides of the race.
describe("useActionLearning — late loads and failed loads (§781)", () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => { resolve = res; });
    return { promise, resolve };
  }
  const row = (acted: number) => ({ acted, snoozed: 0, dismissed: 0, lastAt: 1000 });
  const LOADED: LearningSnapshot = { state: { "raid:a": row(3), "milestone:b": row(2) }, overrides: {} };

  afterEach(() => { vi.useRealTimers(); });

  // A load that resolves AFTER a write must not overwrite the newer in-memory
  // outcome: the hook shows the stored rows AND the write, at once.
  it("merges a late load under a newer in-memory outcome instead of replacing it", async () => {
    const load = deferred<LearningSnapshot>();
    vi.mocked(pickLearningStore).mockReturnValue({ load: () => load.promise, save: vi.fn<(snap: LearningSnapshot) => Promise<void>>(async () => {}) });
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false, hydrated: true }));
    await act(async () => { await result.current.record(action("raid", "a"), "acted"); });
    expect(result.current.state["raid:a"].acted).toBe(1); // the outcome shows before the load
    // Stored "now", so decay between the stored row and the outcome is negligible.
    const fresh = { ...LOADED, state: { ...LOADED.state, "raid:a": { ...row(3), lastAt: Date.now() } } };
    await act(async () => { load.resolve(fresh); await load.promise; });
    expect(Object.keys(result.current.state).sort()).toEqual(["milestone:b", "raid:a"]);
    expect(result.current.state["raid:a"].acted).toBeCloseTo(4, 2); // 3 stored + 1 new, not 1 and not 3
  });

  // A failed load is retried (as `useScheduledJobs` retries its read); the
  // outcome waits in memory and is saved, on top of the stored rows, once a load
  // succeeds. Nothing is written while the store cannot be read.
  it("keeps an outcome through a failed load and saves it after a retried load succeeds", async () => {
    vi.useFakeTimers();
    const save = vi.fn<(snap: LearningSnapshot) => Promise<void>>(async () => {});
    const load = vi.fn<() => Promise<LearningSnapshot>>()
      .mockRejectedValueOnce(new StorageNotReadyError("storage-unreachable"))
      .mockResolvedValue(LOADED);
    vi.mocked(pickLearningStore).mockReturnValue({ load, save });
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false, hydrated: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); }); // the first load fails
    await act(async () => { await result.current.record(action("budget", "c"), "acted"); });
    expect(save).not.toHaveBeenCalled();
    expect(Object.keys(result.current.state)).toEqual(["budget:c"]); // kept in memory
    await act(async () => { await vi.advanceTimersByTimeAsync(LEARNING_LOAD_RETRY_MS); });
    expect(load).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(Object.keys(save.mock.calls[0][0].state).sort()).toEqual(["budget:c", "milestone:b", "raid:a"]);
    expect(Object.keys(result.current.state).sort()).toEqual(["budget:c", "milestone:b", "raid:a"]);
  });

  // Once the timed retries are used up, the next write starts a fresh round, so an
  // outcome recorded after a long outage is still saved once the store is back.
  it("retries the load on the next write after the timed retries run out", async () => {
    vi.useFakeTimers();
    const save = vi.fn<(snap: LearningSnapshot) => Promise<void>>(async () => {});
    const load = vi.fn<() => Promise<LearningSnapshot>>().mockRejectedValue(new StorageNotReadyError("storage-unreachable"));
    vi.mocked(pickLearningStore).mockReturnValue({ load, save });
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false, hydrated: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(LEARNING_LOAD_RETRY_MS * 10); });
    const attempts = load.mock.calls.length; // the first load + every timed retry
    expect(attempts).toBeGreaterThan(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(LEARNING_LOAD_RETRY_MS * 10); });
    expect(load).toHaveBeenCalledTimes(attempts); // no more timed retries
    load.mockResolvedValue(LOADED);
    await act(async () => { await result.current.record(action("budget", "c"), "acted"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(load).toHaveBeenCalledTimes(attempts + 1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(Object.keys(save.mock.calls[0][0].state).sort()).toEqual(["budget:c", "milestone:b", "raid:a"]);
  });
});

// §781 (round 3) — the store identity, StrictMode, surfacing and replay order.
describe("useActionLearning — store identity and authority (§781)", () => {
  beforeEach(() => {
    vi.mocked(pickLearningStore).mockClear();
    vi.mocked(runTursoPipeline).mockReset();
  });
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => { resolve = res; });
    return { promise, resolve };
  }
  const row = (acted: number) => ({ acted, snoozed: 0, dismissed: 0, lastAt: Date.now() });
  const TURSO = { httpUrl: "https://example.test", authToken: "t" };
  const selectOf = (kinds: string[]) => ({
    type: "ok" as const,
    response: {
      type: "execute",
      result: {
        cols: [{ name: "kind" }, { name: "acted" }, { name: "snoozed" }, { name: "dismissed" }, { name: "last_at" }, { name: "override" }],
        rows: kinds.map((k) => [{ value: k }, { value: "2" }, { value: "0" }, { value: "0" }, { value: String(Date.now()) }, { value: "auto" }]),
      },
    },
  });
  const isSelect = (stmts: { sql: string }[]) => stmts.some((s) => s.sql.startsWith("SELECT"));
  const isRewrite = (stmts: { sql: string }[]) => stmts.some((s) => s.sql.startsWith("DELETE") && s.sql.includes("action_learning"));
  const insertedKinds = (stmts: { sql: string; args?: unknown[] }[]) =>
    stmts.filter((s) => s.sql.startsWith("INSERT INTO action_learning")).map((s) => (s.args?.[0] as { value: string }).value).sort();

  // C1 — task-manager mounts the hook with DEFAULT settings (local, learning off)
  // and hydrates to the user's real config later. The load must wait for that,
  // read the store the user configured, and only then may a save rewrite it.
  it("loads nothing before settings hydrate, then reads Turso before it ever rewrites it", async () => {
    const pipeline = vi.mocked(runTursoPipeline);
    pipeline.mockImplementation(async (_cfg, stmts) => (isSelect(stmts) ? [{ type: "ok" } as never, selectOf(["raid:stored"]) as never] : []));
    localStorage.setItem("aipm-cockpit:action-learning", JSON.stringify({ state: { "raid:localonly": row(1) }, overrides: {} }));
    type P = { config: { enabled: boolean; store: "local" | "turso" }; tursoConfig: typeof TURSO | null; hydrated: boolean };
    const { result, rerender } = renderHook((p: P) => useActionLearning({ ...p, isPopout: false }), {
      initialProps: { config: { enabled: false, store: "local" }, tursoConfig: null, hydrated: false },
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(vi.mocked(pickLearningStore)).not.toHaveBeenCalled(); // no store is touched before hydration
    rerender({ config: { enabled: true, store: "turso" }, tursoConfig: TURSO, hydrated: true });
    await waitFor(() => expect(pipeline.mock.calls.some((c) => isSelect(c[1]))).toBe(true));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await result.current.record(action("raid", "new"), "acted"); });
    await waitFor(() => expect(pipeline.mock.calls.some((c) => isRewrite(c[1]))).toBe(true));
    const firstRead = pipeline.mock.calls.findIndex((c) => isSelect(c[1]));
    const firstRewrite = pipeline.mock.calls.findIndex((c) => isRewrite(c[1]));
    expect(firstRead).toBeLessThan(firstRewrite);
    expect(insertedKinds(pipeline.mock.calls[firstRewrite][1])).toEqual(["raid:new", "raid:stored"]); // never the local-only row
  });

  // Store switch (owner: fix it now) — switching local → Turso after the load
  // must read Turso, add only this session's later writes, and save there; the
  // local rows are not copied over the global table.
  it("switching the store after the load reads the target and never overwrites it", async () => {
    const pipeline = vi.mocked(runTursoPipeline);
    const tursoLoad = deferred<Awaited<ReturnType<typeof runTursoPipeline>>>();
    pipeline.mockImplementation(async (_cfg, stmts) => (isSelect(stmts) ? tursoLoad.promise : []));
    localStorage.setItem("aipm-cockpit:action-learning", JSON.stringify({ state: { "raid:local": row(1) }, overrides: {} }));
    type P = { config: { enabled: boolean; store: "local" | "turso" }; tursoConfig: typeof TURSO | null };
    const { result, rerender } = renderHook((p: P) => useActionLearning({ ...p, isPopout: false, hydrated: true }), {
      initialProps: { config: { enabled: true, store: "local" }, tursoConfig: TURSO },
    });
    await waitFor(() => expect(Object.keys(result.current.state)).toEqual(["raid:local"]));
    rerender({ config: { enabled: true, store: "turso" }, tursoConfig: TURSO });
    await act(async () => { await result.current.record(action("raid", "after"), "acted"); });
    expect(pipeline.mock.calls.some((c) => isRewrite(c[1]))).toBe(false); // nothing before Turso is read
    await act(async () => { tursoLoad.resolve([{ type: "ok" } as never, selectOf(["raid:remote"]) as never]); await tursoLoad.promise; });
    await waitFor(() => expect(pipeline.mock.calls.some((c) => isRewrite(c[1]))).toBe(true));
    const rewrite = pipeline.mock.calls.find((c) => isRewrite(c[1]))!;
    expect(insertedKinds(rewrite[1])).toEqual(["raid:after", "raid:remote"]);
    expect(Object.keys(result.current.state).sort()).toEqual(["raid:after", "raid:remote"]);
    // The local store keeps its own rows.
    expect(Object.keys(JSON.parse(localStorage.getItem("aipm-cockpit:action-learning")!).state)).toEqual(["raid:local"]);
  });

  // The queued save goes to the store OBJECT whose load succeeded, never a re-pick.
  it("saves the replayed queue to the very store it loaded from", async () => {
    const loads: ReturnType<typeof deferred<LearningSnapshot>>[] = [];
    const stores: { load: () => Promise<LearningSnapshot>; save: ReturnType<typeof vi.fn<(snap: LearningSnapshot) => Promise<void>>> }[] = [];
    vi.mocked(pickLearningStore).mockImplementation(() => {
      const d = deferred<LearningSnapshot>();
      loads.push(d);
      const store = { load: () => d.promise, save: vi.fn<(snap: LearningSnapshot) => Promise<void>>(async () => {}) };
      stores.push(store);
      return store;
    });
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false, hydrated: true }));
    await act(async () => { await result.current.record(action("raid", "early"), "acted"); });
    await act(async () => { loads[0].resolve({ state: { "raid:a": row(3) }, overrides: {} }); await loads[0].promise; });
    await waitFor(() => expect(stores[0].save).toHaveBeenCalledTimes(1));
    expect(stores.slice(1).every((s) => s.save.mock.calls.length === 0)).toBe(true);
  });

  // I1 — under real StrictMode the mount effect runs twice and two loads start.
  // Only the LATEST is authoritative; the stale one must not drain the queue,
  // flip the state or save. `wrapper: StrictMode` is load-bearing
  // (strictmode.meta.test.tsx): composed inside a wrapper it would not double-invoke.
  it("under StrictMode, a stale load neither drains the queue nor saves", async () => {
    const loads = [deferred<LearningSnapshot>(), deferred<LearningSnapshot>()];
    let n = 0;
    const save = vi.fn<(snap: LearningSnapshot) => Promise<void>>(async () => {});
    vi.mocked(pickLearningStore).mockReturnValue({ load: () => loads[Math.min(n++, 1)].promise, save });
    const { result } = renderHook(
      () => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false, hydrated: true }),
      { wrapper: StrictMode },
    );
    expect(n).toBe(2); // the double invoke really happened, or this test proves nothing
    const LOADED: LearningSnapshot = { state: { "raid:a": row(3) }, overrides: {} };
    await act(async () => { await result.current.record(action("raid", "early"), "acted"); });
    await act(async () => { loads[0].resolve(LOADED); await loads[0].promise; });
    await act(async () => { await result.current.record(action("raid", "mid"), "acted"); });
    expect(save).not.toHaveBeenCalled(); // the stale load saved nothing and left the hook pending
    await act(async () => { loads[1].resolve(LOADED); await loads[1].promise; });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(Object.keys(save.mock.calls[0][0].state).sort()).toEqual(["raid:a", "raid:early", "raid:mid"]);
    await act(async () => { await result.current.record(action("raid", "late"), "acted"); });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(Object.keys(save.mock.calls[1][0].state).sort()).toEqual(["raid:a", "raid:early", "raid:late", "raid:mid"]);
  });

  // Replay order: record, reset, record — only the last record survives.
  it("replays queued writes in the order they were made", async () => {
    const load = deferred<LearningSnapshot>();
    const save = vi.fn<(snap: LearningSnapshot) => Promise<void>>(async () => {});
    vi.mocked(pickLearningStore).mockReturnValue({ load: () => load.promise, save });
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false, hydrated: true }));
    await act(async () => {
      await result.current.record(action("raid", "first"), "acted");
      await result.current.reset();
      await result.current.record(action("raid", "last"), "acted");
    });
    await act(async () => { load.resolve({ state: { "raid:a": row(3) }, overrides: {} }); await load.promise; });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(Object.keys(save.mock.calls[0][0].state)).toEqual(["raid:last"]);
  });

  // I2 — a failed load is surfaced: `loadFailed` drives the view's notice, and the
  // first write held by it is reported once (the caller toasts it).
  it("reports a failed load once, on the first write it holds", async () => {
    const onError = vi.fn<(kind: "load" | "save" | "rejected", err: unknown) => void>();
    vi.mocked(pickLearningStore).mockReturnValue({ load: () => Promise.reject(new StorageNotReadyError("storage-unreachable")), save: vi.fn(async () => {}) });
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false, hydrated: true, onError }));
    await waitFor(() => expect(result.current.loadFailed).toBe(true));
    expect(onError).not.toHaveBeenCalled(); // nothing to report until the user writes
    await act(async () => { await result.current.record(action("raid", "x"), "acted"); });
    await act(async () => { await result.current.setOverride("raid:x", "suppress"); });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe("load");
  });

  // M2 — save errors are reported, once per failing streak.
  it("reports a failed save once until a save succeeds", async () => {
    const onError = vi.fn<(kind: "load" | "save" | "rejected", err: unknown) => void>();
    const save = vi.fn<(snap: LearningSnapshot) => Promise<void>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue(undefined);
    vi.mocked(pickLearningStore).mockReturnValue({ load: async () => ({ state: {}, overrides: {} }), save });
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false, hydrated: true, onError }));
    await waitFor(() => expect(vi.mocked(pickLearningStore)).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    for (let i = 0; i < 2; i++) await act(async () => { await result.current.record(action("raid", "x"), "acted"); });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe("save");
  });
});

// §781 (round 4) — a PERMANENT load failure (a rejected token) stops the retries
// and is shown at once; fixing the token in Settings starts a fresh load.
describe("useActionLearning — permanent load failure (§781)", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("stops retrying on a rejected token, reports it at once, and reloads when the token changes", async () => {
    vi.useFakeTimers();
    const onError = vi.fn<(kind: "load" | "save" | "rejected", err: unknown) => void>();
    const save = vi.fn<(snap: LearningSnapshot) => Promise<void>>(async () => {});
    const load = vi.fn<() => Promise<LearningSnapshot>>().mockRejectedValue(new StorageNotReadyError("turso-token-rejected"));
    vi.mocked(pickLearningStore).mockReturnValue({ load, save });
    type P = { tursoConfig: { httpUrl: string; authToken: string } };
    const { result, rerender } = renderHook(
      (p: P) => useActionLearning({ config: { enabled: true, store: "turso" }, tursoConfig: p.tursoConfig, isPopout: false, hydrated: true, onError }),
      { initialProps: { tursoConfig: { httpUrl: "https://example.test", authToken: "old" } } },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.loadFailed).toBe(true);
    expect(onError.mock.calls.map((c) => c[0])).toEqual(["rejected"]); // shown at once, not on a later write
    await act(async () => { await vi.advanceTimersByTimeAsync(LEARNING_LOAD_RETRY_MS * 20); });
    expect(load).toHaveBeenCalledTimes(1); // no timed retries
    await act(async () => { await result.current.record(action("raid", "held"), "acted"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(load).toHaveBeenCalledTimes(1); // a write does not hammer a rejected store either
    expect(onError).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    // The user fixes the token: same URL, new token → a fresh load, and the held write is saved on top.
    load.mockResolvedValue({ state: { "raid:stored": { acted: 2, snoozed: 0, dismissed: 0, lastAt: Date.now() } }, overrides: {} });
    rerender({ tursoConfig: { httpUrl: "https://example.test", authToken: "new" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(load).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(Object.keys(save.mock.calls[0][0].state).sort()).toEqual(["raid:held", "raid:stored"]);
    expect(result.current.loadFailed).toBe(false);
  });
});
