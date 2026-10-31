import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
// Rendered without task-manager's AI privacy provider: requests carry the privacy of no project.
vi.mock("./ai-privacy-context", () => import("../test/ai-privacy-unprotected"));
import { act, renderHook } from "@testing-library/react";
import { useInsightRecommendRunner, type InsightRecommendRunnerArgs } from "./use-insight-recommend-runner";
import { runInsightRecommendation } from "./insights/recommend-call";
import { MAX_BG_RECS_PER_TICK, type Insight, type InsightRecommendation } from "./insights/insight";
import type { GroundingIndex } from "./action-ai";
import { AiWeeklyCapReachedError } from "./ai-consent";
import { AiKeyRefusedError } from "./ai-errors";

vi.mock("./insights/recommend-call", () => ({ runInsightRecommendation: vi.fn() }));

const mockRun = vi.mocked(runInsightRecommendation);

function makeInsight(id: number, overrides: Partial<Insight> = {}): Insight {
  return {
    id,
    key: `insight-${id}`,
    type: "stalledWork",
    severity: "medium",
    data: {},
    status: "active",
    firstSeenAt: "2026-01-01",
    lastSeenAt: "2026-01-01",
    occurrences: 1,
    ...overrides,
  };
}

const emptyIndex: GroundingIndex = {
  "open-points": new Set<number>(),
  raid: new Set<number>(),
  milestones: new Set<number>(),
  changes: new Set<number>(),
  stakeholders: new Set<number>(),
};

const fakeRec: InsightRecommendation = {
  summary: "do the thing",
  proposedCalls: [],
  generatedAt: "2026-01-01",
  status: "proposed",
};

