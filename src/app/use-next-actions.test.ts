// Pins useNextActions (use-next-actions.ts, §491): the workload alerts it feeds
// the engine, the input it assembles, the grouping / now-count / comms-pending
// ids it derives from the result, the jump-to-comms link and its popout gate,
// and the group-aware snooze. The engine itself (`computeNextActions`), the
// assembler and the workload builder are mocked — they have their own tests —
// so this file sees only the wiring. The snooze store is the real one.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { SuggestedAction } from "./next-actions";
import type { DashboardModel } from "./dashboard";
import type { StakeholderCommsReminder } from "./stakeholder-comms";
import { defaultSettings, defaultNextActionsConfig } from "./settings-types";
import type { Task, ResourcePlan, SteeringCommittee } from "./types";
import type { ActionTrends } from "./next-actions/trends";

const { computeNextActions, buildActionInput, buildWorkloadAlerts } = vi.hoisted(() => ({
  computeNextActions: vi.fn(),
  buildActionInput: vi.fn((a: unknown) => a),
  buildWorkloadAlerts: vi.fn(),
}));
vi.mock("./next-actions", async (orig) => ({ ...(await orig<typeof import("./next-actions")>()), computeNextActions }));
vi.mock("./next-actions-input", () => ({ buildActionInput }));
vi.mock("./next-actions-workload", () => ({ buildWorkloadAlerts }));
// Call-through spies: the forecast runs for real; the spies only count and, for
// one test, substitute a run with a milestone chance. The real functions are
// stashed so beforeEach can re-arm the passthrough after vi.restoreAllMocks().
const fc = vi.hoisted(() => ({
  engine: vi.fn(),
  app: vi.fn(),
  realEngine: null as null | ((...a: never[]) => unknown),
  realApp: null as null | ((...a: never[]) => unknown),
}));
vi.mock("./forecast/index", async (orig) => {
  const real = await orig<typeof import("./forecast/index")>();
  fc.realEngine = real.computeScheduleForecast as never;
  return { ...real, computeScheduleForecast: fc.engine };
});
vi.mock("./forecast/app-forecast", async (orig) => {
  const real = await orig<typeof import("./forecast/app-forecast")>();
  fc.realApp = real.computeAppForecast as never;
  return { ...real, computeAppForecast: fc.app };
});

import { useNextActions, type NextActionsDeps } from "./use-next-actions";
import { groupNextActions } from "./next-actions/group";
import { computeAppForecast, type AppForecast } from "./forecast/app-forecast";
import { showForecastView } from "../test/forecast-view";
import type { Milestone } from "./types";

function action(id: string, over: Partial<SuggestedAction> = {}): SuggestedAction {
  return {
    id,
    source: "milestone",
    title: { key: "actionMilestoneTitle", params: ["X"] },
    why: { key: "actionMilestoneWhyAtRisk" },
    score: 10,
    tier: "now",
    cta: { kind: "open", view: "milestones", id: 1 },
    ...over,
  };
}

const ALERTS = [{ resourceId: 1, resourceName: "Ada", reason: "overload" as const, value: 4 }];
const COMMS = [{ stakeholderId: 7 }] as unknown as StakeholderCommsReminder[];
const DASHBOARD = { marker: "dash" } as unknown as DashboardModel;
const TASKS: Task[] = [];
const PLAN = { marker: "plan" } as unknown as ResourcePlan;

function makeDeps(over: Partial<NextActionsDeps> = {}): NextActionsDeps {
  return {
    isPopout: false,
    tasks: TASKS,
    raid: [],
    changes: [],
    milestones: [],
    stakeholders: [],
    steeringCommittee: undefined,
    resources: [],
    absences: [],
    shifts: [],
    plan: PLAN,
    dashboardModel: DASHBOARD,
    commsReminders: COMMS,
    features: defaultSettings.features,
    project: undefined,
    portfolioCurrentId: null,
    today: "2026-10-05",
    workdayHours: 8,
    holidaySet: new Set<string>(),
    holidaysReady: true,
    settingsOverrides: undefined,
    effectiveNotifications: defaultSettings.notifications,
    effectiveNextActions: { ...defaultNextActionsConfig, workloadOverdueThreshold: 5, workloadAllocatedPct: 120, scopePendingRed: 3 },
    actionTrends: undefined,
    learnedBias: { "milestone:x": 2 },
    recordLearning: vi.fn(async () => {}),
    requestOpen: vi.fn(),
    ...over,
  };
}

