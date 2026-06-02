import { describe, it, expect } from "vitest";
import {
  computeDashboardProgress, computeScheduleStatus, computeBudgetStatus,
  selectTopRaid, partitionUpcoming, recentActivity, computeDashboard,
  type DashboardInput,
} from "./dashboard";
import type { ProjectReport } from "./budget-report";
import type { Task, RaidItem } from "./types";
import type { ActivityEntry } from "./activity-log";

function task(o: Partial<Task> = {}): Task {
  return {
    id: 1, taskName: "T", assignee: "A", assigneeEmail: "a@x.io",
    dueDate: "2026-06-10", lastUpdateDate: "2026-06-01", priority: "Medium",
    blockers: "", notes: "", ...o,
  };
}
function raid(o: Partial<RaidItem> = {}): RaidItem {
  return {
    id: 1, category: "R", title: "risk", status: "Open",
    linkedTaskIds: [], raisedDate: "2026-01-01", causedByRaidIds: [], ...o,
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
  };
}
const today = "2026-06-02";
const holidays = new Set<string>();

describe("computeDashboardProgress", () => {
  it("returns 0% and zero counts for an empty workspace", () => {
    expect(computeDashboardProgress([], today, holidays)).toEqual({ total: 0, completed: 0, percent: 0, counts: { R: 0, A: 0, G: 0 } });
  });
  it("computes percent from completedDate and R/A/G counts from health", () => {
    const tasks = [
      task({ id: 1, completedDate: "2026-06-01" }),
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
    expect(computeScheduleStatus([task({ dueDate: "2026-05-01", completedDate: "2026-05-02" })], today, holidays)).toBe("G");
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
      task({ id: 5, dueDate: "2026-05-01", completedDate: "2026-05-02" }),
    ];
    const { overdue, dueSoon } = partitionUpcoming(tasks, today, holidays);
    expect(overdue.map((t) => t.id)).toEqual([2, 1]);
    expect(dueSoon.map((t) => t.id)).toEqual([3]);
  });
});

describe("recentActivity", () => {
  it("returns the last N entries, newest first", () => {
    const entries: ActivityEntry[] = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1, timestamp: `2026-06-0${(i % 9) + 1}T00:00:00.000Z`, kind: "task.created", args: [],
    }));
    expect(recentActivity(entries, 3).map((e) => e.id)).toEqual([10, 9, 8]);
  });
});

describe("computeDashboard", () => {
  function baseInput(over: Partial<DashboardInput> = {}): DashboardInput {
    return {
      tasks: [], raid: [], budgets: [], plan: { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" },
      roles: [], resources: [], absences: [], workdayHours: 8,
      holidaySet: new Set<string>(), status: {}, activity: [], today: "2026-06-02",
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
});
