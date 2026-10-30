import { describe, it, expect, vi, afterEach } from "vitest";
import { newConsent } from "./ai-consent";
import { renderHook, act, render, screen } from "@testing-library/react";
import * as recommendCall from "./insights/recommend-call";
import { AiHttpError } from "./ai-errors";
import { useInsightRecommendations, type InsightRecommendationDeps } from "./use-insight-recommendations";
import { entityToken } from "./ai-entity-token";
import { loadI18n, t } from "./i18n";
import { baselineHistoryDigest, type Insight, type InsightRecommendation } from "./insights/insight";
import { actionGuideText, type OperatingGuide } from "./operating-guide";
import { clearDiagLog, readDiagLog } from "./diagnostics";
import { InsightRecommendationControls } from "./insight-recommendation-controls";

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
    loadPending: false,
    getScopeEpoch: () => 0,
    guides: [],
    guidesReady: true,
    settings: { ai: { enabled: true, consent: newConsent(new Date(0)), backgroundConsent: newConsent(new Date(0)), apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x" } } as unknown as InsightRecommendationDeps["settings"],
    lang: "en-US",
    today: "2026-09-03",
    project: undefined,
    tasks: [task] as unknown as InsightRecommendationDeps["tasks"],
    raid: [], milestones: [], changes: [], stakeholders: [],
    baselineHistory: [],
    resourcesById: new Map(),
    absences: [],
    holidaySet: new Set(),
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

// §350 — the token covers the MODEL ROUND-TRIP too. Driven through the
// BACKGROUND RUNNER on purpose: that is the path that was actually broken — it
// reads the store callback from a ref at ANSWER time, so it stamped from the
// post-edit arrays and a recommendation that went stale mid-flight confirmed as
// current. (The on-demand generate captured its args at START, so it was
// covered by accident; the explicit snapshot makes both paths deliberate.)
it("stamps the token from the rows the PROMPT was built from, not the rows at answer time", async () => {
  let answer!: (r: InsightRecommendation) => void;
  vi.spyOn(recommendCall, "runInsightRecommendation").mockReturnValue(
    new Promise<InsightRecommendation>((r) => { answer = r; }),
  );
  const store = mkStore([mkInsight()]);
  const edited = { ...task, taskName: "Fix login bug (edited mid-flight)" };
  const runnerSettings = {
    ai: { enabled: true, consent: newConsent(new Date(0)), backgroundConsent: newConsent(new Date(0)), apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x", insightRecommendations: true },
  } as unknown as InsightRecommendationDeps["settings"];
  const { rerender } = renderHook(
    (p: { tasks: unknown[] }) =>
      useInsightRecommendations(mkDeps({ settings: runnerSettings, insights: store.read(), setInsights: store.setInsights, tasks: p.tasks as InsightRecommendationDeps["tasks"] })),
    { initialProps: { tasks: [task] as unknown[] } },
  );
  await act(async () => { await Promise.resolve(); });
  expect(recommendCall.runInsightRecommendation).toHaveBeenCalledTimes(1); // the runner's mount tick
  // The human edit lands while the model is still answering.
  rerender({ tasks: [edited] });
  await act(async () => { answer(mkRec({ id: 42, status: "In Progress" })); });
  const stored = store.read()[0].recommendation;
  expect(stored, "no recommendation was stored").toBeDefined();
  expect(entityToken("task", edited)).not.toBe(entityToken("task", task)); // anti-vacuity
  expect(stored!.proposedCalls[0].input.expectedToken).toBe(entityToken("task", task));
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
    // §351: a full apply records no refused calls — the key is absent.
    expect(store.read()[0].recommendation).not.toHaveProperty("refusedCalls");
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
    // §351: the partial outcome is RECORDED, not only toasted — the stored
    // recommendation stays `applied` (so its create is never re-offered) and
    // counts the one update that wrote nothing.
    expect(store.read()[0].recommendation?.status).toBe("applied");
    expect(store.read()[0].recommendation?.refusedCalls).toBe(1);
  });
});

// §534 — confirm used to replay the stored call whole, so a field the review
// modal showed as rejected was still sent. It now strips it, from the SAME
// per-call plan the modal's merged plan is made of.
describe("§534 — confirm sends only what the review modal showed", () => {
  it("lands the valid sibling and omits a rejected assigneeEmail", async () => {
    const store = mkStore([mkInsight({ recommendation: mkRec({ id: 42, status: "In Progress", assigneeEmail: "not-an-email", expectedToken: entityToken("task", task) }) })]);
    const d = mkDispatcher();
    const deps = mkDeps({ insights: store.read(), setInsights: store.setInsights, dispatcher: d.dispatcher });
    const { result } = renderHook(() => useInsightRecommendations(deps));
    act(() => { result.current.setReviewInsightId(1); });
    // Parity: the modal names the same field the confirm will strip.
    expect(result.current.reviewPlan?.rejected.map((r) => r.field)).toEqual(["assigneeEmail"]);
    await act(async () => { await result.current.confirmInsightRecommendation(); });
    expect(d.read().status).toBe("In Progress");
    expect(d.read()).not.toHaveProperty("assigneeEmail");
    expect(store.read()[0].recommendation?.status).toBe("applied");
    expect(deps.showToast).toHaveBeenCalledWith("info", t("en-US", "insightRecommendationApplied"));
  });

  // Final review Minor 4: this is the ALL-REFUSED case — nothing committed, no
  // hard failure, nothing stale — so the toast must say nothing was applied,
  // not the generic partial-failure wording ("Some changes … couldn't be
  // applied"), which overstated what happened when nothing landed at all.
  it("sends nothing for a call whose every field was rejected, and leaves the insight where it was", async () => {
    const store = mkStore([mkInsight({ recommendation: mkRec({ id: 42, assigneeEmail: "not-an-email", expectedToken: entityToken("task", task) }) })]);
    const d = mkDispatcher();
    const deps = mkDeps({ insights: store.read(), setInsights: store.setInsights, dispatcher: d.dispatcher });
    const { result } = renderHook(() => useInsightRecommendations(deps));
    act(() => { result.current.setReviewInsightId(1); });
    await act(async () => { await result.current.confirmInsightRecommendation(); });
    expect(d.read()).not.toHaveProperty("assigneeEmail");
    expect(store.calls).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith("error", t("en-US", "insightRecommendationAllRejected"));
    expect(deps.showToast).not.toHaveBeenCalledWith("error", t("en-US", "insightRecommendationApplyFailed"));
    expect(deps.logActivityAs).not.toHaveBeenCalled();
  });

  // ★ The MIXED case: one call lands, one is refused whole. Something committed,
  //  so the insight advances — but the toast must not say "Applied" when part of
  //  what the modal showed was never sent.
  it("advances the insight but reports an error when one call lands and another is refused whole", async () => {
    const token = entityToken("task", task);
    const rec: InsightRecommendation = {
      ...mkRec({ id: 42, status: "In Progress", expectedToken: token }),
      proposedCalls: [
        { name: "update_task", input: { id: 42, status: "In Progress", expectedToken: token } },
        { name: "update_task", input: { id: 42, assigneeEmail: "not-an-email", expectedToken: token } },
      ],
    };
    const store = mkStore([mkInsight({ recommendation: rec })]);
    const d = mkDispatcher();
    const deps = mkDeps({ insights: store.read(), setInsights: store.setInsights, dispatcher: d.dispatcher });
    const { result } = renderHook(() => useInsightRecommendations(deps));
    act(() => { result.current.setReviewInsightId(1); });
    await act(async () => { await result.current.confirmInsightRecommendation(); });
    expect(d.read().status).toBe("In Progress");
    expect(d.read()).not.toHaveProperty("assigneeEmail");
    expect(store.read()[0].status).toBe("acted");
    expect(store.read()[0].recommendation?.status).toBe("applied");
    expect(deps.showToast).toHaveBeenCalledWith("error", t("en-US", "insightRecommendationApplyFailed"));
    expect(deps.showToast).not.toHaveBeenCalledWith("info", t("en-US", "insightRecommendationApplied"));
    // §351: a call refused whole in review wrote nothing either — recorded.
    expect(store.read()[0].recommendation?.refusedCalls).toBe(1);
  });
});

// §548 — the recommendation store is the ONE choke point both the background runner and the on-demand
// generate write through. A result stored while a load or swap is pending would be replaced when the
// load lands. The settled control is "stores the target row's real token on a generated recommendation"
// above, which runs with `loadPending: false`.
it("does not store a generated recommendation while the project load is pending (§548)", async () => {
  const generate = vi.spyOn(recommendCall, "runInsightRecommendation").mockResolvedValue(mkRec({ id: 42, status: "In Progress" }));
  const store = mkStore([mkInsight()]);
  const { result } = renderHook(() => useInsightRecommendations(mkDeps({ insights: store.read(), setInsights: store.setInsights, loadPending: true })));
  await act(async () => { result.current.insightActions.onGenerateRecommendation(1); });
  expect(generate).toHaveBeenCalled(); // control: the generate really ran to the store point
  expect(store.read()[0].recommendation).toBeUndefined();
});

// §548 F1 item 9 — the BACKGROUND RUNNER itself must not tick while the load is pending, not just its
// store above: without the `&& !loadPending` term on `useInsightRecommendRunner`'s `enabled`, the mount
// effect fires a billed AI call whose result is simply discarded once the store gate above catches it.
// `runInsightRecommendation` is the one call both the on-demand path and the runner's tick make, and
// this test never invokes the on-demand path (`onGenerateRecommendation` above) — so any call recorded
// here can only be the runner's own mount tick. `recommendationRunnerDeps` below is the ONE shared
// fixture (one real candidate insight, AI + `insightRecommendations` both on) for both the negative
// case (`loadPending: true`, round 1) and its positive control (`loadPending: false`, round 1 addition)
// — without the control, a drift in `mkDeps`/`isAiEnabled` that made the runner never tick AT ALL would
// leave the negative test green for the wrong reason.
function recommendationRunnerDeps(loadPending: boolean, store: ReturnType<typeof mkStore>): InsightRecommendationDeps {
  return mkDeps({
    insights: store.read(),
    setInsights: store.setInsights,
    loadPending,
    settings: { ai: { enabled: true, consent: newConsent(new Date(0)), backgroundConsent: newConsent(new Date(0)), apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x", insightRecommendations: true } } as unknown as InsightRecommendationDeps["settings"],
  });
}

it("does not invoke the background runner's tick while the project load is pending (§548)", async () => {
  const generate = vi.spyOn(recommendCall, "runInsightRecommendation").mockResolvedValue(mkRec({ id: 42, status: "In Progress" }));
  const store = mkStore([mkInsight()]); // active, no recommendation yet — a real candidate for the runner
  renderHook(() => useInsightRecommendations(recommendationRunnerDeps(true, store)));
  await act(async () => {}); // flush the runner's mount-tick effect
  expect(generate).not.toHaveBeenCalled();
});

// Positive control (round 1, review m-2) — the SAME fixture, `loadPending: false`: the runner's mount
// tick DOES fire and reach `runInsightRecommendation`. Without this, the negative test above could stay
// green even if the runner never ticked for an unrelated reason (a fixture typo, `isAiEnabled` drifting,
// `insightRecommendations` not read) — it would prove nothing about `loadPending` specifically.
it("DOES invoke the background runner's tick once the project load is no longer pending (§548)", async () => {
  const generate = vi.spyOn(recommendCall, "runInsightRecommendation").mockResolvedValue(mkRec({ id: 42, status: "In Progress" }));
  const store = mkStore([mkInsight()]);
  renderHook(() => useInsightRecommendations(recommendationRunnerDeps(false, store)));
  await act(async () => {}); // flush the runner's mount-tick effect
  expect(generate).toHaveBeenCalled();
});

// AI-10 — the runner is unattended, so interactive consent alone must not start it. Same fixture and the
// same mount tick as the positive control above, with the background consent removed.
it("does not tick the background runner with interactive consent only (AI-10)", async () => {
  const generate = vi.spyOn(recommendCall, "runInsightRecommendation").mockResolvedValue(mkRec({ id: 42, status: "In Progress" }));
  const store = mkStore([mkInsight()]);
  const deps = recommendationRunnerDeps(false, store);
  const interactiveOnly = { ai: { ...deps.settings.ai, backgroundConsent: undefined } } as unknown as InsightRecommendationDeps["settings"];
  renderHook(() => useInsightRecommendations({ ...deps, settings: interactiveOnly }));
  await act(async () => {});
  expect(generate).not.toHaveBeenCalled();
});

// §701 — the runner is unattended: while grounding is on it waits for the guide
// library to load rather than spend a billed run without the guides. The
// on-demand path does not wait. Grounding off means nothing to wait for.
function runnerDepsWithGuides(groundInGuides: boolean, guidesReady: boolean, store: ReturnType<typeof mkStore>): InsightRecommendationDeps {
  return mkDeps({
    insights: store.read(),
    setInsights: store.setInsights,
    guidesReady,
    settings: { ai: { enabled: true, consent: newConsent(new Date(0)), backgroundConsent: newConsent(new Date(0)), apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x", insightRecommendations: true, groundInGuides } } as unknown as InsightRecommendationDeps["settings"],
  });
}

it("does not tick the background runner while grounding is on and the guides have not loaded (§701)", async () => {
  const generate = vi.spyOn(recommendCall, "runInsightRecommendation").mockResolvedValue(mkRec({ id: 42, status: "In Progress" }));
  renderHook(() => useInsightRecommendations(runnerDepsWithGuides(true, false, mkStore([mkInsight()]))));
  await act(async () => {});
  expect(generate).not.toHaveBeenCalled();
});

it("ticks the background runner once the guides have loaded, or when grounding is off (§701)", async () => {
  const generate = vi.spyOn(recommendCall, "runInsightRecommendation").mockResolvedValue(mkRec({ id: 42, status: "In Progress" }));
  const first = renderHook(() => useInsightRecommendations(runnerDepsWithGuides(true, true, mkStore([mkInsight()]))));
  await act(async () => {});
  expect(generate).toHaveBeenCalledTimes(1);
  first.unmount();
  renderHook(() => useInsightRecommendations(runnerDepsWithGuides(false, false, mkStore([mkInsight()]))));
  await act(async () => {});
  expect(generate).toHaveBeenCalledTimes(2);
});

describe("§650 a refused key shows the key message on the insight recommendation toast", () => {
  it.each([
    [401, "aiKeyRejected"],
    [403, "aiKeyForbidden"],
  ] as const)("a %i toasts %s", async (status, key) => {
    vi.spyOn(recommendCall, "runInsightRecommendation").mockRejectedValue(new AiHttpError(status));
    const deps = mkDeps({ insights: [mkInsight()] });
    const { result } = renderHook(() => useInsightRecommendations(deps));
    await act(async () => { result.current.insightActions.onGenerateRecommendation(1); });
    await act(async () => { await Promise.resolve(); });
    expect(deps.showToast).toHaveBeenCalledWith("error", t("en-US", key));
    expect(deps.showToast).not.toHaveBeenCalledWith("error", t("en-US", "insightRecommendationError"));
  });
});

// open-followups §275 — the apply-time allow-list. A persisted or imported
// insight blob can carry any call names; confirm must replay only those on
// ALLOWED_REC_TOOLS, so a smuggled destructive call never reaches runTool.
describe("§275 — confirm drops calls outside ALLOWED_REC_TOOLS", () => {
  it("never dispatches a smuggled delete or settings write, and still applies the allowed call", async () => {
    const store = mkStore([mkInsight({
      recommendation: {
        summary: "smuggled",
        proposedCalls: [
          { name: "delete_task", input: { id: 42 } },
          { name: "update_settings", input: { ai: { enabled: false } } },
          { name: "update_task", input: { id: 42, status: "In Progress", expectedToken: entityToken("task", task) } },
        ],
        generatedAt: "2026-09-03",
        status: "proposed",
      },
    })]);
    const d = mkDispatcher();
    const deleteTask = vi.fn(() => true);
    const updateSettings = vi.fn();
    const deps = mkDeps({
      insights: store.read(),
      setInsights: store.setInsights,
      dispatcher: {
        ...(d.dispatcher as unknown as Record<string, unknown>),
        deleteTask,
        updateSettings,
      } as unknown as InsightRecommendationDeps["dispatcher"],
    });
    const { result } = renderHook(() => useInsightRecommendations(deps));
    act(() => { result.current.setReviewInsightId(1); });
    await act(async () => { await result.current.confirmInsightRecommendation(); });
    expect(deleteTask).not.toHaveBeenCalled();
    expect(updateSettings).not.toHaveBeenCalled();
    // Positive control: the allowed sibling in the same blob did land.
    expect(d.read().status).toBe("In Progress");
    expect(store.read()[0].recommendation?.status).toBe("applied");
  });
});

// §360 — a TimeLog guardrail points at a person (`view: "resources"`). The digest
// says who they are in the organisation and NEVER carries their free-text notes.
describe("§360 — a resources entityRef gets a profile digest", () => {
  async function contextFor(resourcesById: InsightRecommendationDeps["resourcesById"], id: number) {
    const spy = vi.spyOn(recommendCall, "runInsightRecommendation").mockResolvedValue(mkRec({ id: 42 }));
    const store = mkStore([mkInsight({ entityRef: { view: "resources", id } } as Partial<Insight>)]);
    const { result } = renderHook(() =>
      useInsightRecommendations(mkDeps({ resourcesById, insights: store.read(), setInsights: store.setInsights })),
    );
    await act(async () => { result.current.insightActions.onGenerateRecommendation(1); });
    expect(spy).toHaveBeenCalledTimes(1);
    return spy.mock.calls[0][0].context;
  }

  it("names the role fields and leaves notes out", async () => {
    const person = {
      id: 7, firstName: "Ada", lastName: "Lovelace", title: "Data Engineer", department: "Analytics",
      company: "Acme", isExternal: true, active: true, notes: "PRIVATE-NOTE-MARKER",
    };
    const ctx = await contextFor(new Map([[7, person]]) as unknown as InsightRecommendationDeps["resourcesById"], 7);
    expect(ctx).toContain("Linked resources#7:");
    expect(ctx).toContain("jobTitle: Data Engineer");
    expect(ctx).toContain("department: Analytics");
    expect(ctx).toContain("company: Acme");
    expect(ctx).toContain("external: yes");
    expect(ctx).toContain("active: yes");
    expect(ctx).not.toContain("PRIVATE-NOTE-MARKER");
  });

  it("caps a long profile field like every other digest field", async () => {
    const person = { id: 7, firstName: "Ada", lastName: "L", title: "x".repeat(5000), active: true };
    const ctx = await contextFor(new Map([[7, person]]) as unknown as InsightRecommendationDeps["resourcesById"], 7);
    const line = ctx.split("\n").find((l: string) => l.startsWith("jobTitle: "))!;
    expect(line.length).toBeLessThanOrEqual("jobTitle: ".length + 200);
    expect(line.length).toBeGreaterThan("jobTitle: ".length); // anti-vacuity: the field is there
  });

  it("falls back to no linked entity when the person is gone", async () => {
    const ctx = await contextFor(new Map() as InsightRecommendationDeps["resourcesById"], 7);
    expect(ctx).toContain("(no linked entity)");
  });
});

// §701 — this hook runs in task-manager's own body, above the AiProviders it renders, so it
// resolves the insightRecommend guide text from its `guides` dep. Both paths must carry it.
describe("insight recommendations carry the operating guides (§701)", () => {
  const guide: OperatingGuide = {
    id: "g-rec", name: "Recommend guide", content: "REC-GUIDE-701", enabled: true,
    priority: 1, scope: { targets: ["insightRecommend"] }, builtIn: false,
  };
  const expected = actionGuideText([guide], true, "insightRecommend");
  const settings = (runner: boolean) => ({
    ai: { enabled: true, consent: newConsent(new Date(0)), backgroundConsent: newConsent(new Date(0)), apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x", groundInGuides: true, insightRecommendations: runner },
  }) as unknown as InsightRecommendationDeps["settings"];

  it("the on-demand generate sends the guide text", async () => {
    const generate = vi.spyOn(recommendCall, "runInsightRecommendation").mockResolvedValue(mkRec({ id: 42, status: "In Progress" }));
    const store = mkStore([mkInsight()]);
    const { result } = renderHook(() => useInsightRecommendations(mkDeps({ settings: settings(false), guides: [guide], insights: store.read(), setInsights: store.setInsights })));
    await act(async () => { result.current.insightActions.onGenerateRecommendation(1); });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].guideText).toBe(expected);
    expect(expected).toContain("REC-GUIDE-701");
  });

  it("the background runner's tick sends the guide text", async () => {
    const generate = vi.spyOn(recommendCall, "runInsightRecommendation").mockResolvedValue(mkRec({ id: 42, status: "In Progress" }));
    const store = mkStore([mkInsight()]);
    renderHook(() => useInsightRecommendations(mkDeps({ settings: settings(true), guides: [guide], insights: store.read(), setInsights: store.setInsights })));
    await act(async () => {}); // flush the runner's mount-tick effect
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].guideText).toBe(expected);
  });

  it("sends no guide text when grounding is off", async () => {
    const generate = vi.spyOn(recommendCall, "runInsightRecommendation").mockResolvedValue(mkRec({ id: 42, status: "In Progress" }));
    const store = mkStore([mkInsight()]);
    const off = { ai: { enabled: true, consent: newConsent(new Date(0)), backgroundConsent: newConsent(new Date(0)), apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x", groundInGuides: false } } as unknown as InsightRecommendationDeps["settings"];
    const { result } = renderHook(() => useInsightRecommendations(mkDeps({ settings: off, guides: [guide], insights: store.read(), setInsights: store.setInsights })));
    await act(async () => { result.current.insightActions.onGenerateRecommendation(1); });
    expect(generate.mock.calls[0][0].guideText).toBe("");
  });
});

// §476 final fix 2, item 1 (fix round 1) — a recommendation generated BEFORE a baseline-currency
// switch holds money in the OLD currency. Replayed after it, `costImpact: 5000` would be written as
// 5000 of the new currency, so the whole apply is refused while any call carries a money argument.
// "Before" is decided by the history LENGTH stamped at generation (`historyLength`), not by the
// day: a recommendation regenerated on the day of the switch, as the refusal toast asks, applies.
describe("a pre-switch recommendation carrying money is refused after a currency switch (§476)", () => {
  const SWITCH = { from: "2026-09-03", at: "2026-09-03T10:00:00.000Z", currency: "GBP" as const, perPrevious: 0.85 };
  const CREATION = { from: "2026-09-01", at: "2026-09-01T10:00:00.000Z", currency: "GBP" as const };
  function recWith(calls: InsightRecommendation["proposedCalls"], historyLength?: number): InsightRecommendation {
    return { summary: "s", proposedCalls: calls, generatedAt: "2026-09-03", status: "proposed", ...(historyLength !== undefined ? { historyLength } : {}) };
  }
  async function confirm(rec: InsightRecommendation, baselineHistory: InsightRecommendationDeps["baselineHistory"]) {
    const store = mkStore([mkInsight({ recommendation: rec })]);
    const createChange = vi.fn(() => ({ id: 77 }));
    const createTask = vi.fn(() => ({ id: 99 }));
    const deps = mkDeps({
      insights: store.read(), setInsights: store.setInsights, baselineHistory,
      dispatcher: { createChange, createTask } as unknown as InsightRecommendationDeps["dispatcher"],
    });
    const { result } = renderHook(() => useInsightRecommendations(deps));
    act(() => { result.current.setReviewInsightId(1); });
    await act(async () => { await result.current.confirmInsightRecommendation(); });
    return { store, deps, createChange, createTask };
  }
  const moneyCall = { name: "create_change", input: { title: "Scope add", costImpact: 5000 } };
  const plainCall = { name: "create_task", input: { taskName: "New", assignee: "A", dueDate: "2026-09-09" } };
  const refusedToast = () => t("en-US", "insightRecommendationCurrencyChanged");

  it("generated before a switch: refuses the whole apply, nothing written, the insight not advanced, and the toast says why", async () => {
    const { store, deps, createChange, createTask } = await confirm(recWith([plainCall, moneyCall], 0), [SWITCH]);
    expect(createChange).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
    expect(store.calls).not.toHaveBeenCalled();
    expect(store.read()[0].recommendation?.status).toBe("proposed");
    expect(deps.showToast).toHaveBeenCalledWith("error", refusedToast());
    expect(deps.logActivityAs).not.toHaveBeenCalled();
  });

  it("generated after a same-day switch (stamped with it): applied", async () => {
    const { store, deps, createChange } = await confirm(recWith([moneyCall], 1), [SWITCH]);
    expect(createChange).toHaveBeenCalledTimes(1);
    expect(store.read()[0].recommendation?.status).toBe("applied");
    expect(deps.showToast).not.toHaveBeenCalledWith("error", refusedToast());
  });

  it("applies a recommendation without money arguments even after a switch", async () => {
    const { store, deps, createTask } = await confirm(recWith([plainCall], 0), [SWITCH]);
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(store.read()[0].recommendation?.status).toBe("applied");
    expect(deps.showToast).not.toHaveBeenCalledWith("error", refusedToast());
  });

  it("an unstamped (older build) recommendation after a switch: refused", async () => {
    const { createChange, deps } = await confirm(recWith([moneyCall]), [CREATION, SWITCH]);
    expect(createChange).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith("error", refusedToast());
  });

  it("an unstamped recommendation with only the creation entry: applied", async () => {
    const { createChange, store } = await confirm(recWith([moneyCall]), [CREATION]);
    expect(createChange).toHaveBeenCalledTimes(1);
    expect(store.read()[0].recommendation?.status).toBe("applied");
  });

  it("a generated recommendation is stamped with the history length in force when its prompt was built", async () => {
    vi.spyOn(recommendCall, "runInsightRecommendation").mockResolvedValue(mkRec({ id: 42, status: "In Progress" }));
    const store = mkStore([mkInsight()]);
    const { result } = renderHook(() => useInsightRecommendations(mkDeps({ insights: store.read(), setInsights: store.setInsights, baselineHistory: [CREATION, SWITCH] })));
    await act(async () => { result.current.insightActions.onGenerateRecommendation(1); });
    expect(store.read()[0].recommendation?.historyLength).toBe(2);
    expect(store.read()[0].recommendation?.historyDigest).toBe(baselineHistoryDigest([CREATION, SWITCH]));
  });

  // Driven through the BACKGROUND RUNNER on purpose, like the §350 token test above: it reads the
  // store callback from a ref at ANSWER time, so only the prompt-time snapshot keeps the stamp at
  // the length the prompt saw. (The on-demand generate captures its callback at START, so a
  // test through it passes even when the snapshot is ignored.)
  it("a switch landing while the model answers does not move the stamp: it is the prompt-time length", async () => {
    let answer!: (r: InsightRecommendation) => void;
    vi.spyOn(recommendCall, "runInsightRecommendation").mockReturnValue(
      new Promise<InsightRecommendation>((r) => { answer = r; }),
    );
    const store = mkStore([mkInsight()]);
    const runnerSettings = {
      ai: { enabled: true, consent: newConsent(new Date(0)), backgroundConsent: newConsent(new Date(0)), apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x", insightRecommendations: true },
    } as unknown as InsightRecommendationDeps["settings"];
    const { rerender } = renderHook(
      (p: { history: InsightRecommendationDeps["baselineHistory"] }) =>
        useInsightRecommendations(mkDeps({ settings: runnerSettings, insights: store.read(), setInsights: store.setInsights, baselineHistory: p.history })),
      { initialProps: { history: [CREATION] } },
    );
    await act(async () => { await Promise.resolve(); });
    expect(recommendCall.runInsightRecommendation).toHaveBeenCalledTimes(1); // the runner's mount tick
    rerender({ history: [CREATION, SWITCH] });
    await act(async () => { answer(mkRec({ id: 42, status: "In Progress" })); });
    expect(store.read()[0].recommendation, "no recommendation was stored").toBeDefined();
    expect(store.read()[0].recommendation?.historyLength).toBe(1);
    expect(store.read()[0].recommendation?.historyDigest).toBe(baselineHistoryDigest([CREATION]));
  });
});

// §782 — found by the demo recorder's with-AI rehearsal: a "Budget off plan"
// recommendation applied with "Some changes … couldn't be applied" and no trace
// of which call failed or why. The model had proposed a create runTool refuses.
describe("§782 — a call the dispatcher would refuse is refused in review, and a failure is named", () => {
  const validCreate = { name: "create_task", input: { taskName: "Review T&M burn", assignee: "Dana Ortiz", dueDate: "2026-09-25" } };
  const invalidCreate = { name: "create_task", input: { title: "Review T&M burn", dueDate: "2026-09-25" } };

  function mkCreateDispatcher(createTask: (input: Record<string, unknown>) => unknown) {
    const spy = vi.fn(createTask);
    const dispatcher = { ...mkDispatcher().dispatcher, createTask: spy } as unknown as InsightRecommendationDeps["dispatcher"];
    return { dispatcher, spy };
  }
  function recWith(calls: InsightRecommendation["proposedCalls"]): InsightRecommendation {
    return { ...mkRec({}), proposedCalls: calls };
  }
  async function confirm(rec: InsightRecommendation, dispatcher: InsightRecommendationDeps["dispatcher"]) {
    const store = mkStore([mkInsight({ recommendation: rec })]);
    const deps = mkDeps({ insights: store.read(), setInsights: store.setInsights, dispatcher });
    const { result } = renderHook(() => useInsightRecommendations(deps));
    act(() => { result.current.setReviewInsightId(1); });
    const plan = result.current.reviewPlan;
    await act(async () => { await result.current.confirmInsightRecommendation(); });
    return { store, deps, plan };
  }
  afterEach(() => clearDiagLog());

  it("gives the model the active people a create may assign, and no archived one", async () => {
    const spy = vi.spyOn(recommendCall, "runInsightRecommendation").mockResolvedValue(mkRec({ id: 42 }));
    const people = new Map([
      [1, { id: 1, firstName: "Dana", lastName: "Ortiz", active: true }],
      [2, { id: 2, firstName: "Lee", lastName: "Park", active: false }],
    ]) as unknown as InsightRecommendationDeps["resourcesById"];
    const store = mkStore([mkInsight()]);
    const { result } = renderHook(() =>
      useInsightRecommendations(mkDeps({ resourcesById: people, insights: store.read(), setInsights: store.setInsights })),
    );
    await act(async () => { result.current.insightActions.onGenerateRecommendation(1); });
    const ctx = spy.mock.calls[0][0].context;
    expect(ctx).toContain("## People (assign by name)\n- Dana Ortiz");
    expect(ctx).not.toContain("Lee Park");
  });

  // (a) + (d): the stored `proposedCalls` are what confirm replays; no parse runs
  // on this path, so the check has to sit in the replay itself.
  it("never sends a stored create_task missing taskName and assignee, and says nothing was applied", async () => {
    const { dispatcher, spy } = mkCreateDispatcher((input) => ({ id: 99, ...input }));
    const { store, deps, plan } = await confirm(recWith([invalidCreate]), dispatcher);
    expect(plan?.creates).toHaveLength(0);
    expect(plan?.rejected.map((r) => r.detail)).toEqual(["create_task: taskName, assignee required"]);
    expect(spy).not.toHaveBeenCalled();
    expect(store.calls).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith("error", t("en-US", "insightRecommendationAllRejected"));
  });

  it("refuses the invalid create, applies its valid sibling, and records the refusal", async () => {
    const { dispatcher, spy } = mkCreateDispatcher((input) => ({ id: 99, ...input }));
    const { store, deps } = await confirm(recWith([invalidCreate, validCreate]), dispatcher);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ taskName: "Review T&M burn", assignee: "Dana Ortiz" });
    expect(store.read()[0].recommendation?.status).toBe("applied");
    expect(store.read()[0].recommendation?.refusedCalls).toBe(1);
    expect(deps.showToast).toHaveBeenCalledWith("error", t("en-US", "insightRecommendationApplyFailed"));
  });

  // (b)
  it("still applies a valid create_task", async () => {
    const { dispatcher, spy } = mkCreateDispatcher((input) => ({ id: 99, ...input }));
    const { store, deps } = await confirm(recWith([validCreate]), dispatcher);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(store.read()[0].recommendation?.status).toBe("applied");
    expect(deps.showToast).toHaveBeenCalledWith("info", t("en-US", "insightRecommendationApplied"));
    expect(readDiagLog()).toHaveLength(0);
  });

  // (c) The values never reach the log: only the tool, the dispatcher's message
  // and the argument NAMES the call carried.
  it("logs a call that throws with its tool, message and keys, and names it in the toast", async () => {
    const { dispatcher } = mkCreateDispatcher(() => { throw new Error("assignee is required"); });
    const { store, deps } = await confirm(recWith([validCreate]), dispatcher);
    const entry = readDiagLog().find((e) => e.code === "insight.recommendation.callFailed");
    expect(entry?.level).toBe("error");
    // ★ `keys` is a joined string: `redactFields` keeps only scalars, so an
    //  array would be dropped from the entry without a sound.
    expect(entry?.fields).toEqual({ tool: "create_task", message: "assignee is required", keys: "taskName,assignee,dueDate" });
    expect(JSON.stringify(entry)).not.toContain("Dana Ortiz");
    expect(deps.showToast).toHaveBeenCalledWith(
      "error",
      t("en-US", "insightRecommendationApplyFailedDetail", "create_task: assignee is required"),
    );
    // The new wording keeps the old sentence, so what it meant is unchanged.
    expect(t("en-US", "insightRecommendationApplyFailedDetail", "x")).toContain(t("en-US", "insightRecommendationApplyFailed"));
    // A hard failure may have written, so the advance rule is unchanged.
    expect(store.read()[0].recommendation?.status).toBe("applied");
  });
});

// §782 review round 1.
describe("§782 — a call that did not land keeps the card from reading as fully applied", () => {
  const create = { name: "create_task", input: { taskName: "Review T&M burn", assignee: "Dana Ortiz", dueDate: "2026-09-25" } };
  afterEach(() => clearDiagLog());

  function setup(calls: InsightRecommendation["proposedCalls"], dispatcher: InsightRecommendationDeps["dispatcher"], over: Partial<InsightRecommendationDeps> = {}) {
    const store = mkStore([mkInsight({ recommendation: { ...mkRec({}), proposedCalls: calls } })]);
    const deps = mkDeps({ insights: store.read(), setInsights: store.setInsights, dispatcher, ...over });
    const { result } = renderHook(() => useInsightRecommendations(deps));
    return { store, deps, result };
  }

  // I1 — a thrown call is counted with the refused ones, so the card says
  // "Partly applied" and offers Generate, never the plain "applied" note. The
  // insight still advances: a hard failure may have written something.
  it("marks the card partly applied, with Generate offered, when every call threw", async () => {
    const dispatcher = {
      ...mkDispatcher().dispatcher,
      createTask: vi.fn(() => { throw new Error("assignee is required"); }),
    } as unknown as InsightRecommendationDeps["dispatcher"];
    const { store, result } = setup([create, create], dispatcher);
    act(() => { result.current.setReviewInsightId(1); });
    await act(async () => { await result.current.confirmInsightRecommendation(); });
    const stored = store.read()[0];
    expect(stored.status).toBe("acted");
    expect(stored.recommendation?.status).toBe("applied");
    expect(stored.recommendation?.refusedCalls).toBe(2);
    const generate = vi.fn();
    render(
      <InsightRecommendationControls
        insight={stored}
        title="Budget off plan"
        lang="en-US"
        actions={{ onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn(), onGenerateRecommendation: generate, onApplyRecommendation: vi.fn(), onRejectRecommendation: vi.fn() }}
      />,
    );
    expect(screen.getByText(t("en-US", "insightRecommendationAppliedPartial"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "insightRecommendationApplied"))).toBeNull();
    screen.getByRole("button", { name: `${t("en-US", "insightGenerateRecommendation")} – Budget off plan` }).click();
    expect(generate).toHaveBeenCalledWith(1);
  });

  // M2 — the review lists an update on a row that is gone as rejected; the
  // confirm now refuses it too instead of dispatching it into "not found".
  it("does not send an update whose target row is gone, and says nothing was applied", async () => {
    const d = mkDispatcher();
    const getTask = vi.fn(d.dispatcher.getTask);
    const dispatcher = { ...d.dispatcher, getTask } as unknown as InsightRecommendationDeps["dispatcher"];
    const { store, deps, result } = setup([{ name: "update_task", input: { id: 999, status: "Done" } }], dispatcher);
    act(() => { result.current.setReviewInsightId(1); });
    expect(result.current.reviewPlan?.rejected.map((r) => r.reason)).toEqual(["unknown-id"]);
    await act(async () => { await result.current.confirmInsightRecommendation(); });
    expect(getTask).not.toHaveBeenCalled();
    expect(store.calls).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith("error", t("en-US", "insightRecommendationAllRejected"));
    expect(readDiagLog()).toHaveLength(0);
  });

  // M5 — a resource with no first or last name has no name to assign by.
  it("leaves a nameless resource out of the people list", async () => {
    const spy = vi.spyOn(recommendCall, "runInsightRecommendation").mockResolvedValue(mkRec({ id: 42 }));
    const people = new Map([
      [1, { id: 1, firstName: "", lastName: " ", active: true }],
      [2, { id: 2, firstName: "Dana", lastName: "Ortiz", active: true }],
    ]) as unknown as InsightRecommendationDeps["resourcesById"];
    const store = mkStore([mkInsight()]);
    const { result } = renderHook(() =>
      useInsightRecommendations(mkDeps({ resourcesById: people, insights: store.read(), setInsights: store.setInsights })),
    );
    await act(async () => { result.current.insightActions.onGenerateRecommendation(1); });
    const ctx: string = spy.mock.calls[0][0].context;
    expect(ctx).toContain("## People (assign by name)\n- Dana Ortiz");
    expect(ctx.split("\n").filter((l) => l.trim() === "-")).toHaveLength(0);
  });
});

// §782 review round 3.
describe("§782 round 3 — people without a directory, a stale and a failed call together, and German reasons", () => {
  afterEach(() => clearDiagLog());

  async function peopleSection(over: Partial<InsightRecommendationDeps>) {
    const spy = vi.spyOn(recommendCall, "runInsightRecommendation").mockResolvedValue(mkRec({ id: 42 }));
    const store = mkStore([mkInsight()]);
    const { result } = renderHook(() =>
      useInsightRecommendations(mkDeps({ insights: store.read(), setInsights: store.setInsights, ...over })),
    );
    await act(async () => { result.current.insightActions.onGenerateRecommendation(1); });
    const ctx = spy.mock.calls[0][0].context;
    spy.mockRestore();
    return ctx.split("## People (assign by name)\n")[1];
  }

  // I1 — assignees are free text, so a project with no resource directory still
  // has people a create may name: the ones its tasks are assigned to.
  it("lists the task assignees after the active resources, once each, case-insensitively", async () => {
    const tasks = [
      { ...task, assignee: "Sam Lee" },
      { id: 43, taskName: "Second", status: "To Do", assignee: "sam lee" },
      { id: 44, taskName: "Third", status: "To Do", assignee: " " },
      { id: 45, taskName: "Fourth", status: "In Progress", assignee: "dana ortiz" },
    ] as unknown as InsightRecommendationDeps["tasks"];
    expect(await peopleSection({ tasks })).toBe("- Sam Lee\n- dana ortiz");
    const resourcesById = new Map([[1, { id: 1, firstName: "Dana", lastName: "Ortiz", active: true }]]) as unknown as InsightRecommendationDeps["resourcesById"];
    expect(await peopleSection({ tasks, resourcesById })).toBe("- Dana Ortiz\n- Sam Lee");
  });

  // Re-review Minor 1 — only someone on open work is offered for new work.
  it("leaves out an assignee whose only tasks are closed", async () => {
    const tasks = [
      { ...task, assignee: "Sam Lee" },
      { id: 43, taskName: "Shipped", status: "Done", assignee: "Kim Ito" },
      { id: 44, taskName: "Dropped", status: "Cancelled", assignee: "Ash Roy" },
    ] as unknown as InsightRecommendationDeps["tasks"];
    expect(await peopleSection({ tasks })).toBe("- Sam Lee");
  });

  // Re-review Minor 1 — an archived resource stays out even when an open task
  // still carries the name, so "Active people only" holds for the whole list.
  it("leaves out an assignee who matches an archived resource, case-insensitively", async () => {
    const tasks = [
      { ...task, assignee: "Sam Lee" },
      { id: 43, taskName: "Open", status: "To Do", assignee: "kim ito" },
    ] as unknown as InsightRecommendationDeps["tasks"];
    const resourcesById = new Map([[1, { id: 1, firstName: "Kim", lastName: "Ito", active: false }]]) as unknown as InsightRecommendationDeps["resourcesById"];
    expect(await peopleSection({ tasks, resourcesById })).toBe("- Sam Lee");
  });

  it("says no person is known when there is no directory and no task is assigned", async () => {
    expect(await peopleSection({})).toBe("(none known: do not propose create_task; prefer editing an existing item)");
  });

  // Minor 1 — before this the stale toast returned first and the failure's
  // reason was only logged.
  it("names the failed call when another was refused as stale in the same apply", async () => {
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
    const dispatcher = {
      ...(mkDispatcher().dispatcher as unknown as Record<string, unknown>),
      createTask: vi.fn(() => { throw new Error("assignee is required"); }),
    } as unknown as InsightRecommendationDeps["dispatcher"];
    const deps = mkDeps({ insights: store.read(), setInsights: store.setInsights, dispatcher });
    const { result } = renderHook(() => useInsightRecommendations(deps));
    act(() => { result.current.setReviewInsightId(1); });
    await act(async () => { await result.current.confirmInsightRecommendation(); });
    expect(deps.showToast).toHaveBeenCalledWith(
      "error",
      t("en-US", "insightRecommendationStalePartialDetail", "create_task: assignee is required"),
    );
    expect(deps.showToast).toHaveBeenCalledTimes(1);
    // The advance and the record are those of any partly-landed apply.
    expect(store.read()[0].recommendation?.refusedCalls).toBe(2);
  });

  // Minor 4 — the review's reason frame follows the UI language; tool and
  // argument names stay as they are.
  it("words a refused call's reason in the UI language", async () => {
    await loadI18n("de");
    const rec = { ...mkRec({}), proposedCalls: [
      { name: "create_task", input: { title: "Review T&M burn", dueDate: "2026-09-25" } },
      { name: "create_milestone", input: { name: "Go-live", date: "next week" } },
    ] };
    const store = mkStore([mkInsight({ recommendation: rec })]);
    const { result } = renderHook(() =>
      useInsightRecommendations(mkDeps({ lang: "de", insights: store.read(), setInsights: store.setInsights })),
    );
    act(() => { result.current.setReviewInsightId(1); });
    expect(result.current.reviewPlan?.rejected.map((r) => r.detail)).toEqual([
      "create_task: taskName, assignee erforderlich",
      "create_milestone: date muss im Format JJJJ-MM-TT sein",
    ]);
  });
});

// §773 — the review's plan is judged against the absences, people and holidays the hook is handed.
describe("§773 — the review plan warns of absence clashes", () => {
  it("carries a clash when the recommended due date lands on the owner's absence", () => {
    const maya = { id: 1, firstName: "Maya", lastName: "Patel" };
    const deps = mkDeps({
      insights: [mkInsight({ recommendation: mkRec({ id: 42, assignee: "Maya Patel", dueDate: "2026-11-05" }) })],
      resourcesById: new Map([[1, maya]]) as unknown as InsightRecommendationDeps["resourcesById"],
      absences: [{ id: 1, assignee: "Maya Patel", resourceId: 1, type: "vacation", startDate: "2026-11-03", endDate: "2026-11-07" }] as unknown as InsightRecommendationDeps["absences"],
    });
    const { result } = renderHook(() => useInsightRecommendations(deps));
    act(() => { result.current.setReviewInsightId(1); });
    expect(result.current.reviewPlan?.clashes).toEqual([
      expect.objectContaining({ entity: "task", id: 42, clash: expect.objectContaining({ person: "Maya Patel", resourceId: 1 }) }),
    ]);
  });
});
