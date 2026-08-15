import { describe, it, expect } from "vitest";
import {
  computeDashboardProgress, computeScheduleStatus, computeBudgetStatus,
  selectTopRaid, partitionUpcoming, recentActivity, computeDashboard,
  evmIndexHealth, scopeCounts, tasksHaveNoActiveScope, hasNoActiveScope,
  type DashboardInput,
} from "./dashboard";
import type { ProjectReport } from "./budget-report";
import type { Task, RaidItem, Milestone, ChangeItem, BudgetBucket } from "./types";
import type { ActivityEntry } from "./activity-log";

function task(o: Partial<Task> = {}): Task {
  return {
    id: 1, taskName: "T", assignee: "A", assigneeEmail: "a@x.io",
    dueDate: "2026-06-10", lastUpdateDate: "2026-06-01", status: "To Do", priority: "Medium",
    blockers: "", description: "", ...o,
  };
}
function raid(o: Partial<RaidItem> = {}): RaidItem {
  return {
    id: 1, category: "R", title: "risk", status: "Open",
    linkedTaskIds: [], raisedDate: "2026-01-01", causedByRaidIds: [], stakeholderIds: [], ...o,
  };
}
function project(budgetValue: number, consumedValue: number): ProjectReport {
  return {
    budgetHours: 0, plannedHours: 0, actualHours: 0,
    budgetValue, consumedValue, revenue: 0, cost: 0,
    winLossHours: 0, winLossValue: 0,
    contributionMargin: { amount: 0, percent: null },
    costPerformance: { amount: 0, percent: null },
    consumption: { amount: 0, percent: null },
    earnedValue: null,
    costPerformanceIndex: null,
    budgetMirrorsPlan: false,
    costUnknownReason: null,
    unpricedDisciplineIds: [],
  };
}
const today = "2026-06-02";
const holidays = new Set<string>();

describe("computeDashboardProgress", () => {
  it("returns 0% and zero counts for an empty workspace", () => {
    expect(computeDashboardProgress([], today, holidays)).toEqual({ total: 0, inScope: 0, completed: 0, percent: 0, counts: { R: 0, A: 0, G: 0 }, outOfScope: 0 });
  });
  it("computes percent from completedDate and R/A/G counts from health", () => {
    const tasks = [
      task({ id: 1, status: "Done", completedDate: "2026-06-01" }),
      task({ id: 2, dueDate: "2026-05-01" }),
      task({ id: 3, dueDate: "2026-06-02" }),
      task({ id: 4, dueDate: "2026-12-01" }),
    ];
    const p = computeDashboardProgress(tasks, today, holidays);
    expect(p.total).toBe(4);
    expect(p.completed).toBe(1);
    expect(p.percent).toBe(25);
    expect(p.counts).toEqual({ R: 1, A: 1, G: 2 });
  });

  // ★★ The two engines answer the SCOPE question independently — `scopeCounts`
  //    for the denominator, `computeGroupHealth` for the tally — and they render
  //    side by side in ONE card. This pins them agreeing; drift here is what put
  //    "All cancelled (2)" beside "G 2" (open-followups §66).
  it("outOfScope equals total - inScope when nothing is hand-pinned", () => {
    const tasks = [
      task({ id: 1, status: "Cancelled" }),
      task({ id: 2, status: "Done" }),
      task({ id: 3, status: "Done", completedDate: "2026-06-01" }),
      task({ id: 4, dueDate: "2026-12-01" }),
    ];
    const p = computeDashboardProgress(tasks, today, holidays);
    expect(p.outOfScope).toBe(p.total - p.inScope);
    expect(p.outOfScope).toBe(2);
    expect(p.counts.R + p.counts.A + p.counts.G + p.outOfScope).toBe(p.total);
  });

  // A pinned row is the one case where the two DELIBERATELY diverge: it stays in
  // `counts` with its manual colour but is still out of the scope denominator.
  it("a hand-pinned cancelled task stays in counts and out of inScope", () => {
    const p = computeDashboardProgress(
      [task({ id: 1, status: "Cancelled", healthOverride: "R" })],
      today,
      holidays,
    );
    expect(p.counts.R).toBe(1);
    expect(p.outOfScope).toBe(0);
    expect(p.inScope).toBe(0);
  });
});