function setup(over: Partial<NextActionsDeps> = {}) {
  const deps = makeDeps(over);
  const view = renderHook((d: NextActionsDeps) => useNextActions(d), { initialProps: deps });
  return { ...view, deps };
}

function lastInput(): Record<string, unknown> {
  return buildActionInput.mock.calls.at(-1)![0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  computeNextActions.mockReturnValue([]);
  buildWorkloadAlerts.mockReturnValue(ALERTS);
  fc.engine.mockImplementation(fc.realEngine!);
  fc.app.mockImplementation(fc.realApp!);
});

describe("useNextActions — engine input", () => {
  it("builds the workload alerts from the deps and its two thresholds, and hands them to the engine", () => {
    const { deps } = setup();
    expect(buildWorkloadAlerts).toHaveBeenCalledWith({
      resources: deps.resources, tasks: deps.tasks, absences: deps.absences, shifts: deps.shifts,
      raid: deps.raid, plan: PLAN, today: "2026-10-05", workdayHours: 8, holidaySet: deps.holidaySet,
      overdueThreshold: 5, overAllocatedPct: 120,
    });
    // toHaveBeenCalledWith compares by value; the holiday set must be the caller's own.
    expect(buildWorkloadAlerts.mock.calls[0][0].holidaySet).toBe(deps.holidaySet);
    expect(lastInput().workloadAlerts).toBe(ALERTS);
  });

  it("assembles the engine input from the deps", () => {
    setup({
      project: { name: "Apollo", customer: "ACME" } as NextActionsDeps["project"],
      portfolioCurrentId: "p1",
    });
    const input = lastInput();
    expect(input).toMatchObject({
      dashboard: DASHBOARD,
      commsReminders: COMMS,
      projectName: "Apollo",
      projectId: "p1",
      today: "2026-10-05",
      reminderLeadDays: defaultSettings.notifications.reminderLeadDays,
      dueSoonWorkdays: defaultSettings.notifications.dueSoonWorkdays,
      raidReviewIntervalDays: defaultSettings.notifications.raidReviewIntervalDays,
      raidReviewEnabled: defaultSettings.notifications.raidReview.enabled,
      scopePendingRed: 3,
      learnedBias: { "milestone:x": 2 },
    });
    expect((input.projectMeta as { name: string }).name).toBe("Apollo");
    expect(input.now).toBeInstanceOf(Date);
  });

  it("hands every collection, the committee, the features and the trends to the assembler as they are", () => {
    const committee = { marker: "committee" } as unknown as SteeringCommittee;
    const trends = { marker: "trends" } as unknown as ActionTrends;
    const { deps } = setup({
      tasks: [{ id: 1 } as Task],
      raid: [{ id: 2 }] as unknown as NextActionsDeps["raid"],
      changes: [{ id: 3 }] as unknown as NextActionsDeps["changes"],
      milestones: [{ id: 4 }] as unknown as NextActionsDeps["milestones"],
      stakeholders: [{ id: 5 }] as unknown as NextActionsDeps["stakeholders"],
      steeringCommittee: committee,
      features: ["raid"],
      actionTrends: trends,
    });
    const input = lastInput();
    expect(input.tasks).toBe(deps.tasks);
    expect(input.raid).toBe(deps.raid);
    expect(input.changes).toBe(deps.changes);
    expect(input.milestones).toBe(deps.milestones);
    expect(input.stakeholders).toBe(deps.stakeholders);
    expect(input.steeringCommittee).toBe(committee);
    expect(input.features).toBe(deps.features);
    expect(input.trends).toBe(trends);
  });

  it("falls back to an empty project name and no project id when there is no project", () => {
    setup();
    expect(lastInput().projectName).toBe("");
    expect(lastInput().projectId).toBeUndefined();
  });

  it("runs the engine once per change of an input, not on every render", () => {
    const { rerender, deps } = setup();
    expect(computeNextActions).toHaveBeenCalledTimes(1);
    rerender({ ...deps });
    expect(computeNextActions).toHaveBeenCalledTimes(1);
    rerender({ ...deps, tasks: [] });
    expect(computeNextActions).toHaveBeenCalledTimes(2);
  });
});

