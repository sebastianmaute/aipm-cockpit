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
});