describe("computeScheduleStatus", () => {
  it("is Green when nothing is overdue or due soon", () => {
    expect(computeScheduleStatus([task({ dueDate: "2026-12-01" })], today, holidays)).toBe("G");
  });
  it("is Amber when a task is due within the work-day window", () => {
    expect(computeScheduleStatus([task({ dueDate: "2026-06-03" })], today, holidays)).toBe("A");
  });
  it("is Red when any task is overdue", () => {
    expect(computeScheduleStatus([task({ dueDate: "2026-05-01" }), task({ dueDate: "2026-12-01" })], today, holidays)).toBe("R");
  });
  it("ignores completed tasks", () => {
    expect(computeScheduleStatus([task({ dueDate: "2026-05-01", status: "Done", completedDate: "2026-05-02" })], today, holidays)).toBe("G");
  });
});

describe("computeBudgetStatus", () => {
  it("is null when there is no budget", () => {
    expect(computeBudgetStatus(null)).toBeNull();
    expect(computeBudgetStatus(project(0, 0))).toBeNull();
  });
  it("is Green below the amber ratio", () => {
    expect(computeBudgetStatus(project(100, 50))).toBe("G");
  });
  it("is Amber at or above 90% consumption", () => {
    expect(computeBudgetStatus(project(100, 90))).toBe("A");
  });
  it("is Red when over budget", () => {
    expect(computeBudgetStatus(project(100, 101))).toBe("R");
  });
});

describe("evmIndexHealth", () => {
  it("returns null for an undefined index", () => {
    expect(evmIndexHealth(null)).toBeNull();
  });
  it("returns null when healthy (>= 0.9)", () => {
    expect(evmIndexHealth(1)).toBeNull();
    expect(evmIndexHealth(0.9)).toBeNull();
  });
  it("returns Amber below 0.9 and at/above 0.8", () => {
    expect(evmIndexHealth(0.89)).toBe("A");
    expect(evmIndexHealth(0.8)).toBe("A");
  });
  it("returns Red below 0.8", () => {
    expect(evmIndexHealth(0.79)).toBe("R");
    expect(evmIndexHealth(0)).toBe("R");
  });
});

describe("selectTopRaid", () => {
  it("drops terminal-status items", () => {
    const items = [raid({ id: 1, status: "Closed" }), raid({ id: 2, status: "Open", severity: "High" })];
    expect(selectTopRaid(items).map((r) => r.id)).toEqual([2]);
  });
  it("sorts by severity (Critical first), derives risk severity from matrix", () => {
    const items = [
      raid({ id: 1, severity: "Low" }),
      raid({ id: 2, severity: "Critical" }),
      raid({ id: 3, category: "R", probability: 5, impact: 5 }),
    ];
    const ids = selectTopRaid(items).map((r) => r.id);
    expect(ids[0] === 2 || ids[0] === 3).toBe(true);
    expect(ids[ids.length - 1]).toBe(1);
  });
  it("caps at the limit", () => {
    const items = Array.from({ length: 8 }, (_, i) => raid({ id: i + 1, severity: "High" }));
    expect(selectTopRaid(items, 5)).toHaveLength(5);
  });
  it("breaks severity ties by most-recently-raised first", () => {
    const items = [
      raid({ id: 1, severity: "High", raisedDate: "2026-01-01" }),
      raid({ id: 2, severity: "High", raisedDate: "2026-03-01" }),
      raid({ id: 3, severity: "High", raisedDate: "2026-02-01" }),
    ];
    expect(selectTopRaid(items).map((r) => r.id)).toEqual([2, 3, 1]);
  });
});

describe("partitionUpcoming", () => {
  it("splits overdue vs due-soon, ignores completed and far-future, sorts by dueDate", () => {
    const tasks = [
      task({ id: 1, dueDate: "2026-05-20" }),
      task({ id: 2, dueDate: "2026-05-10" }),
      task({ id: 3, dueDate: "2026-06-03" }),
      task({ id: 4, dueDate: "2026-12-01" }),
      task({ id: 5, dueDate: "2026-05-01", status: "Done", completedDate: "2026-05-02" }),
    ];
    const { overdue, dueSoon } = partitionUpcoming(tasks, today, holidays);
    expect(overdue.map((t) => t.id)).toEqual([2, 1]);
    expect(dueSoon.map((t) => t.id)).toEqual([3]);
  });
});

