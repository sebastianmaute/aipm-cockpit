import { describe, it, expect, vi, afterEach } from "vitest";
// AI people protection: the insight recommendations follow the chat's rule. Under protection an insight about ONE
// person (its data names a `person`, as the Timelog checks do) gets no recommendation, on request or in the
// background, and no request carries that person's profile fields. Unprotected, the same insight is handled.
// The privacy context is replaced by a switchable answer; what the privacy does to a send is pinned elsewhere.
const flags = vi.hoisted(() => ({ peopleProtected: false }));
vi.mock("./ai-privacy-context", async () => {
  const base = await import("../test/ai-privacy-unprotected");
  const now = () => flags.peopleProtected;
  return { ...base, useOpenProjectPeopleProtected: () => now, usePeopleProtected: () => flags.peopleProtected };
});
import { renderHook, act } from "@testing-library/react";
import * as recommendCall from "./insights/recommend-call";
import { newConsent } from "./ai-consent";
import { useInsightRecommendations, type InsightRecommendationDeps } from "./use-insight-recommendations";
import type { Insight, InsightRecommendation } from "./insights/insight";
import type { Resource } from "./types";

afterEach(() => {
  vi.restoreAllMocks();
  flags.peopleProtected = false;
});

const PERSON: Resource = {
  id: 7, firstName: "Dana", lastName: "Ortiz", title: "Data Engineer", department: "Analytics",
  company: "Acme", isExternal: true, active: true,
} as Resource;

/** A Timelog working-time insight: about one person, linked to their resource row. */
const PERSON_INSIGHT = {
  id: 5, key: "timelog:timelogCapPerDay:4711", type: "timelogCapPerDay", severity: "medium",
  entityRef: { view: "resources", id: 7 },
  data: { person: "Dana Ortiz", count: 2, threshold: 8, worstHours: 12, timelogUserId: 4711, firstDate: "2026-09-01", lastDate: "2026-09-02" },
  status: "active", firstSeenAt: "2026-09-01", lastSeenAt: "2026-09-03", occurrences: 1,
} as unknown as Insight;

/** A project-level insight: about no one. */
const PROJECT_INSIGHT = {
  id: 6, key: "k", type: "stalledWork", severity: "high", data: { count: 3 },
  status: "active", firstSeenAt: "2026-09-01", lastSeenAt: "2026-09-03", occurrences: 1,
} as unknown as Insight;

const REC: InsightRecommendation = { summary: "s", proposedCalls: [], generatedAt: "2026-09-03", status: "proposed" };

function mkDeps(insights: readonly Insight[], background: boolean): InsightRecommendationDeps {
  const consent = newConsent(new Date(0));
  return {
    isPopout: false, loadPending: false, getScopeEpoch: () => 0, guides: [], guidesReady: true,
    settings: {
      features: ["timelog"],
      ai: { enabled: true, consent, backgroundConsent: consent, apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x", insightRecommendations: background },
    } as unknown as InsightRecommendationDeps["settings"],
    lang: "en-US", today: "2026-09-03", project: undefined,
    tasks: [], raid: [], milestones: [], changes: [], stakeholders: [], baselineHistory: [],
    resourcesById: new Map([[7, PERSON]]), absences: [], holidaySet: new Set(),
    insights, setInsights: vi.fn(), dispatcher: {} as InsightRecommendationDeps["dispatcher"],
    showToast: vi.fn(), logActivityAs: vi.fn(),
    onAcknowledgeInsight: vi.fn(), onActInsight: vi.fn(), onDismissInsight: vi.fn(),
  };
}

/** The contexts of every request the on-request path built for `id`. */
async function onRequest(id: number): Promise<string[]> {
  const call = vi.spyOn(recommendCall, "runInsightRecommendation").mockResolvedValue(REC);
  const { result } = renderHook(() => useInsightRecommendations(mkDeps([PERSON_INSIGHT, PROJECT_INSIGHT], false)));
  await act(async () => { result.current.insightActions.onGenerateRecommendation(id); });
  return call.mock.calls.map((c) => c[0].context);
}

/** The contexts of every request the background runner's mount tick built. */
async function inBackground(): Promise<string[]> {
  const call = vi.spyOn(recommendCall, "runInsightRecommendation").mockResolvedValue(REC);
  renderHook(() => useInsightRecommendations(mkDeps([PERSON_INSIGHT, PROJECT_INSIGHT], true)));
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  return call.mock.calls.map((c) => c[0].context);
}

const PROFILE = ["jobTitle", "Data Engineer", "Analytics", "Acme", "4711"];

describe("on request", () => {
  it("protected: an insight about one person is not sent", async () => {
    flags.peopleProtected = true;
    expect(await onRequest(5)).toEqual([]);
  });

  it("protected: a project-level insight is still sent", async () => {
    flags.peopleProtected = true;
    expect(await onRequest(6)).toHaveLength(1);
  });

  it("unprotected: the insight about one person is sent, with its profile digest and Timelog user number", async () => {
    const contexts = await onRequest(5);
    expect(contexts).toHaveLength(1);
    for (const term of PROFILE) expect(contexts[0]).toContain(term);
  });
});

describe("in the background", () => {
  it("protected: only the project-level insight is sent, and no request carries the person's profile", async () => {
    flags.peopleProtected = true;
    const contexts = await inBackground();
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toContain("stalledWork");
    for (const ctx of contexts) for (const term of PROFILE) expect(ctx).not.toContain(term);
  });

  it("unprotected: both insights are sent, the person's with its profile", async () => {
    const contexts = await inBackground();
    expect(contexts).toHaveLength(2);
    const personCtx = contexts.find((c) => c.includes("timelogCapPerDay"));
    expect(personCtx).toBeDefined();
    for (const term of PROFILE) expect(personCtx).toContain(term);
  });
});
