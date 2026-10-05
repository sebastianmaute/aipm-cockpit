// Pins useNextActions (use-next-actions.ts, §491): the workload alerts it feeds
// the engine, the input it assembles, the grouping / now-count / comms-pending
// ids it derives from the result, the jump-to-comms link and its popout gate,
// and the group-aware snooze. The engine itself (`computeNextActions`), the
// assembler and the workload builder are mocked — they have their own tests —
// so this file sees only the wiring. The snooze store is the real one.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { SuggestedAction } from "./next-actions";
import type { DashboardModel } from "./dashboard";
import type { StakeholderCommsReminder } from "./stakeholder-comms";
import { defaultSettings, defaultNextActionsConfig } from "./settings-types";
import type { Task } from "./types";

const { computeNextActions, buildActionInput, buildWorkloadAlerts } = vi.hoisted(() => ({
  computeNextActions: vi.fn(),
  buildActionInput: vi.fn((a: unknown) => a),
  buildWorkloadAlerts: vi.fn(),
}));
vi.mock("./next-actions", async (orig) => ({ ...(await orig<typeof import("./next-actions")>()), computeNextActions }));
vi.mock("./next-actions-input", () => ({ buildActionInput }));
vi.mock("./next-actions-workload", () => ({ buildWorkloadAlerts }));

import { useNextActions, type NextActionsDeps } from "./use-next-actions";

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
    plan: undefined,
    dashboardModel: DASHBOARD,
    commsReminders: COMMS,
    features: defaultSettings.features,
    project: undefined,
    portfolioCurrentId: null,
    today: "2026-10-05",
    workdayHours: 8,
    holidaySet: new Set<string>(),
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
});

describe("useNextActions — engine input", () => {
  it("builds the workload alerts from the deps and its two thresholds, and hands them to the engine", () => {
    const { deps } = setup();
    expect(buildWorkloadAlerts).toHaveBeenCalledWith({
      resources: deps.resources, tasks: deps.tasks, absences: deps.absences, shifts: deps.shifts,
      raid: deps.raid, plan: undefined, today: "2026-10-05", workdayHours: 8, holidaySet: deps.holidaySet,
      overdueThreshold: 5, overAllocatedPct: 120,
    });
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

  it("collects only the stakeholder ids of open stakeholder-comms actions, as numbers", () => {
    computeNextActions.mockReturnValue([
      action("s1", { source: "stakeholder-comms", cta: { kind: "open", view: "stakeholders", id: "7" } }),
      action("s2", { source: "stakeholder-comms", cta: { kind: "open", view: "stakeholders", id: 9 } }),
      action("m1", { cta: { kind: "open", view: "milestones", id: 11 } }),
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