describe("recentActivity", () => {
  it("returns the last N entries, newest first", () => {
    const entries: ActivityEntry[] = Array.from({ length: 10 }, (_, i) => ({
      id: String(i + 1), timestamp: `2026-06-0${(i % 9) + 1}T00:00:00.000Z`, kind: "task.created", args: [],
    }));
    expect(recentActivity(entries, 3).map((e) => e.id)).toEqual(["10", "9", "8"]);
  });
});

describe("computeDashboard", () => {
  function baseInput(over: Partial<DashboardInput> = {}): DashboardInput {
    return {
      tasks: [], raid: [], budgets: [], plan: { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" },
      roles: [], resources: [], absences: [], workdayHours: 8,
      holidaySet: new Set<string>(), status: {}, activity: [], today: "2026-06-02",
      milestones: [], changes: [],
      ...over,
    };
  }
  it("returns neutral values for an empty workspace (no crash, no budget)", () => {
    const m = computeDashboard(baseInput());
    expect(m.overall.effective).toBe("G");
    expect(m.burn).toBeNull();
    expect(m.budget.effective).toBeNull();
    expect(m.progress.percent).toBe(0);
    expect(m.scope.effective).toBeNull();
    expect(m.narrative.text).toBe("");
  });
  it("applies the overall RAG override and reports the computed value + flag", () => {
    const tasks = [task({ dueDate: "2026-05-01" })];
    const m = computeDashboard(baseInput({ tasks, status: { ragOverride: "G" } }));
    expect(m.overall.computed).toBe("R");
    expect(m.overall.effective).toBe("G");
    expect(m.overall.overridden).toBe(true);
  });
  it("surfaces the narrative + scope override", () => {
    const m = computeDashboard(baseInput({ status: { scopeOverride: "A", narrative: "hi", narrativeUpdatedAt: "2026-06-02T00:00:00.000Z" } }));
    expect(m.scope.effective).toBe("A");
    expect(m.narrative).toEqual({ text: "hi", updatedAt: "2026-06-02T00:00:00.000Z" });
  });
  it("an at-risk/due-soon milestone drives the Schedule RAG to Amber", () => {
    const milestones = [{ id: 1, name: "soon", date: "2026-06-03", linkedTaskIds: [] }]; // due-soon vs today 2026-06-02
    const m = computeDashboard(baseInput({ milestones }));
    expect(m.dueSoonMilestones.map((x) => x.id)).toEqual([1]);
    expect(m.schedule.computed).toBe("A");
  });
  it("partitions milestones and folds them into the Schedule RAG", () => {
    const milestones: Milestone[] = [
      { id: 1, name: "late", date: "2026-05-01", linkedTaskIds: [] },   // overdue (today is 2026-06-02 in baseInput)
      { id: 2, name: "soon", date: "2026-06-03", linkedTaskIds: [] },   // due-soon
    ];
    const m = computeDashboard(baseInput({ milestones }));
    expect(m.overdueMilestones.map((x) => x.id)).toEqual([1]);
    expect(m.dueSoonMilestones.map((x) => x.id)).toEqual([2]);
    expect(m.schedule.computed).toBe("R"); // overdue milestone drives Red
  });
  it("computes EVM from task estimates (independent of budgets)", () => {
    const tasks = [
      task({ id: 1, originalEstimateMinutes: 2400, dueDate: "2026-05-01", status: "Done", completedDate: "2026-04-30", timeSpentMinutes: 2700 }),
      task({ id: 2, originalEstimateMinutes: 1200, dueDate: "2026-12-01" }),
    ];
    const m = computeDashboard(baseInput({ tasks }));
    expect(m.evm.pv).toBe(40);
    expect(m.evm.ev).toBe(40);
    expect(m.evm.ac).toBe(45);
    expect(m.evm.coverage).toEqual({ withEstimate: 2, total: 2 });
    expect(m.evm.money).toBeNull();
  });
  it("folds a low SPI into the Schedule RAG (escalates Amber to Red)", () => {
    // task 1: 80h done today (PV 80, EV 80). task 2: 40h due today, open
    // (PV +40, due-soon -> taskSchedule Amber). SPI = 80/120 = 0.667 -> Red.
    const tasks = [
      task({ id: 1, originalEstimateMinutes: 4800, dueDate: today, status: "Done", completedDate: today }),
      task({ id: 2, originalEstimateMinutes: 2400, dueDate: today }),
    ];
    const m = computeDashboard(baseInput({ tasks }));
    expect(m.evm.spi).toBeCloseTo(0.667, 2);
    expect(m.schedule.computed).toBe("R");
  });
  it("folds a low CPI into the Budget RAG even with no budget buckets", () => {
    // 80h earned, 100h spent -> CPI 0.8 -> Amber; no budgets configured.
    const tasks = [
      task({ id: 1, originalEstimateMinutes: 4800, dueDate: "2026-05-01", status: "Done", completedDate: "2026-04-30", timeSpentMinutes: 6000 }),
    ];
    const m = computeDashboard(baseInput({ tasks }));
    expect(m.evm.cpi).toBeCloseTo(0.8, 5);
    expect(m.budget.computed).toBe("A");
    expect(m.budget.effective).toBe("A");
  });
  it("leaves the RAGs unchanged when EVM indices are healthy", () => {
    const tasks = [
      task({ id: 1, originalEstimateMinutes: 4800, dueDate: "2026-05-01", status: "Done", completedDate: "2026-04-30", timeSpentMinutes: 4800 }),
    ];
    const m = computeDashboard(baseInput({ tasks }));
    expect(m.evm.spi).toBe(1);
    expect(m.evm.cpi).toBe(1);
    expect(m.schedule.computed).toBe("G");
    expect(m.budget.computed).toBeNull();
  });
  it("lets a manual Budget override win over a low CPI", () => {
    const tasks = [
      task({ id: 1, originalEstimateMinutes: 4800, dueDate: "2026-05-01", status: "Done", completedDate: "2026-04-30", timeSpentMinutes: 6000 }),
    ];
    const m = computeDashboard(baseInput({ tasks, status: { budgetOverride: "G" } }));
    expect(m.budget.computed).toBe("A");
    expect(m.budget.effective).toBe("G");
    expect(m.budget.overridden).toBe(true);
  });

  // Two buckets covering Mar-Jun of a Jan-Dec plan, so a chained span is a
  // strictly narrower window than the plan range.
  const bucketA = {
    id: 1, name: "Phase 1", type: "tm", currency: "EUR",
    startDate: "2026-03-01", endDate: "2026-04-30", status: "open", allocations: [],
  } as unknown as BudgetBucket;
  const bucketB = {
    id: 2, name: "Phase 2", type: "tm", currency: "EUR",
    startDate: "2026-05-01", endDate: "2026-06-30", status: "open", allocations: [],
  } as unknown as BudgetBucket;

  it("has no bucket chain when there are no budgets", () => {
    expect(computeDashboard(baseInput()).bucketChain).toBeNull();
  });

  it("trims the burn-down to a connected successor chain", () => {
    const budgets = [{ ...bucketA, successorId: 2 }, bucketB];
    const m = computeDashboard(baseInput({ budgets }));
    expect(m.bucketChain).toMatchObject({ kind: "chain", start: "2026-03-01", end: "2026-06-30" });
    expect(m.burndown?.periods).toEqual(["2026-03", "2026-04", "2026-05", "2026-06"]);
  });

  it("keeps the plan range without a break when the buckets are unchained", () => {
    // Nobody set a successor, which is the ordinary parallel-workstream model —
    // full axis, but no warning to act on.
    const m = computeDashboard(baseInput({ budgets: [bucketA, bucketB] }));
    expect(m.bucketChain).toEqual({ kind: "unchained" });
    expect(m.burndown?.periods).toHaveLength(12);
  });

  it("keeps the plan range and reports the break when a chain is half-built", () => {
    const budgets = [{ ...bucketA, successorId: 2 }, bucketB, {
      id: 3, name: "Phase 3", type: "tm", currency: "EUR",
      startDate: "2026-07-01", endDate: "2026-08-31", status: "open", allocations: [],
    } as unknown as BudgetBucket];
    const m = computeDashboard(baseInput({ budgets }));
    expect(m.bucketChain).toMatchObject({ kind: "broken", reason: "multiple-roots" });
    expect(m.burndown?.periods).toHaveLength(12);
  });

  it("keeps the plan range and reports a chain dated outside it", () => {
    const budgets = [
      { ...bucketA, startDate: "2027-03-01", endDate: "2027-04-30", successorId: 2 },
      { ...bucketB, startDate: "2027-05-01", endDate: "2027-06-30" },
    ];
    const m = computeDashboard(baseInput({ budgets }));
    expect(m.bucketChain).toMatchObject({ kind: "broken", reason: "outside-plan" });
    expect(m.burndown?.periods).toHaveLength(12);
  });
});

describe("dashboard scope signal from changes", () => {
  function baseInput(over: Partial<DashboardInput> = {}): DashboardInput {
    return {
      tasks: [], raid: [], budgets: [], plan: { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" },
      roles: [], resources: [], absences: [], workdayHours: 8,
      holidaySet: new Set<string>(), status: {}, activity: [], today: "2026-06-02",
      milestones: [], changes: [],
      ...over,
    };
  }
  function changeItem(over: Partial<ChangeItem> = {}): ChangeItem {
    return {
      id: 1, title: "c", description: "", type: "Scope", status: "Proposed",
      raisedDate: "2026-06-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [], ...over,
    };
  }
  it("Amber scope when 1..4 pending changes", () => {
    const model = computeDashboard(baseInput({ changes: [changeItem({})] }));
    expect(model.scope.computed).toBe("A");
    expect(model.scope.effective).toBe("A");
  });
  it("Red scope at >=5 pending", () => {
    const changes = Array.from({ length: 5 }, (_, i) => changeItem({ id: i + 1 }));
    expect(computeDashboard(baseInput({ changes })).scope.computed).toBe("R");
  });
  it("manual scopeOverride wins", () => {
    const model = computeDashboard(baseInput({ changes: [changeItem({})], status: { scopeOverride: "G" } }));
    expect(model.scope.effective).toBe("G");
    expect(model.scope.overridden).toBe(true);
  });
  it("changes summary counts pending/approved/implemented", () => {
    const changes = [
      changeItem({ id: 1, status: "Proposed" }),
      changeItem({ id: 2, status: "Approved" }),
      changeItem({ id: 3, status: "Implemented" }),
    ];
    const m = computeDashboard(baseInput({ changes }));
    expect(m.changes).toMatchObject({ pending: 1, approved: 1, implemented: 1, total: 3 });
  });
});

describe("computeDashboard burndown", () => {
  function dashInput(over: Partial<DashboardInput> = {}): DashboardInput {
    return {
      tasks: [], raid: [], budgets: [],
      plan: { startDate: "2026-01-01", endDate: "2026-03-31", granularity: "month", currency: "EUR", rows: [] } as unknown as DashboardInput["plan"],
      roles: [], resources: [], absences: [],
      workdayHours: 8, holidaySet: holidays,
      status: {} as DashboardInput["status"], activity: [], today, milestones: [], changes: [],
      ...over,
    };
  }
  it("is null when there are no budgets", () => {
    expect(computeDashboard(dashInput()).burndown).toBeNull();
  });
  it("is a series when budgets exist", () => {
    const budgets = [{
      id: 1, name: "B", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-03-31", status: "open",
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: {} }],
    }] as unknown as DashboardInput["budgets"];
    const roles = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 200 }] as unknown as DashboardInput["roles"];
    const model = computeDashboard(dashInput({ budgets, roles }));
    expect(model.burndown).not.toBeNull();
    expect(model.burndown!.totalBudgetHours).toBe(100);
  });
});

