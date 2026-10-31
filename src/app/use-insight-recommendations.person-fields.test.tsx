import { describe, it, expect, vi, afterEach } from "vitest";
// AI people protection, Task 6 (R4): "an insight recommendation that would create a task creates it
// unassigned". The open project's setting is read through `useOpenProjectPeopleProtected` (mocked here with
// one stable getter, as the real one is); the executor's own gate reads the dispatcher's.
const people = vi.hoisted(() => {
  const state = { on: false };
  return { state, get: () => state.on };
});
vi.mock("./ai-privacy-context", async () => ({
  ...(await import("../test/ai-privacy-unprotected")),
  useOpenProjectPeopleProtected: () => people.get,
  // The render-reactive answer from the same source (the review plan reads it, review 3 R6).
  usePeopleProtected: () => people.state.on,
}));
import { renderHook, act } from "@testing-library/react";
import { newConsent } from "./ai-consent";
import { useInsightRecommendations, type InsightRecommendationDeps } from "./use-insight-recommendations";
import type { Insight } from "./insights/insight";
import type { Task } from "./types";

afterEach(() => {
  people.state.on = false;
  vi.restoreAllMocks();
});

function mkInsight(input: Record<string, unknown>): Insight {
  return {
    id: 1, key: "k", type: "stalledWork", severity: "high", data: {},
    status: "active", firstSeenAt: "2026-09-01", lastSeenAt: "2026-09-03", occurrences: 1,
    recommendation: {
      summary: "add a follow-up task",
      proposedCalls: [{ name: "create_task", input }],
      generatedAt: "2026-09-03",
      status: "proposed",
    },
  } as Insight;
}

function setup(peopleProtected: boolean, input: Record<string, unknown>) {
  people.state.on = peopleProtected;
  let list: readonly Insight[] = [mkInsight(input)];
  const setInsights = vi.fn((u: unknown) => {
    list = typeof u === "function" ? (u as (p: readonly Insight[] | undefined) => readonly Insight[])(list) : (u as readonly Insight[]);
  });
  const createTask = vi.fn((i: Record<string, unknown>) => ({ id: 9, ...i }) as unknown as Task);
  const dispatcher = { isPeopleProtected: () => peopleProtected, createTask } as unknown as InsightRecommendationDeps["dispatcher"];
  const deps: InsightRecommendationDeps = {
    isPopout: false, loadPending: false, getScopeEpoch: () => 0, guides: [], guidesReady: true,
    settings: { ai: { enabled: true, consent: newConsent(new Date(0)), apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x" } } as unknown as InsightRecommendationDeps["settings"],
    lang: "en-US", today: "2026-09-03", project: undefined,
    tasks: [], raid: [], milestones: [], changes: [], stakeholders: [],
    baselineHistory: [], resourcesById: new Map(),
    insights: list, setInsights: setInsights as unknown as InsightRecommendationDeps["setInsights"], dispatcher,
    showToast: vi.fn(), logActivityAs: vi.fn(),
    onAcknowledgeInsight: vi.fn(), onActInsight: vi.fn(), onDismissInsight: vi.fn(),
  };
  const { result } = renderHook(() => useInsightRecommendations(deps));
  act(() => { result.current.setReviewInsightId(1); });
  return { result, createTask, read: () => list };
}

const WITH_ASSIGNEE = { taskName: "Chase vendor", assignee: "Marco", dueDate: "2026-09-10" };

describe("an insight recommendation that creates a task, under people protection", () => {
  it("is reviewed and created unassigned", async () => {
    const { result, createTask, read } = setup(true, WITH_ASSIGNEE);
    const plan = result.current.reviewPlan!;
    expect(plan.rejected).toEqual([]);
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0]!.input).not.toHaveProperty("assignee");
    expect(plan.creates[0]!.fields.map((f) => f.field)).not.toContain("assignee");
    await act(async () => { await result.current.confirmInsightRecommendation(); });
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask.mock.calls[0]![0]).toMatchObject({ taskName: "Chase vendor", assignee: "" });
    expect(read()[0]!.recommendation?.status).toBe("applied");
  });

  it("a create the model sent without an assignee is not refused for it", async () => {
    const { result, createTask } = setup(true, { taskName: "Chase vendor", dueDate: "2026-09-10" });
    expect(result.current.reviewPlan!.rejected).toEqual([]);
    await act(async () => { await result.current.confirmInsightRecommendation(); });
    expect(createTask).toHaveBeenCalledTimes(1);
  });

  // The positive control: allowed, the assignee is reviewed and applied as proposed.
  it("protection off: the assignee is reviewed and applied", async () => {
    const { result, createTask } = setup(false, WITH_ASSIGNEE);
    expect(result.current.reviewPlan!.creates[0]!.input).toHaveProperty("assignee", "Marco");
    await act(async () => { await result.current.confirmInsightRecommendation(); });
    expect(createTask.mock.calls[0]![0]).toMatchObject({ assignee: "Marco" });
  });
});
