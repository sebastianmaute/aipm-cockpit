import { describe, it, expect, vi } from "vitest";
// Review 3, R6: the review modal's plan is a memo. Its people-protection input was the STABLE getter, so the memo
// never recomputed when the project's protection flipped, and the preview kept showing (or hiding) person fields
// the confirm would treat the other way. The privacy context is replaced by a switch the test flips.
const protection = vi.hoisted(() => {
  const state = { on: false };
  return { state, getter: () => state.on };
});
vi.mock("./ai-privacy-context", async () => ({
  ...(await import("../test/ai-privacy-unprotected")),
  useOpenProjectPeopleProtected: () => protection.getter,
  usePeopleProtected: () => protection.state.on,
}));
import { renderHook, act } from "@testing-library/react";
import { newConsent } from "./ai-consent";
import { useInsightRecommendations, type InsightRecommendationDeps } from "./use-insight-recommendations";
import { entityToken } from "./ai-entity-token";
import type { Insight } from "./insights/insight";
import type { Task } from "./types";

const TASK: Task = {
  id: 3, taskName: "Draft", assignee: "Marco", assigneeEmail: "", dueDate: "2026-11-01", lastUpdateDate: "2026-10-30",
  priority: "Medium", status: "To Do", blockers: "", description: "", inquiriesSent: 0, group: "", labels: [],
};

const INSIGHT = {
  id: 1, key: "k", type: "stalledWork", severity: "high", data: {},
  status: "active", firstSeenAt: "2026-10-01", lastSeenAt: "2026-10-30", occurrences: 1,
  recommendation: {
    summary: "hand the draft to Quillon",
    proposedCalls: [{ name: "update_task", input: { id: 3, assignee: "Quillon Ashby", priority: "High", expectedToken: entityToken("task", TASK) } }],
    generatedAt: "2026-10-30",
    status: "proposed",
  },
} as Insight;

function deps(): InsightRecommendationDeps {
  return {
    isPopout: false, loadPending: false, getScopeEpoch: () => 0, guides: [], guidesReady: true,
    settings: { ai: { enabled: true, consent: newConsent(new Date(0)), apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x" } } as unknown as InsightRecommendationDeps["settings"],
    lang: "en-US", today: "2026-10-30", project: undefined,
    tasks: [TASK], raid: [], milestones: [], changes: [], stakeholders: [],
    baselineHistory: [], resourcesById: new Map(),
    insights: [INSIGHT], setInsights: vi.fn() as unknown as InsightRecommendationDeps["setInsights"],
    dispatcher: { isPeopleProtected: () => protection.state.on } as unknown as InsightRecommendationDeps["dispatcher"],
    showToast: vi.fn(), logActivityAs: vi.fn(),
    onAcknowledgeInsight: vi.fn(), onActInsight: vi.fn(), onDismissInsight: vi.fn(),
  };
}

describe("the review plan follows the project's people protection (review 3, R6)", () => {
  it("recomputes when protection turns on, and again when it turns off", () => {
    protection.state.on = false;
    const d = deps();
    const { result, rerender } = renderHook(() => useInsightRecommendations(d));
    act(() => { result.current.setReviewInsightId(1); });
    expect(JSON.stringify(result.current.reviewPlan)).toContain("Quillon Ashby");

    protection.state.on = true;
    rerender();
    const protectedPlan = JSON.stringify(result.current.reviewPlan);
    expect(protectedPlan).not.toContain("Quillon Ashby");
    expect(protectedPlan).toContain("High"); // the rest of the call is still previewed

    protection.state.on = false;
    rerender();
    expect(JSON.stringify(result.current.reviewPlan)).toContain("Quillon Ashby");
  });
});