describe("Cancelled tasks are closed, not active", () => {
  it("excludes a cancelled task from the schedule RAG", () => {
    const tasks = [task({ id: 1, status: "Cancelled", dueDate: "2020-01-01" })];
    expect(computeScheduleStatus(tasks, "2026-08-03", holidays)).toBe("G");
  });

  it("excludes a cancelled task from the overdue list", () => {
    const tasks = [task({ id: 1, status: "Cancelled", dueDate: "2020-01-01" })];
    expect(partitionUpcoming(tasks, "2026-08-03", holidays).overdue).toEqual([]);
  });

  it("still counts a done task as overdue-free but delivered", () => {
    const tasks = [task({ id: 1, status: "Done", completedDate: "2026-08-01", dueDate: "2020-01-01" })];
    expect(partitionUpcoming(tasks, "2026-08-03", holidays).overdue).toEqual([]);
    expect(computeDashboardProgress(tasks, "2026-08-03", holidays).completed).toBe(1);
  });

  it("drops cancelled work from the completion-percentage denominator", () => {
    const tasks = [
      task({ id: 1, status: "Done", completedDate: "2026-08-01" }),
      task({ id: 2, status: "Cancelled" }),
    ];
    const p = computeDashboardProgress(tasks, "2026-08-03", holidays);
    expect(p.percent).toBe(100);
    expect(p.completed).toBe(1);
    // `total` keeps its original meaning: every task, cancelled included.
    expect(p.total).toBe(2);
    // ...and `inScope` exposes the denominator the percentage actually used, so
    // a caller rendering "completed of X" beside `percent` can stay consistent.
    expect(p.inScope).toBe(1);
  });

  it("exposes inScope as the percentage denominator (5 done / 5 cancelled)", () => {
    const tasks = [
      ...[1, 2, 3, 4, 5].map((id) => task({ id, status: "Done", completedDate: "2026-08-01" })),
      ...[6, 7, 8, 9, 10].map((id) => task({ id, status: "Cancelled" })),
    ];
    const p = computeDashboardProgress(tasks, "2026-08-03", holidays);
    expect(p).toMatchObject({ total: 10, inScope: 5, completed: 5, percent: 100 });
    // Self-consistency: percent must equal completed/inScope, never completed/total.
    expect(Math.round((p.completed / p.inScope) * 100)).toBe(p.percent);
  });

  it("reports 0% when every task is cancelled (empty denominator)", () => {
    const tasks = [task({ id: 1, status: "Cancelled" })];
    expect(computeDashboardProgress(tasks, "2026-08-03", holidays).percent).toBe(0);
  });
});

