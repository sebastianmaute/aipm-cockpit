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

/** A Timelog working-time insight: about one person, linked to their resource row (as `detect.ts` builds it). */
const PERSON_INSIGHT = {
  id: 5, key: "timelog:timelogCapPerDay:4711", type: "timelogCapPerDay", severity: "medium",
  entityRef: { view: "resources", id: 7 },
  data: { person: "Dana Ortiz", count: 2, threshold: 8, worstHours: 12, firstDate: "2026-09-01", lastDate: "2026-09-02" },
  status: "active", firstSeenAt: "2026-09-01", lastSeenAt: "2026-09-03", occurrences: 1,
} as unknown as Insight;

/** The same check for a Timelog user linked to no resource: no entityRef, and the person is their Timelog user number. */
const UNLINKED_INSIGHT = {
  id: 8, key: "timelog:timelogCapPerDay:4711", type: "timelogCapPerDay", severity: "medium",
  data: { person: "#4711", count: 1, threshold: 8, worstHours: 10, firstDate: "2026-09-02", lastDate: "2026-09-02" },
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
  const { result } = renderHook(() => useInsightRecommendations(mkDeps([PERSON_INSIGHT, PROJECT_INSIGHT, UNLINKED_INSIGHT], false)));
  await act(async () => { result.current.insightActions.onGenerateRecommendation(id); });
  return call.mock.calls.map((c) => c[0].context);
}

/** The contexts of every request the background runner's mount tick built. */
async function inBackground(): Promise<string[]> {
  const call = vi.spyOn(recommendCall, "runInsightRecommendation").mockResolvedValue(REC);
  renderHook(() => useInsightRecommendations(mkDeps([PERSON_INSIGHT, PROJECT_INSIGHT, UNLINKED_INSIGHT], true)));
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
  return call.mock.calls.map((c) => c[0].context);
}

/** The linked person's profile digest, and the unlinked person's Timelog user number. */
const PROFILE = ["jobTitle", "Data Engineer", "Analytics", "Acme"];
const TIMELOG_USER = "#4711";

describe("on request", () => {
  it.each([5, 8])("protected: an insight about one person (#%s) is not sent", async (id) => {
    flags.peopleProtected = true;
    expect(await onRequest(id)).toEqual([]);
  });

  it("protected: a project-level insight is still sent", async () => {
    flags.peopleProtected = true;
    expect(await onRequest(6)).toHaveLength(1);
  });

  it("unprotected: the linked person's insight is sent with their profile digest", async () => {
    const contexts = await onRequest(5);
    expect(contexts).toHaveLength(1);
    for (const term of PROFILE) expect(contexts[0]).toContain(term);
  });

  it("unprotected: the unlinked person's insight is sent with their Timelog user number", async () => {
    const contexts = await onRequest(8);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toContain(TIMELOG_USER);
  });
});

describe("in the background", () => {
  it("protected: only the project-level insight is sent, and no request carries a person's profile or number", async () => {
    flags.peopleProtected = true;
    const contexts = await inBackground();
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toContain("stalledWork");
    for (const ctx of contexts) for (const term of [...PROFILE, TIMELOG_USER]) expect(ctx).not.toContain(term);
  });

  it("unprotected: all three are sent, each person's with their profile or number", async () => {
    const contexts = await inBackground();
    expect(contexts).toHaveLength(3);
    const linked = contexts.find((c) => c.includes("Dana Ortiz"));
    expect(linked).toBeDefined();
    for (const term of PROFILE) expect(linked).toContain(term);
    expect(contexts.some((c) => c.includes(TIMELOG_USER))).toBe(true);
  });

  // Protection switched on while the runner's FIRST call is in flight: the candidates were picked unprotected, so
  // only the per-candidate check before each send can hold back the person's insight that comes next.
  it("protection switched on during the first call holds back the person's insight after it", async () => {
    let answer: (rec: InsightRecommendation) => void = () => undefined;
    const call = vi.spyOn(recommendCall, "runInsightRecommendation")
      .mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }))
      .mockResolvedValue(REC);
    renderHook(() => useInsightRecommendations(mkDeps([PROJECT_INSIGHT, UNLINKED_INSIGHT], true)));
    for (let i = 0; i < 2; i++) await act(async () => { await Promise.resolve(); });
    expect(call).toHaveBeenCalledTimes(1); // the first call is in flight
    flags.peopleProtected = true;
    await act(async () => { answer(REC); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("control: left unprotected, the same run sends the person's insight next", async () => {
    let answer: (rec: InsightRecommendation) => void = () => undefined;
    const call = vi.spyOn(recommendCall, "runInsightRecommendation")
      .mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }))
      .mockResolvedValue(REC);
    renderHook(() => useInsightRecommendations(mkDeps([PROJECT_INSIGHT, UNLINKED_INSIGHT], true)));
    for (let i = 0; i < 2; i++) await act(async () => { await Promise.resolve(); });
    await act(async () => { answer(REC); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[1][0].context).toContain(TIMELOG_USER);
  });
});

// The CTA side: the controls read the same live answer, so a protected person insight says why it gets nothing.
describe("the insight actions carry the live protection", () => {
  it.each([true, false])("peopleProtected = %s", (on) => {
    flags.peopleProtected = on;
    const { result } = renderHook(() => useInsightRecommendations(mkDeps([PERSON_INSIGHT], false)));
    expect(result.current.insightActions.peopleProtected).toBe(on);
  });
});
