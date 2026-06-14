// src/app/next-actions/providers/milestone.ts
import { describe, expect, it } from "vitest";
import { milestoneProvider } from "./milestone";
import type { ActionInput } from "../types";
import type { Milestone, Task } from "../../types";
import { ACTION_WEIGHTS, scoreAction } from "../score";

const TODAY = "2026-06-15";

function input(milestones: Milestone[], tasks: Task[] = []): ActionInput {
  return {
    tasks, raid: [], changes: [], milestones, stakeholders: [], commsReminders: [],
    dashboard: {} as ActionInput["dashboard"], features: [], today: TODAY, now: new Date(`${TODAY}T00:00:00Z`),
    reminderLeadDays: 0, dueSoonWorkdays: 3, raidReviewIntervalDays: 30, dismissed: new Set(),
    projectName: "",
  } as ActionInput;
}

/** Minimal overdue milestone (date < today, not achieved). */
function overdueMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: 1,
    name: "Phase 1 Complete",
    date: "2026-06-01",   // < TODAY → overdue
    linkedTaskIds: [],
    ...overrides,
  };
}

/** On-track future milestone (date well after today, no blocking tasks). */
function onTrackMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: 2,
    name: "Phase 2 Launch",
    date: "2026-09-01",   // >> TODAY, no linked tasks → on-track
    linkedTaskIds: [],
    ...overrides,
  };
}

/** Minimal Task for constructing at-risk scenarios. */
function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 10,
    taskName: "Blocking task",
    assignee: "",
    assigneeEmail: "",
    dueDate: "2026-08-01",
    lastUpdateDate: TODAY,
    priority: "Medium",
    blockers: "",
    notes: "",
    ...overrides,
  };
}

describe("milestoneProvider — overdue milestone", () => {
  it("emits milestone:<id>:overdue action for an overdue milestone", () => {
    const m = overdueMilestone();
    const acts = milestoneProvider.provide(input([m]));
    expect(acts).toHaveLength(1);
    const a = acts[0];
    expect(a.id).toBe("milestone:1:overdue");
    expect(a.source).toBe("milestone");
    expect(a.moduleId).toBe("milestones");
  });

  it("sets title with milestone name param", () => {
    const acts = milestoneProvider.provide(input([overdueMilestone({ name: "Go Live" })]));
    expect(acts[0].title).toEqual({ key: "actionMilestoneTitle", params: ["Go Live"] });
  });

  it("sets why to actionMilestoneWhyOverdue", () => {
    const acts = milestoneProvider.provide(input([overdueMilestone()]));
    expect(acts[0].why).toEqual({ key: "actionMilestoneWhyOverdue" });
  });

  it("computes score = urgencyOverdue + impactBlocksMilestone + semiClarityBonus", () => {
    const expectedScore = scoreAction({
      urgency: ACTION_WEIGHTS.urgencyOverdue,
      impact: ACTION_WEIGHTS.impactBlocksMilestone,
      clarity: ACTION_WEIGHTS.semiClarityBonus,
    });
    const acts = milestoneProvider.provide(input([overdueMilestone()]));
    expect(acts[0].score).toBe(expectedScore);  // 40 + 20 + 7 = 67
  });

  it("sets cta to open milestones view with milestone id", () => {
    const acts = milestoneProvider.provide(input([overdueMilestone({ id: 42 })]));
    expect(acts[0].cta).toEqual({ kind: "open", view: "milestones", id: 42 });
  });
});

describe("milestoneProvider — on-track milestone", () => {
  it("emits NO action for an on-track future milestone", () => {
    const acts = milestoneProvider.provide(input([onTrackMilestone()]));
    expect(acts).toHaveLength(0);
  });

  it("emits NO action for an achieved milestone whose date is in the past", () => {
    const m = overdueMilestone({ achievedDate: "2026-06-02" });
    const acts = milestoneProvider.provide(input([m]));
    expect(acts).toHaveLength(0);
  });
});

describe("milestoneProvider — at-risk milestone", () => {
  it("emits milestone:<id>:at-risk action when a linked task's dueDate is after the milestone date", () => {
    // Milestone date is in the future but a linked task slips past it → at-risk
    const atRiskMs = onTrackMilestone({
      id: 5,
      date: "2026-07-01",
      linkedTaskIds: [10],
    });
    const blockingTask = task({ id: 10, dueDate: "2026-07-15" }); // task ends after milestone
    const acts = milestoneProvider.provide(input([atRiskMs], [blockingTask]));
    expect(acts).toHaveLength(1);
    const a = acts[0];
    expect(a.id).toBe("milestone:5:at-risk");
    expect(a.source).toBe("milestone");
    expect(a.why).toEqual({ key: "actionMilestoneWhyAtRisk" });
    expect(a.cta).toEqual({ kind: "open", view: "milestones", id: 5 });
  });

  it("computes score = riskHigh + impactBlocksMilestone + semiClarityBonus for at-risk", () => {
    const expectedScore = scoreAction({
      risk: ACTION_WEIGHTS.riskHigh,
      impact: ACTION_WEIGHTS.impactBlocksMilestone,
      clarity: ACTION_WEIGHTS.semiClarityBonus,
    });
    const atRiskMs = onTrackMilestone({ id: 5, date: "2026-07-01", linkedTaskIds: [10] });
    const blockingTask = task({ id: 10, dueDate: "2026-07-15" });
    const acts = milestoneProvider.provide(input([atRiskMs], [blockingTask]));
    expect(acts[0].score).toBe(expectedScore);  // 15 + 20 + 7 = 42
  });
});

describe("milestoneProvider — semi-clarity bonus", () => {
  it("includes the semi-clarity bonus in the overdue score", () => {
    const [a] = milestoneProvider.provide(input([overdueMilestone()]));
    expect(a.score).toBe(ACTION_WEIGHTS.urgencyOverdue + ACTION_WEIGHTS.impactBlocksMilestone + ACTION_WEIGHTS.semiClarityBonus);
  });
});

describe("milestoneProvider — edge cases", () => {
  it("returns empty array when milestones list is empty", () => {
    expect(milestoneProvider.provide(input([]))).toEqual([]);
  });

  it("handles multiple milestones — emits for overdue, skips on-track", () => {
    const acts = milestoneProvider.provide(input([
      overdueMilestone({ id: 1 }),
      onTrackMilestone({ id: 2 }),
      overdueMilestone({ id: 3, name: "Design Done", date: "2026-05-01" }),
    ]));
    const ids = acts.map((a) => a.id);
    expect(ids).toContain("milestone:1:overdue");
    expect(ids).toContain("milestone:3:overdue");
    expect(ids.some((id) => id.includes("2:"))).toBe(false);
  });
});
