import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import * as recommendCall from "./insights/recommend-call";
import { useInsightRecommendations, type InsightRecommendationDeps } from "./use-insight-recommendations";
import { entityToken } from "./ai-entity-token";
import { t } from "./i18n";
import type { Insight, InsightRecommendation } from "./insights/insight";

afterEach(() => vi.restoreAllMocks());

const task = { id: 42, taskName: "Fix login bug", status: "To Do", dueDate: "2026-08-12" };

function mkInsight(over: Partial<Insight> = {}): Insight {
  return {
    id: 1, key: "k", type: "stalledWork", severity: "high", data: {},
    status: "active", firstSeenAt: "2026-09-01", lastSeenAt: "2026-09-03", occurrences: 1,
    ...over,
  } as Insight;
}

function mkRec(input: Record<string, unknown>): InsightRecommendation {
  return {
    summary: "chase the stalled task",
    proposedCalls: [{ name: "update_task", input }],
    generatedAt: "2026-09-03",
    status: "proposed",
  };
}

/** A dispatcher over one mutable task row — enough for `runTool`'s update_task
 *  case, which resolves the row, checks the token, then patches. */
function mkDispatcher() {
  let stored: Record<string, unknown> = { ...task };
  return {
    read: () => stored,
    moveIt: () => { stored = { ...stored, taskName: "Renamed by a human" }; },
    dispatcher: {
      getTask: (id: number) => (stored.id === id ? stored : null),
      updateTask: (id: number, patch: Record<string, unknown>) => {
        if (stored.id !== id) return null;
        stored = { ...stored, ...patch };
        return stored;
      },
    } as unknown as InsightRecommendationDeps["dispatcher"],
  };
}