describe("useNextActions — derived values", () => {
  it("returns the engine's list, groups it and counts the 'now' tier", () => {
    // a and c point at the same milestone, so they collapse into one group.
    const list = [
      action("a"),
      action("b", { tier: "soon", cta: { kind: "open", view: "milestones", id: 2 } }),
      action("c", { score: 5 }),
    ];
    computeNextActions.mockReturnValue(list);
    const { result } = setup();
    expect(result.current.nextActions).toBe(list);
    expect(result.current.nextActionGroups.map((g) => [g.primary.id, g.extra.map((e) => e.id)])).toEqual([["a", ["c"]], ["b", []]]);
    expect(result.current.nowCount).toBe(2);
  });

  it("collects only the stakeholder ids of open stakeholder-comms actions, as numbers, skipping other sources and non-open CTAs", () => {
    computeNextActions.mockReturnValue([
      action("s1", { source: "stakeholder-comms", cta: { kind: "open", view: "stakeholders", id: "7" } }),
      action("s2", { source: "stakeholder-comms", cta: { kind: "open", view: "stakeholders", id: 9 } }),
      action("m1", { cta: { kind: "open", view: "milestones", id: 11 } }),
      action("s3", { source: "stakeholder-comms", cta: { kind: "snooze", actionId: "s3" } }),
    ]);
    const { result } = setup();
    expect([...result.current.commsPendingStakeholderIds]).toEqual([7, 9]);
  });

  it("jump-to-comms opens the Action Center at the stakeholder", () => {
    const { result, deps } = setup();
    result.current.onJumpToComms!(7);
    expect(deps.requestOpen).toHaveBeenCalledWith("actions", 7);
  });

  it("offers no jump-to-comms in a popout", () => {
    const { result } = setup({ isPopout: true });
    expect(result.current.onJumpToComms).toBeUndefined();
  });
});

describe("useNextActions — snooze", () => {
  it("keeps the snooze handler's identity across renders", () => {
    const { result, rerender, deps } = setup();
    const first = result.current.snoozeAction;
    rerender({ ...deps });
    expect(result.current.snoozeAction).toBe(first);
  });

  it("records the primary's snooze and dismisses the primary and every extra id in the group", () => {
    const { result, deps } = setup();
    expect(lastInput().dismissed).toEqual(new Set());
    const primary = action("a");
    act(() => result.current.snoozeAction(primary, 60_000, ["b", "c"]));
    expect(deps.recordLearning).toHaveBeenCalledTimes(1);
    expect(deps.recordLearning).toHaveBeenCalledWith(primary, "snoozed");
    expect(lastInput().dismissed).toEqual(new Set(["a", "b", "c"]));
  });
});

