import { describe, it, expect, vi, afterEach } from "vitest";
// The executor's people gate is read off the DISPATCHER here; the privacy context is not under test.
vi.mock("./ai-privacy-context", () => import("../test/ai-privacy-unprotected"));
// AI people protection, Task 5 review round 1 (I1): a stored recommendation whose call is a people tool,
// confirmed after protection was switched on, is REFUSED like a stale call — nothing written, the
// insight NOT marked applied — never counted as a hard failure that advances it.
import { renderHook, act } from "@testing-library/react";
import { newConsent } from "./ai-consent";
import { useInsightRecommendations, type InsightRecommendationDeps } from "./use-insight-recommendations";
import { entityToken } from "./ai-entity-token";
import { t } from "./i18n";
import type { Insight } from "./insights/insight";
import type { Stakeholder } from "./types";

afterEach(() => vi.restoreAllMocks());

const SAM: Stakeholder = { id: 1, name: "Sam", category: "Sponsor", influence: "High", interest: "High", raci: {} };

function mkInsight(): Insight {
  return {
    id: 1, key: "k", type: "stalledWork", severity: "high", data: {},
    status: "active", firstSeenAt: "2026-09-01", lastSeenAt: "2026-09-03", occurrences: 1,
    recommendation: {
      summary: "give Sam the owner role",
      proposedCalls: [{ name: "update_stakeholder", input: { id: 1, role: "Owner", expectedToken: entityToken("stakeholder", SAM) } }],
      generatedAt: "2026-09-03",
      status: "proposed",
    },
  } as Insight;
}

function mkStore(initial: readonly Insight[]) {
  let list = initial;
  const setInsights = vi.fn((u: unknown) => {
    list = typeof u === "function" ? (u as (p: readonly Insight[] | undefined) => readonly Insight[])(list) : (u as readonly Insight[]);
  });
  return { setInsights: setInsights as unknown as InsightRecommendationDeps["setInsights"], read: () => list, calls: setInsights };
}

async function confirm(peopleProtected: boolean) {
  const store = mkStore([mkInsight()]);
  const updateStakeholder = vi.fn((id: number, patch: Record<string, unknown>) => ({ ...SAM, id, ...patch }));
  const dispatcher = {
    isPeopleProtected: () => peopleProtected,
    getStakeholderRow: (id: number) => (id === 1 ? SAM : null),
    updateStakeholder,
  } as unknown as InsightRecommendationDeps["dispatcher"];
  const deps: InsightRecommendationDeps = {
    isPopout: false, loadPending: false, getScopeEpoch: () => 0, guides: [], guidesReady: true,
    settings: { ai: { enabled: true, consent: newConsent(new Date(0)), apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x" } } as unknown as InsightRecommendationDeps["settings"],
    lang: "en-US", today: "2026-09-03", project: undefined,
    tasks: [], raid: [], milestones: [], changes: [], stakeholders: [SAM],
    baselineHistory: [], resourcesById: new Map(),
    insights: store.read(), setInsights: store.setInsights, dispatcher,
    showToast: vi.fn(), logActivityAs: vi.fn(),
    onAcknowledgeInsight: vi.fn(), onActInsight: vi.fn(), onDismissInsight: vi.fn(),
  };
  const { result } = renderHook(() => useInsightRecommendations(deps));
  act(() => { result.current.setReviewInsightId(1); });
  await act(async () => { await result.current.confirmInsightRecommendation(); });
  return { store, deps, updateStakeholder };
}

describe("a people call refused by protection at confirm", () => {
  it("writes nothing, leaves the insight NOT applied, and is not reported as a failure", async () => {
    const { store, deps, updateStakeholder } = await confirm(true);
    expect(updateStakeholder).not.toHaveBeenCalled();
    expect(store.calls).not.toHaveBeenCalled();
    expect(store.read()[0]!.status).toBe("active");
    expect(store.read()[0]!.recommendation?.status).toBe("proposed");
    const toasts = (deps.showToast as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[1]));
    expect(toasts.some((m) => m.startsWith(t("en-US", "insightRecommendationApplyFailed")))).toBe(false);
    expect(deps.logActivityAs).not.toHaveBeenCalled();
  });

  // The control: allowed, the same stored call lands and the insight advances.
  it("allowed, the same call lands and the insight is applied", async () => {
    const { store, updateStakeholder } = await confirm(false);
    expect(updateStakeholder).toHaveBeenCalled();
    expect(store.read()[0]!.recommendation?.status).toBe("applied");
  });
});
