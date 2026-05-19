import { describe, test, expect } from "vitest";
import type { Task } from "./types";
import { workdaysUntil, getAlertableTasks } from "./due-dates";

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 1,
    taskName: "test",
    assignee: "",
    assigneeEmail: "",
    dueDate: "",
    lastUpdateDate: "",
    priority: "Medium",
    blockers: "",
    notes: "",
    ...overrides,
  };
}

describe("workdaysUntil", () => {
  test("skips weekends (Mon -> next Mon = 5 workdays)", () => {
    expect(workdaysUntil("2025-06-09", "2025-06-02", new Set())).toBe(5);
  });

  test("skips holidays inside the window", () => {
    const holidays = new Set(["2025-06-04"]);
    expect(workdaysUntil("2025-06-06", "2025-06-02", holidays)).toBe(3);
  });

  test("returns 0 when due is today or in the past", () => {
    expect(workdaysUntil("2025-06-02", "2025-06-02", new Set())).toBe(0);
    expect(workdaysUntil("2025-05-30", "2025-06-02", new Set())).toBe(0);
  });
});

describe("getAlertableTasks", () => {
  const today = "2025-06-10";
  const noHolidays = new Set<string>();

  test("categorizes overdue, today, and soon while excluding tasks beyond threshold", () => {
    const tasks: Task[] = [
      makeTask({ id: 1, dueDate: "2025-06-05" }),
      makeTask({ id: 2, dueDate: "2025-06-10" }),
      makeTask({ id: 3, dueDate: "2025-06-12" }),
      makeTask({ id: 4, dueDate: "2025-07-15" }),
    ];
    const alerts = getAlertableTasks(tasks, 5, today, noHolidays);
    expect(alerts.map((a) => [a.task.id, a.category])).toEqual([
      [1, "overdue"],
      [2, "today"],
      [3, "soon"],
    ]);
  });

  test("excludes completed tasks regardless of due date", () => {
    const tasks: Task[] = [
      makeTask({ id: 1, dueDate: "2025-06-05", completedDate: "2025-06-04" }),
    ];
    expect(getAlertableTasks(tasks, 5, today, noHolidays)).toEqual([]);
  });

  test("sorts results by due date ascending", () => {
    const tasks: Task[] = [
      makeTask({ id: 1, dueDate: "2025-06-11" }),
      makeTask({ id: 2, dueDate: "2025-06-10" }),
      makeTask({ id: 3, dueDate: "2025-06-09" }),
    ];
    const alerts = getAlertableTasks(tasks, 5, today, noHolidays);
    expect(alerts.map((a) => a.task.id)).toEqual([3, 2, 1]);
  });
});