describe("useNextActions — simulated 'unlikely on time' signal (§502)", () => {
  const SIM_ON = { forecast: { showSimulation: true } } as NextActionsDeps["settingsOverrides"];
  const MILESTONES = [{ id: 7, name: "Go-live", date: "2026-12-01", linkedTaskIds: [] } as unknown as Milestone];
  const FAKE: AppForecast = {
    kind: "forecast", p50: null, p80: null, p95: null, chanceOnTime: null, estimateCoverage: null,
    windowDays: 30, distribution: new Int32Array(0), trials: 0, markers: { p50: 0, p80: 0, p95: 0 },
    milestones: [{ id: 7, state: "chance", chance: 0.31, chancePrioritised: 0.31 }],
  };
  const SIM_ID = "forecast-sim:milestone:7";
  const hasSim = (groups: ReturnType<typeof useNextActions>["nextActionGroups"]) =>
    groups.some((g) => g.primary.id === SIM_ID || g.extra.some((e) => e.id === SIM_ID));

  afterEach(() => vi.restoreAllMocks());

  it("with the switch off, the groups are exactly the grouped engine list and the forecast never runs", () => {
    fc.app.mockReturnValue(FAKE);
    const list = [action("a"), action("b", { score: 5, cta: { kind: "open", view: "raid", id: 2 } })];
    computeNextActions.mockReturnValue(list);
    showForecastView();
    const { result } = setup({ milestones: MILESTONES });
    expect(result.current.nextActionGroups).toEqual(groupNextActions(list));
    expect(fc.app).not.toHaveBeenCalled();
  });

  it("with the switch on but the Forecast view held back, shows no simulated group", () => {
    fc.app.mockReturnValue(FAKE);
    const { result } = setup({ milestones: MILESTONES, settingsOverrides: SIM_ON });
    expect(hasSim(result.current.nextActionGroups)).toBe(false);
    expect(fc.app).not.toHaveBeenCalled();
  });

  it("with the switch on and the view shown, adds the sim group but keeps it out of the flat list", () => {
    fc.app.mockReturnValue(FAKE);
    // One measured now action on another entity: the sim group must not change the count.
    computeNextActions.mockReturnValue([action("raid:1", { score: 70, cta: { kind: "open", view: "raid", id: 1 } })]);
    showForecastView();
    const { result, deps } = setup({ milestones: MILESTONES, settingsOverrides: SIM_ON, plan: { ...PLAN, endDate: "2026-12-31" } });
    expect(hasSim(result.current.nextActionGroups)).toBe(true);
    expect(result.current.nextActions.some((a) => a.source === "forecast-sim")).toBe(false);
    expect(result.current.nowCount).toBe(1);
    expect(result.current.nextActionGroups.map((g) => g.key)).toEqual(["raid:1", SIM_ID]);
    expect(fc.app).toHaveBeenCalledWith({
      tasks: deps.tasks, milestones: deps.milestones, planEnd: "2026-12-31", today: "2026-10-05", holidaySet: deps.holidaySet,
    });
  });

  it("drops a snoozed sim action", () => {
    fc.app.mockReturnValue(FAKE);
    showForecastView();
    const { result } = setup({ milestones: MILESTONES, settingsOverrides: SIM_ON });
    const sim = result.current.nextActionGroups[0].primary;
    expect(sim.id).toBe(SIM_ID);
    act(() => result.current.snoozeAction(sim, 60_000));
    expect(hasSim(result.current.nextActionGroups)).toBe(false);
  });

  it("does not record learning for a sim snooze, but still snoozes it", () => {
    fc.app.mockReturnValue(FAKE);
    showForecastView();
    const { result, deps } = setup({ milestones: MILESTONES, settingsOverrides: SIM_ON });
    const sim = result.current.nextActionGroups[0].primary;
    act(() => result.current.snoozeAction(sim, 60_000));
    expect(deps.recordLearning).not.toHaveBeenCalled();
    expect(lastInput().dismissed).toEqual(new Set([SIM_ID]));
  });

  it("shows no sim group while the holidays are not ready", () => {
    fc.app.mockReturnValue(FAKE);
    showForecastView();
    const { result } = setup({ milestones: MILESTONES, settingsOverrides: SIM_ON, holidaysReady: false });
    expect(hasSim(result.current.nextActionGroups)).toBe(false);
    expect(fc.app).not.toHaveBeenCalled();
  });

  it("shows no sim group with the milestones module off", () => {
    fc.app.mockReturnValue(FAKE);
    showForecastView();
    const features = defaultSettings.features.filter((f) => f !== "milestones");
    const { result } = setup({ milestones: MILESTONES, settingsOverrides: SIM_ON, features });
    expect(hasSim(result.current.nextActionGroups)).toBe(false);
  });

  it("shares the Dashboard's run", () => {
    showForecastView();
    const deps = makeDeps({ milestones: MILESTONES, settingsOverrides: SIM_ON, plan: { ...PLAN, endDate: "2026-12-31" } });
    // What the Dashboard does: the same references, the same plan end and day.
    computeAppForecast({ tasks: deps.tasks, milestones: deps.milestones, planEnd: "2026-12-31", today: deps.today, holidaySet: deps.holidaySet });
    const engineRuns = fc.engine.mock.calls.length;
    renderHook((d: NextActionsDeps) => useNextActions(d), { initialProps: deps });
    expect(fc.app).toHaveBeenCalledTimes(2);
    expect(fc.engine.mock.calls.length).toBe(engineRuns);
  });
});