describe("scopeCounts / tasksHaveNoActiveScope", () => {
  // These exist so a caller holding only tasks does not RE-DERIVE
  // `isTaskClosed && !isTaskDelivered`. The point of the pair is that it stays
  // in lockstep with what the dashboard tiles show, so the binding assertion is
  // the agreement one at the bottom, not the individual cases.
  it("puts cancelled work out of scope and delivered work in it", () => {
    expect(scopeCounts([])).toEqual({ total: 0, inScope: 0 });
    expect(scopeCounts([task({ id: 1, status: "Cancelled" })])).toEqual({ total: 1, inScope: 0 });
    expect(scopeCounts([
      task({ id: 1, status: "Cancelled" }),
      task({ id: 2, status: "Done", completedDate: "2026-06-02" }),
      task({ id: 3, status: "To Do" }),
    ])).toEqual({ total: 3, inScope: 2 });
  });

  it("separates an all-cancelled project from an empty one", () => {
    expect(tasksHaveNoActiveScope([])).toBe(false);
    expect(tasksHaveNoActiveScope([task({ id: 1, status: "Cancelled" })])).toBe(true);
    // Partial cancellation is NOT no-active-scope — the Trends completion row
    // and the sparkline both stay visible here.
    expect(tasksHaveNoActiveScope([
      task({ id: 1, status: "Cancelled" }),
      task({ id: 2, status: "To Do" }),
    ])).toBe(false);
  });

  // The assertion that actually protects the invariant: whatever the tiles
  // decide from `DashboardProgress`, the task-only helper decides identically.
  // Re-deriving the predicate is precisely how two dashboard cards once
  // disagreed, so this fails if either side is changed alone.
  it("agrees with hasNoActiveScope over computeDashboardProgress for the same tasks", () => {
    const cases: Task[][] = [
      [],
      [task({ id: 1, status: "Cancelled" })],
      [task({ id: 1, status: "Cancelled" }), task({ id: 2, status: "Cancelled" })],
      [task({ id: 1, status: "Cancelled" }), task({ id: 2, status: "To Do" })],
      [task({ id: 1, status: "Done", completedDate: "2026-06-02" })],
    ];
    for (const tasks of cases) {
      const progress = computeDashboardProgress(tasks, "2026-06-10", new Set<string>());
      expect(tasksHaveNoActiveScope(tasks)).toBe(hasNoActiveScope(progress));
      expect(scopeCounts(tasks)).toEqual({ total: progress.total, inScope: progress.inScope });
    }
  });
});
