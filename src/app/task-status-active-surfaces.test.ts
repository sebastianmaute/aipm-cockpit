import { describe, expect, it } from "vitest";
import { getAlertableTasks } from "./due-dates";
import { computeTaskHealth } from "./health";
import type { Task } from "./types";

const t = (over: Partial<Task>): Task =>
  ({
    id: 1,
    taskName: "T",
    assignee: "",
    assigneeEmail: "",
    dueDate: "2020-01-01",
    lastUpdateDate: "2019-12-01",
    priority: "Medium",
    blockers: "",
    notes: "",
    status: "To Do",
    ...over,
  }) as Task;

// getAlertableTasks(tasks, reminderLeadDays, today, holidays, absences)
const alertsOf = (tasks: Task[]) =>
  getAlertableTasks(tasks, 3, "2026-06-19", new Set<string>(), []);

describe("Cancelled tasks are not active (due-date alerts)", () => {
  it("excludes a past-due Cancelled task from alerts", () => {
    const alerts = alertsOf([t({ id: 1, status: "Cancelled", dueDate: "2020-01-01" })]);
    expect(alerts.find((a) => a.task.id === 1)).toBeUndefined();
  });

  it("still includes a past-due open task", () => {
    const alerts = alertsOf([t({ id: 2, status: "To Do", dueDate: "2020-01-01" })]);
    expect(alerts.find((a) => a.task.id === 2)).toBeDefined();
  });

  it("still excludes a Done task (completedDate set)", () => {
    const alerts = alertsOf([
      t({ id: 3, status: "Done", completedDate: "2020-02-01", dueDate: "2020-01-01" }),
    ]);
    expect(alerts.find((a) => a.task.id === 3)).toBeUndefined();
  });
});

describe("Cancelled tasks are not active (health)", () => {
  it("treats a past-due Cancelled task as Green (non-active), not red/overdue", () => {
    const health = computeTaskHealth(
      t({ status: "Cancelled", dueDate: "2020-01-01", blockers: "" }),
      "2026-06-19",
    );
    expect(health.color).toBe("G");
  });

  it("still flags a past-due open task as red/overdue", () => {
    const health = computeTaskHealth(
      t({ status: "To Do", dueDate: "2020-01-01" }),
      "2026-06-19",
    );
    expect(health.color).toBe("R");
  });
});
