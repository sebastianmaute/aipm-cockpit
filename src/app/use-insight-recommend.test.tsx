import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInsightRecommend, type UseInsightRecommendArgs } from "./use-insight-recommend";
import { AiHttpError } from "./ai-errors";
import type { Insight, InsightRecommendation } from "./insights/insight";
import type { GroundingIndex } from "./action-ai";

const runInsightRecommendation = vi.hoisted(() => vi.fn());
vi.mock("./insights/recommend-call", () => ({ runInsightRecommendation }));

const insight = { id: 1, status: "active" } as unknown as Insight;
const recommendation = { summary: "do the thing" } as unknown as InsightRecommendation;

function makeArgs(over: Partial<UseInsightRecommendArgs> = {}): UseInsightRecommendArgs {
  return {
    insights: [insight],
    ai: { apiKey: "k", model: "m" },
    today: "2026-08-08",
    buildIndex: () => ({}) as GroundingIndex,
    buildContextFor: () => "ctx",
    applyRecommendation: vi.fn(),
    onError: vi.fn(),
    ...over,
  };
}

describe("useInsightRecommend", () => {
  beforeEach(() => { runInsightRecommendation.mockReset(); });

  it("applies the recommendation and threads an AbortSignal to the call", async () => {
    runInsightRecommendation.mockResolvedValue(recommendation);
    const args = makeArgs();
    const { result } = renderHook(() => useInsightRecommend(args));
    await act(async () => { await result.current.generate(1); });
    expect(args.applyRecommendation).toHaveBeenCalledWith(1, recommendation);
    expect(runInsightRecommendation.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
    expect(args.onError).not.toHaveBeenCalled();
    expect(result.current.generatingId).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it("is busy for the duration of a generate and names the generating insight", async () => {
    let release!: (v: InsightRecommendation) => void;
    runInsightRecommendation.mockReturnValue(new Promise((r) => { release = r; }));
    const { result } = renderHook(() => useInsightRecommend(makeArgs()));
    let done!: Promise<void>;
    act(() => { done = result.current.generate(1); });
    expect(result.current.busy).toBe(true);
    expect(result.current.generatingId).toBe(1);
    await act(async () => { release(recommendation); await done; });
    expect(result.current.busy).toBe(false);
    expect(result.current.generatingId).toBeNull();
  });

  // The whole point of the AbortController: a user-initiated stop is not a
  // failure, so it must not reach the caller's toast.
  it("cancel() aborts the call and surfaces NO error", async () => {
    let signal!: AbortSignal;
    runInsightRecommendation.mockImplementation(
      (a: { signal: AbortSignal }) =>
        new Promise((_, rej) => {
          signal = a.signal;
          a.signal.addEventListener("abort", () =>
            rej(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    const args = makeArgs();
    const { result } = renderHook(() => useInsightRecommend(args));
    let done!: Promise<void>;
    act(() => { done = result.current.generate(1); });
    await act(async () => { result.current.cancel(); await done; });
    expect(signal.aborted).toBe(true);
    expect(args.onError).not.toHaveBeenCalled();
    expect(args.applyRecommendation).not.toHaveBeenCalled();
    expect(result.current.generatingId).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it("still surfaces a classified toast for a real failure", async () => {
    runInsightRecommendation.mockRejectedValue(new AiHttpError(429, "rate_limit_error"));
    const args = makeArgs();
    const { result } = renderHook(() => useInsightRecommend(args));
    await act(async () => { await result.current.generate(1); });
    expect(args.onError).toHaveBeenCalledWith("limit");
    expect(args.applyRecommendation).not.toHaveBeenCalled();
    expect(result.current.generatingId).toBeNull();
  });

  it("classifies a non-HTTP failure as generic", async () => {
    runInsightRecommendation.mockRejectedValue(new Error("parse"));
    const args = makeArgs();
    const { result } = renderHook(() => useInsightRecommend(args));
    await act(async () => { await result.current.generate(1); });
    expect(args.onError).toHaveBeenCalledWith("generic");
  });

  it("does nothing in a popout or for an unknown insight", async () => {
    const popout = makeArgs({ isPopout: true });
    const { result: a } = renderHook(() => useInsightRecommend(popout));
    await act(async () => { await a.current.generate(1); });

    const normal = makeArgs();
    const { result: b } = renderHook(() => useInsightRecommend(normal));
    await act(async () => { await b.current.generate(999); });

    expect(runInsightRecommendation).not.toHaveBeenCalled();
  });

  // A superseded generate settles AFTER its successor set the spinner, so an
  // unconditional clear in the `finally` would blank the row still working.
  it("a superseded generate does not clear the newer row's spinner", async () => {
    const second = { id: 2, status: "active" } as unknown as Insight;
    runInsightRecommendation.mockImplementation(
      (a: { signal: AbortSignal }) =>
        new Promise((_, rej) => {
          a.signal.addEventListener("abort", () =>
            rej(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    const args = makeArgs({ insights: [insight, second] });
    const { result } = renderHook(() => useInsightRecommend(args));
    let first!: Promise<void>;
    act(() => { first = result.current.generate(1); });
    act(() => { void result.current.generate(2); });
    await act(async () => { await first; });
    expect(result.current.generatingId).toBe(2);
    expect(args.onError).not.toHaveBeenCalled();
  });
});
