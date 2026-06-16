import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useActionLearning } from "./use-action-learning";
import { pickLearningStore } from "./learning-store";
import type { LearningSnapshot } from "./learning-store";
import type { SuggestedAction } from "./next-actions/types";

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
