import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useInsightRecommendRunner, type InsightRecommendRunnerArgs } from "./use-insight-recommend-runner";
import { runInsightRecommendation } from "./insights/recommend-call";
import { MAX_BG_RECS_PER_TICK, type Insight, type InsightRecommendation } from "./insights/insight";
import type { GroundingIndex } from "./action-ai";

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
    expect(applyRecommendation).toHaveBeenCalledWith(1, fakeRec);
    expect(applyRecommendation).toHaveBeenCalledWith(2, fakeRec);
  });

  test("caps at MAX_BG_RECS_PER_TICK candidates per tick", async () => {
    mockRun.mockResolvedValue(fakeRec);
    const insights = [1, 2, 3, 4, 5].map((id) => makeInsight(id));
    renderRunner({ insights });
    await act(async () => { await flushMicrotasks(); });
    expect(mockRun).toHaveBeenCalledTimes(MAX_BG_RECS_PER_TICK);
  });

  test("skips insights that already have a recommendation", async () => {
    mockRun.mockResolvedValue(fakeRec);
    const insights = [makeInsight(1, { recommendation: fakeRec }), makeInsight(2)];
    const { applyRecommendation } = renderRunner({ insights });
    await act(async () => { await flushMicrotasks(); });
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(applyRecommendation).toHaveBeenCalledWith(2, fakeRec);
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
