import { describe, test, expect } from "vitest";
import type { Task } from "./types";
import { workdaysUntil, getAlertableTasks, shiftToWorkingDay, absenceDayMap } from "./due-dates";
import type { Absence } from "./types";

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

describe("shiftToWorkingDay", () => {
  const NONE = new Set<string>();
  test("returns the date unchanged on a weekday", () => {
    expect(shiftToWorkingDay("2026-06-17", NONE, NONE)).toBe("2026-06-17"); // Wed
  });
  test("Saturday shifts back to Friday (+1)", () => {
    expect(shiftToWorkingDay("2026-06-20", NONE, NONE)).toBe("2026-06-19");
  });
  test("Sunday shifts back to Friday (+2)", () => {
    expect(shiftToWorkingDay("2026-06-21", NONE, NONE)).toBe("2026-06-19");
  });
  test("steps back over a holiday", () => {
    expect(shiftToWorkingDay("2026-06-20", new Set(["2026-06-19"]), NONE)).toBe("2026-06-18");
  });
  test("steps back over an absence day", () => {
    expect(shiftToWorkingDay("2026-06-19", NONE, new Set(["2026-06-19"]))).toBe("2026-06-18");
  });
});

describe("absenceDayMap", () => {
  test("expands an absence range to per-day entries keyed by case-folded name", () => {
    const abs: Absence[] = [{ id: 1, assignee: "Alex Example", startDate: "2026-06-10", endDate: "2026-06-12", type: "vacation" }];
    const map = absenceDayMap(abs);
    expect([...(map.get("Alex Example") ?? [])].sort()).toEqual(["2026-06-10", "2026-06-11", "2026-06-12"]);
  });
});