async function flushMicrotasks(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

function renderRunner(overrides: Partial<InsightRecommendRunnerArgs> = {}) {
  const applyRecommendation = vi.fn();
  const args: InsightRecommendRunnerArgs = {
    enabled: true,
    guidesReady: true,
    insights: [],
    ai: { apiKey: "sk-ant-test", model: "claude-test" },
    today: "2026-01-01",
    intervalMinutes: 60,
    buildIndex: () => emptyIndex,
    buildContextFor: (i) => `context for ${i.id}`,
    applyRecommendation,
    ...overrides,
  };
  const view = renderHook(() => useInsightRecommendRunner(args));
  return { ...view, applyRecommendation };
}

beforeEach(() => {
  vi.useFakeTimers();
  mockRun.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useInsightRecommendRunner", () => {
  // §350: each candidate's snapshot is read BEFORE its billed call and handed
  // to the store with the result, so the token covers the model round-trip.
  test("reads each candidate's entity snapshot before its call and hands it to the store", async () => {
    const order: string[] = [];
    const snap = { tasks: [], raid: [], changes: [], milestones: [], stakeholders: [], historyLength: 0, historyDigest: "" };
    const snapshotEntities = vi.fn(() => { order.push("snapshot"); return snap; });
    mockRun.mockImplementation(async () => { order.push("call"); return fakeRec; });
    const { applyRecommendation } = renderRunner({ insights: [makeInsight(1)], snapshotEntities });
    await act(async () => { await flushMicrotasks(); });
    expect(order).toEqual(["snapshot", "call"]);
    expect(applyRecommendation).toHaveBeenCalledWith(1, fakeRec, snap);
  });

  test("enabled:false never calls runInsightRecommendation", async () => {
    renderRunner({ enabled: false, insights: [makeInsight(1)] });
    await act(async () => { await flushMicrotasks(); });
    act(() => { vi.advanceTimersByTime(20 * 60 * 1000); });
    await act(async () => { await flushMicrotasks(); });
    expect(mockRun).not.toHaveBeenCalled();
  });

  test("generates a recommendation for each active/acknowledged candidate without one", async () => {
    mockRun.mockResolvedValue(fakeRec);
    const insights = [makeInsight(1), makeInsight(2, { status: "acknowledged" })];
    const { applyRecommendation } = renderRunner({ insights });
    await act(async () => { await flushMicrotasks(); });
    expect(mockRun).toHaveBeenCalledTimes(2);
    expect(applyRecommendation).toHaveBeenCalledWith(1, fakeRec, undefined);
    expect(applyRecommendation).toHaveBeenCalledWith(2, fakeRec, undefined);
  });

  test("caps at MAX_BG_RECS_PER_TICK candidates per tick", async () => {
    mockRun.mockResolvedValue(fakeRec);
    const insights = [1, 2, 3, 4, 5].map((id) => makeInsight(id));
    renderRunner({ insights });
    await act(async () => { await flushMicrotasks(); });
    expect(mockRun).toHaveBeenCalledTimes(MAX_BG_RECS_PER_TICK);
  });

  test("stops between candidates when enabled flips to false while the first call is pending (AI-01)", async () => {
    let settleFirst!: (rec: InsightRecommendation) => void;
    mockRun.mockImplementationOnce(() => new Promise<InsightRecommendation>((resolve) => { settleFirst = resolve; }));
    mockRun.mockResolvedValue(fakeRec);
    const insights = [makeInsight(1), makeInsight(2), makeInsight(3)];
    const { rerender } = renderHook(
      (p: { enabled: boolean }) => useInsightRecommendRunner({
        enabled: p.enabled, guidesReady: true, insights, ai: { apiKey: "sk-ant-test", model: "claude-test" },
        today: "2026-01-01", intervalMinutes: 60, buildIndex: () => emptyIndex,
        buildContextFor: (i) => `context for ${i.id}`, applyRecommendation: vi.fn(),
      }),
      { initialProps: { enabled: true } },
    );
    await act(async () => { await flushMicrotasks(); });
    expect(mockRun).toHaveBeenCalledTimes(1); // candidate 1 is in flight
    rerender({ enabled: false }); // the user withdraws the background consent
    await act(async () => { settleFirst(fakeRec); await flushMicrotasks(); });
    expect(mockRun).toHaveBeenCalledTimes(1); // no second billed call
  });

  test("a candidate stopped by the weekly hard cap ends the tick (AI-03)", async () => {
    mockRun.mockRejectedValueOnce(new AiWeeklyCapReachedError());
    mockRun.mockResolvedValue(fakeRec);
    const { applyRecommendation } = renderRunner({ insights: [makeInsight(1), makeInsight(2), makeInsight(3)] });
    await act(async () => { await flushMicrotasks(); });
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(applyRecommendation).not.toHaveBeenCalled();
  });

  // AI organisation key: a refused key is refused for every remaining candidate too.
  test.each(["organization", "workspace"] as const)("a key refused by the organisation key check (%s) ends the tick", async (reason) => {
    mockRun.mockRejectedValueOnce(new AiKeyRefusedError(reason));
    mockRun.mockResolvedValue(fakeRec);
    const { applyRecommendation } = renderRunner({ insights: [makeInsight(1), makeInsight(2), makeInsight(3)] });
    await act(async () => { await flushMicrotasks(); });
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(applyRecommendation).not.toHaveBeenCalled();
  });

  test("skips insights that already have a recommendation", async () => {
    mockRun.mockResolvedValue(fakeRec);
    const insights = [makeInsight(1, { recommendation: fakeRec }), makeInsight(2)];
    const { applyRecommendation } = renderRunner({ insights });
    await act(async () => { await flushMicrotasks(); });
    expect(mockRun).toHaveBeenCalledTimes(1);
    // AI-01 — an unattended run: every request asks the background consent.
    expect(mockRun.mock.calls[0][0]).toMatchObject({ level: "background" });
    expect(applyRecommendation).toHaveBeenCalledWith(2, fakeRec, undefined);
    expect(applyRecommendation).not.toHaveBeenCalledWith(1, expect.anything());
  });

  test("swallows a rejected generate — the tick doesn't throw and no recommendation is applied", async () => {
    mockRun.mockRejectedValueOnce(new Error("boom"));
    const insights = [makeInsight(1)];
    const { applyRecommendation } = renderRunner({ insights });
    await expect(act(async () => { await flushMicrotasks(); })).resolves.not.toThrow();
    expect(applyRecommendation).not.toHaveBeenCalled();
  });

  // ★★★ REGRESSION (§120): the runner had NO AbortController anywhere, so
  //    navigating away mid-tick did not stop the remaining billed calls.
  // ★ Vacuity trap: the mount tick fires immediately, so the first call MUST
  //   still be in flight (a never-settling promise) when unmount() runs — an
  //   already-finished tick would let this pass with the cleanup deleted.
  test("captures an AbortSignal on the in-flight call and aborts it when the runner unmounts", async () => {
    let captured: AbortSignal | undefined;
    mockRun.mockImplementation((args) => {
      captured = args.signal;
      return new Promise<InsightRecommendation>(() => {});
    });
    const { unmount } = renderRunner({ insights: [makeInsight(1)] });
    await act(async () => { await flushMicrotasks(); });
    expect(captured).toBeDefined();
    // Guard against a vacuous pass: an already-aborted signal would satisfy
    // the post-unmount assertion below without the cleanup ever running.
    expect(captured!.aborted).toBe(false);
    unmount();
    expect(captured!.aborted).toBe(true);
  });

  // ★★★ The signal flipping to aborted is not, by itself, proof that billing
  //    stops: without a `break` on abort the serial loop still walks the
  //    remaining candidates once the in-flight call settles. The observable
  //    here is the call COUNT on the mocked runner, not the signal — a real
  //    fetch rejects as soon as its signal aborts, so the mock reproduces
  //    that by rejecting the first call the instant its signal aborts, which
  //    lets the loop's `await` return and (absent the fix) proceed to the
  //    second candidate.
  test("does not issue the next candidate's call after the tick aborts mid-loop", async () => {
    const insights = [makeInsight(1), makeInsight(2), makeInsight(3)];
    mockRun.mockImplementationOnce((args) => {
      return new Promise<InsightRecommendation>((_resolve, reject) => {
        args.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    });
    mockRun.mockResolvedValue(fakeRec); // would answer candidate 2 if wrongly called
    const { unmount } = renderRunner({ insights });
    await act(async () => { await flushMicrotasks(); });
    // Positive control: the first candidate's call WAS issued.
    expect(mockRun).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => { await flushMicrotasks(); });
    // Absence assertion: the second candidate's call was never issued.
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  // ★★★ The POST-AWAIT abort check (the `break` sitting BETWEEN the awaited
  //    runInsightRecommendation and applyRecommendationRef.current) is a
  //    THIRD guard, distinct from the top-of-loop one and from the catch's.
  //    It covers the call that RESOLVES after the unmount: without it the
  //    loop writes a recommendation into an unmounted tree's writer.
  // ★★ ONE candidate, and a RESOLVING deferred, both on purpose. A second
  //    candidate would let the top-of-loop check break instead, and a
  //    REJECTING promise would route through the catch's own abort break —
  //    either way this test would pass with the post-await line deleted.
  //    MEASURED, not reasoned: deleting that one `break` turns this test RED
  //    while both §120 tests above stay GREEN.
  test("does not apply a recommendation that resolves after the runner unmounts", async () => {
    let resolveRun: ((rec: InsightRecommendation) => void) | undefined;
    mockRun.mockImplementation(
      () => new Promise<InsightRecommendation>((resolve) => { resolveRun = resolve; }),
    );
    const { unmount, applyRecommendation } = renderRunner({ insights: [makeInsight(1)] });
    await act(async () => { await flushMicrotasks(); });
    // Positive controls: the call is genuinely IN FLIGHT (issued, unsettled)
    // when the unmount lands — an already-settled tick would make the final
    // absence assertion vacuous.
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(resolveRun).toBeDefined();
    expect(applyRecommendation).not.toHaveBeenCalled();

    unmount();
    await act(async () => {
      resolveRun!(fakeRec);
      await flushMicrotasks();
    });
    expect(applyRecommendation).not.toHaveBeenCalled();
  });
});

// The cadence is user-settable (SP4). These assertions are only meaningful with
// a GENUINELY LIVE runner: with enabled:false or an empty insight list `tick`
// returns early, so "no extra tick fired" would pass vacuously even if the
// effect split were wrong. Hence enabled:true + a real candidate.
describe("useInsightRecommendRunner cadence", () => {
  function renderCadence<P>(
    render: (p: P) => Partial<InsightRecommendRunnerArgs>,
    initialProps: P,
  ) {
    const applyRecommendation = vi.fn();
    const view = renderHook(
      (p: P) =>
        useInsightRecommendRunner({
          enabled: true,
          guidesReady: true,
          insights: [makeInsight(1)],
          ai: { apiKey: "sk-ant-test", model: "claude-test" },
          today: "2026-01-01",
          intervalMinutes: 60,
          buildIndex: () => emptyIndex,
          buildContextFor: (i) => `context for ${i.id}`,
          applyRecommendation,
          ...render(p),
        }),
      { initialProps },
    );
    return { ...view, applyRecommendation };
  }

  test("arms the interval from intervalMinutes", () => {
    mockRun.mockResolvedValue(fakeRec);
    const spy = vi.spyOn(globalThis, "setInterval");
    renderCadence(() => ({ intervalMinutes: 60 }), {});
    expect(spy).toHaveBeenCalledWith(expect.any(Function), 60 * 60 * 1000);
  });

  test("clamps an out-of-range interval rather than trusting the caller", () => {
    mockRun.mockResolvedValue(fakeRec);
    const spy = vi.spyOn(globalThis, "setInterval");
    renderCadence(() => ({ intervalMinutes: 0 }), {});
    expect(spy).toHaveBeenCalledWith(expect.any(Function), 60 * 60 * 1000);
  });

  test("re-arms the interval when the setting changes WITHOUT firing an extra billed tick", async () => {
    mockRun.mockResolvedValue(fakeRec);
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const { rerender, applyRecommendation } = renderCadence(
      (p: { m: number }) => ({ intervalMinutes: p.m }),
      { m: 60 },
    );
    // Let the mount tick's async chain settle so its call is genuinely counted —
    // otherwise "still 1" below would hold simply because nothing had run yet.
    await act(async () => { await flushMicrotasks(); });
    expect(applyRecommendation).toHaveBeenCalledTimes(1);

    setSpy.mockClear();
    clearSpy.mockClear();
    rerender({ m: 30 });

    expect(clearSpy).toHaveBeenCalled();
    expect(setSpy).toHaveBeenCalledWith(expect.any(Function), 30 * 60 * 1000);
    // The mount tick must NOT re-fire. Still exactly one call, not two.
    await act(async () => { await flushMicrotasks(); });
    expect(applyRecommendation).toHaveBeenCalledTimes(1);
  });

  test("fires the mount tick exactly once across unrelated re-renders", async () => {
    mockRun.mockResolvedValue(fakeRec);
    const { rerender, applyRecommendation } = renderCadence(
      (p: { t: string }) => ({ today: p.t }),
      { t: "2026-01-01" },
    );
    await act(async () => { await flushMicrotasks(); });
    expect(applyRecommendation).toHaveBeenCalledTimes(1);
    rerender({ t: "2026-01-02" });
    await act(async () => { await flushMicrotasks(); });
    expect(applyRecommendation).toHaveBeenCalledTimes(1);
  });
});

// §548 (F7) — a tick's billed calls are serial, so a swap part-way through must drop the candidate it
// invalidated AND stop the tick: every remaining candidate was read from the project that just left.
describe("useInsightRecommendRunner — the scope epoch (§548)", () => {
  test("drops the result and stops the tick when the scope changed while the model was answering", async () => {
    const epoch = { v: 4 };
    const insights = [makeInsight(1), makeInsight(2)];
    mockRun.mockImplementation(async () => { epoch.v += 1; return fakeRec; });
    const { applyRecommendation } = renderRunner({ insights, getScopeEpoch: () => epoch.v });
    await act(async () => { await flushMicrotasks(); });

    expect(mockRun).toHaveBeenCalledTimes(1); // control: the tick ran, and STOPPED after the first
    expect(applyRecommendation).not.toHaveBeenCalled();
  });

  // Final review F2: the catch path (a non-global error) continues to the next candidate. If a swap
  // landed meanwhile, that candidate is the PREVIOUS project's insight and would be sent under the new
  // project's privacy — the tick must stop before sending it.
  test("a swap during a candidate that fails stops the tick before the next candidate is sent", async () => {
    const epoch = { v: 4 };
    const insights = [makeInsight(1), makeInsight(2)];
    mockRun.mockImplementationOnce(async () => { epoch.v += 1; throw new Error("one-off parse failure"); });
    mockRun.mockResolvedValue(fakeRec);
    const { applyRecommendation } = renderRunner({ insights, getScopeEpoch: () => epoch.v });
    await act(async () => { await flushMicrotasks(); });

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(applyRecommendation).not.toHaveBeenCalled();
  });

  test("CONTROL — a one-off failure without a swap still moves on to the next candidate", async () => {
    const epoch = { v: 4 };
    const insights = [makeInsight(1), makeInsight(2)];
    mockRun.mockRejectedValueOnce(new Error("one-off parse failure"));
    mockRun.mockResolvedValue(fakeRec);
    const { applyRecommendation } = renderRunner({ insights, getScopeEpoch: () => epoch.v });
    await act(async () => { await flushMicrotasks(); });

    expect(mockRun).toHaveBeenCalledTimes(2);
    expect(applyRecommendation).toHaveBeenCalledTimes(1);
    expect(applyRecommendation.mock.calls[0][0]).toBe(2);
  });

  test("CONTROL — the same tick stores both results when the scope is unchanged", async () => {
    const epoch = { v: 4 };
    const insights = [makeInsight(1), makeInsight(2)];
    mockRun.mockResolvedValue(fakeRec);
    const { applyRecommendation } = renderRunner({ insights, getScopeEpoch: () => epoch.v });
    await act(async () => { await flushMicrotasks(); });

    expect(mockRun).toHaveBeenCalledTimes(2);
    expect(applyRecommendation).toHaveBeenCalledTimes(2);
  });
});

// §701 — the tick reads the guide text through `aiRef`, so a guide edited after mount
// reaches the next billed call. Nothing is a candidate at mount, so the only call is
// the interval tick after the rerender; a runner reading its mount-time `args.ai`
// would send "GUIDE-A".
describe("useInsightRecommendRunner — operating guides (§701)", () => {
  test("a tick sends the latest guide text, not the one it mounted with", async () => {
    mockRun.mockResolvedValue(fakeRec);
    const base: Omit<InsightRecommendRunnerArgs, "insights" | "ai"> = {
      enabled: true,
      guidesReady: true,
      today: "2026-01-01",
      intervalMinutes: 60,
      buildIndex: () => emptyIndex,
      buildContextFor: (i) => `context for ${i.id}`,
      applyRecommendation: vi.fn(),
    };
    const { rerender } = renderHook(
      (p: { insights: Insight[]; guideText: string }) =>
        useInsightRecommendRunner({ ...base, insights: p.insights, ai: { apiKey: "sk-ant-test", model: "claude-test", guideText: p.guideText } }),
      { initialProps: { insights: [] as Insight[], guideText: "GUIDE-A" } },
    );
    await act(async () => { await flushMicrotasks(); });
    expect(mockRun).not.toHaveBeenCalled(); // control: no candidate at mount
    rerender({ insights: [makeInsight(1)], guideText: "GUIDE-B" });
    await act(async () => { vi.advanceTimersByTime(60 * 60 * 1000); await flushMicrotasks(); });
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRun.mock.calls[0][0].guideText).toBe("GUIDE-B");
    // One candidate is one request: caching it would pay the write for nothing.
    expect(mockRun.mock.calls[0][0].cacheGuides).toBe(false);
  });

  test("asks to cache the guide prefix when one tick has several candidates", async () => {
    mockRun.mockResolvedValue(fakeRec);
    renderRunner({ insights: [makeInsight(1), makeInsight(2)] });
    await act(async () => { await flushMicrotasks(); });
    expect(mockRun.mock.calls.map((c) => c[0].cacheGuides)).toEqual([true, true]);
  });

  // Held while the guides load, then run at once — not an hour later.
  test("holds the tick while the guides load, then runs straight away when they arrive", async () => {
    mockRun.mockResolvedValue(fakeRec);
    const { rerender } = renderHook(
      (p: { guidesReady: boolean }) => useInsightRecommendRunner({
        enabled: true, insights: [makeInsight(1)], ai: { apiKey: "sk-ant-test", model: "claude-test" },
        today: "2026-01-01", intervalMinutes: 60, buildIndex: () => emptyIndex,
        buildContextFor: (i) => `context for ${i.id}`, applyRecommendation: vi.fn(), guidesReady: p.guidesReady,
      }),
      { initialProps: { guidesReady: false } },
    );
    await act(async () => { await flushMicrotasks(); });
    expect(mockRun).not.toHaveBeenCalled();
    rerender({ guidesReady: true });
    await act(async () => { await flushMicrotasks(); }); // no timer advance
    expect(mockRun).toHaveBeenCalledTimes(1);
  });
});

describe("useInsightRecommendRunner — guides-ready edge (§701)", () => {
  test("the run on the guides-ready edge carries the guide text that arrived with it", async () => {
    mockRun.mockResolvedValue(fakeRec);
    const { rerender } = renderHook(
      (p: { guidesReady: boolean; guideText: string }) => useInsightRecommendRunner({
        enabled: true, guidesReady: p.guidesReady, insights: [makeInsight(1)],
        ai: { apiKey: "sk-ant-test", model: "claude-test", guideText: p.guideText },
        today: "2026-01-01", intervalMinutes: 60, buildIndex: () => emptyIndex,
        buildContextFor: (i) => `context for ${i.id}`, applyRecommendation: vi.fn(),
      }),
      { initialProps: { guidesReady: false, guideText: "" } },
    );
    await act(async () => { await flushMicrotasks(); });
    rerender({ guidesReady: true, guideText: "GUIDE-LOADED" });
    await act(async () => { await flushMicrotasks(); });
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRun.mock.calls[0][0].guideText).toBe("GUIDE-LOADED");
  });
});
