import { describe, expect, it } from "vitest";
import { taskDueProvider } from "./task-due";
import type { ActionInput } from "../types";
import type { Task } from "../../types";
import { ACTION_WEIGHTS } from "../score";

function input(tasks: Task[]): ActionInput {
  return {
    tasks, raid: [], changes: [], milestones: [], stakeholders: [], commsReminders: [],
    dashboard: {} as ActionInput["dashboard"], features: [], today: "2026-06-15", now: new Date("2026-06-15T00:00:00Z"),
    reminderLeadDays: 0, dueSoonWorkdays: 3, raidReviewIntervalDays: 30, dismissed: new Set(),
    projectName: "",
  } as ActionInput;
}

describe("taskDueProvider", () => {
  it("emits an overdue task action with overdue urgency and an open CTA", () => {
    const task: Task = { id: 7, taskName: "Ship", dueDate: "2026-06-10", assignee: "", assigneeEmail: "", lastUpdateDate: "2026-06-01", status: "To Do", priority: "Medium", blockers: "", description: "" };
    const acts = taskDueProvider.provide(input([task]));
    expect(acts).toHaveLength(1);
    const a = acts[0];
    expect(a.id).toBe("task-due:7:overdue");
    expect(a.source).toBe("task-due");
    expect(a.title).toEqual({ key: "actionTaskTitle", params: ["Ship"] });
    expect(a.cta).toEqual({ kind: "open", view: "open-points", id: 7 });
    expect(a.score).toBeGreaterThanOrEqual(ACTION_WEIGHTS.urgencyOverdue);
  });
  it("§450 — says how many working days a task is overdue, with the singular at one", () => {
    // 2026-06-15 is a Monday. Due the previous Friday → 1 working day overdue;
    // due the Wednesday before → 3. The line used to read `workDaysLeft`,
    // which is always 0 for an overdue task: "Overdue by 0 working days".
    const base = { assignee: "", assigneeEmail: "", lastUpdateDate: "2026-06-01", status: "To Do", priority: "Medium", blockers: "", description: "" } as const;
    const [one] = taskDueProvider.provide(input([{ ...base, id: 1, taskName: "A", dueDate: "2026-06-12" } as Task]));
    expect(one.why).toEqual({ key: "actionTaskWhyOverdueOne", params: [1] });
    const [three] = taskDueProvider.provide(input([{ ...base, id: 2, taskName: "B", dueDate: "2026-06-10" } as Task]));
    expect(three.why).toEqual({ key: "actionTaskWhyOverdue", params: [3] });
  });

  it("returns nothing when no tasks are due", () => {
    expect(taskDueProvider.provide(input([]))).toEqual([]);
  });
  it("emits nothing when taskDueEnabled is false (settings toggle off)", () => {
    const task: Task = { id: 7, taskName: "Ship", dueDate: "2026-06-10", assignee: "", assigneeEmail: "", lastUpdateDate: "2026-06-01", status: "To Do", priority: "Medium", blockers: "", description: "" };
    expect(taskDueProvider.provide({ ...input([task]), taskDueEnabled: false })).toEqual([]);
  });
  it("includes the clarity bonus in the score for an overdue task", () => {
    const task: Task = { id: 7, taskName: "Ship", dueDate: "2026-06-10", assignee: "", assigneeEmail: "", lastUpdateDate: "2026-06-01", status: "To Do", priority: "Medium", blockers: "", description: "" };
    const [a] = taskDueProvider.provide(input([task]));
    expect(a.score).toBe(ACTION_WEIGHTS.urgencyOverdue + ACTION_WEIGHTS.clarityBonus);
  });
});