function mkDeps(over: Partial<InsightRecommendationDeps> = {}): InsightRecommendationDeps {
  return {
    isPopout: false,
    settings: { ai: { enabled: true, apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x" } } as unknown as InsightRecommendationDeps["settings"],
    lang: "en-US",
    today: "2026-09-03",
    project: undefined,
    tasks: [task] as unknown as InsightRecommendationDeps["tasks"],
    raid: [], milestones: [], changes: [], stakeholders: [],
    resourcesById: new Map(),
    insights: [],
    setInsights: vi.fn(),
    dispatcher: mkDispatcher().dispatcher,
    showToast: vi.fn(),
    logActivityAs: vi.fn(),
    onAcknowledgeInsight: vi.fn(),
    onActInsight: vi.fn(),
    onDismissInsight: vi.fn(),
    ...over,
  };
}

/** Drive `setInsights` for real so a test can read what was stored. */
function mkStore(initial: readonly Insight[]) {
  let list = initial;
  const setInsights = vi.fn((u: unknown) => {
    list = typeof u === "function"
      ? (u as (p: readonly Insight[] | undefined) => readonly Insight[])(list)
      : (u as readonly Insight[]);
  });
  return { setInsights: setInsights as unknown as InsightRecommendationDeps["setInsights"], read: () => list, calls: setInsights };
}

// ★★ EQUALITY, NEVER PRESENCE. A stored constant would satisfy a presence check
// and then be refused at replay — the breakage this threading exists to fix.
it("stores the target row's real token on a generated recommendation", async () => {
  vi.spyOn(recommendCall, "runInsightRecommendation").mockResolvedValue(
    mkRec({ id: 42, status: "In Progress" }),
  );
  const store = mkStore([mkInsight()]);
  const { result } = renderHook(() => useInsightRecommendations(mkDeps({ insights: store.read(), setInsights: store.setInsights })));
  await act(async () => { result.current.insightActions.onGenerateRecommendation(1); });
  const stored = store.read()[0].recommendation;
  expect(stored, "no recommendation was stored").toBeDefined();
  expect(stored!.proposedCalls[0].input.expectedToken).toBe(entityToken("task", task));
  // Positive control: the rest of the proposal survived the stamp.
  expect(stored!.proposedCalls[0].input.status).toBe("In Progress");
});

// ★★★ THE DROP THIS TASK EXISTS TO CLOSE. Before the split, a staleness refusal
// was counted as a plain failure and the insight was advanced to acted/applied
// anyway — so a recommendation that was correctly refused became a silent,
// permanently unretryable loss, which is strictly worse than the overwrite the
// token prevents.
describe("a stale recommendation is refused visibly, not swallowed", () => {
  async function confirmWith(recInput: Record<string, unknown>, store: ReturnType<typeof mkStore>) {
    const d = mkDispatcher();
    const deps = mkDeps({
      insights: store.read(), setInsights: store.setInsights, dispatcher: d.dispatcher,
    });
    const { result } = renderHook(() => useInsightRecommendations(deps));
    act(() => { result.current.setReviewInsightId(1); });
    await act(async () => { await result.current.confirmInsightRecommendation(); });
    return { deps, d, recInput };
  }

  it("commits and advances when the token still matches", async () => {
    const store = mkStore([mkInsight({ recommendation: mkRec({ id: 42, status: "In Progress", expectedToken: entityToken("task", task) }) })]);
    const { deps, d } = await confirmWith({}, store);
    expect(d.read().status).toBe("In Progress");
    expect(store.read()[0].status).toBe("acted");
    expect(store.read()[0].recommendation?.status).toBe("applied");
    expect(deps.showToast).toHaveBeenCalledWith("info", t("en-US", "insightRecommendationApplied"));
  });

  it("refuses a moved row: nothing written, the insight is NOT advanced, and the toast says why", async () => {
    const store = mkStore([mkInsight({ recommendation: mkRec({ id: 42, status: "In Progress", expectedToken: "0000000000000000" }) })]);
    const { deps, d } = await confirmWith({}, store);
    // No write reached the dispatcher.
    expect(d.read().status).toBe("To Do");
    // The insight is untouched, so the recommendation can still be regenerated
    // — this is the assertion that fails if the swallow is reintroduced.
    expect(store.calls).not.toHaveBeenCalled();
    expect(store.read()[0].status).toBe("active");
    expect(store.read()[0].recommendation?.status).toBe("proposed");
    // Distinguishable from a generic failure, and it names the remedy.
    expect(deps.showToast).toHaveBeenCalledWith("error", t("en-US", "insightRecommendationStale"));
    expect(deps.showToast).not.toHaveBeenCalledWith("error", t("en-US", "insightRecommendationApplyFailed"));
    // No activity row either — nothing happened to log.
    expect(deps.logActivityAs).not.toHaveBeenCalled();
  });

  // ★ The partial case keeps the OLD advance rule, deliberately: a create_* may
  // have committed, and re-running it would duplicate the entity. What changes
  // is only that the user is told WHY the rest did not land.
  it("still advances when something committed, but reports the staleness", async () => {
    const store = mkStore([mkInsight({
      recommendation: {
        summary: "two things",
        proposedCalls: [
          { name: "create_task", input: { taskName: "New", assignee: "A", dueDate: "2026-09-09" } },
          { name: "update_task", input: { id: 42, status: "Done", expectedToken: "0000000000000000" } },
        ],
        generatedAt: "2026-09-03",
        status: "proposed",
      },
    })]);
    const d = mkDispatcher();
    const deps = mkDeps({
      insights: store.read(),
      setInsights: store.setInsights,
      dispatcher: {
        ...(d.dispatcher as unknown as Record<string, unknown>),
        createTask: vi.fn(() => ({ id: 99 })),
      } as unknown as InsightRecommendationDeps["dispatcher"],
    });
    const { result } = renderHook(() => useInsightRecommendations(deps));
    act(() => { result.current.setReviewInsightId(1); });
    await act(async () => { await result.current.confirmInsightRecommendation(); });
    expect(store.read()[0].status).toBe("acted");
    expect(deps.showToast).toHaveBeenCalledWith("error", t("en-US", "insightRecommendationStalePartial"));
  });
});
