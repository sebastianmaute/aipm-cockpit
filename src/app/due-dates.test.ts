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
    status: "To Do",
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
  const noAbsences: Absence[] = [];

  test("categorizes overdue, today, and soon while excluding tasks beyond threshold", () => {
    // today=2025-06-10 (Tue), reminderLeadDays=5
    // task 3 due 2025-06-12: trigger = isoAddDays(2025-06-12,-5)=2025-06-07(Sat)->shift->2025-06-06(Fri); 2025-06-10 >= 2025-06-06 => soon
    // task 4 due 2025-07-15: trigger = 2025-07-10(Thu); 2025-06-10 < 2025-07-10 => excluded
    const tasks: Task[] = [
      makeTask({ id: 1, dueDate: "2025-06-05" }),
      makeTask({ id: 2, dueDate: "2025-06-10" }),
      makeTask({ id: 3, dueDate: "2025-06-12" }),
      makeTask({ id: 4, dueDate: "2025-07-15" }),
    ];
    const alerts = getAlertableTasks(tasks, 5, today, noHolidays, noAbsences);
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
    expect(getAlertableTasks(tasks, 5, today, noHolidays, noAbsences)).toEqual([]);
  });

  test("sorts results by due date ascending", () => {
    const tasks: Task[] = [
      makeTask({ id: 1, dueDate: "2025-06-11" }),
      makeTask({ id: 2, dueDate: "2025-06-10" }),
      makeTask({ id: 3, dueDate: "2025-06-09" }),
    ];
    const alerts = getAlertableTasks(tasks, 5, today, noHolidays, noAbsences);
    expect(alerts.map((a) => a.task.id)).toEqual([3, 2, 1]);
  });

  test("trigger shifts past weekend: task due Friday, leadDays=1 → trigger is Thursday", () => {
    // due=2025-06-13 (Fri), trigger=isoAddDays(Fri,-1)=2025-06-12(Thu); today=2025-06-12 >= Thu => soon
    const tasks: Task[] = [makeTask({ id: 1, dueDate: "2025-06-13" })];
    const alerts = getAlertableTasks(tasks, 1, "2025-06-12", noHolidays, noAbsences);
    expect(alerts[0]?.category).toBe("soon");
  });

  test("trigger shifts past Saturday: due=Mon, leadDays=2 → trigger shifts back from Sat to Fri", () => {
    // due=2025-06-16(Mon), isoAddDays(-2)=2025-06-14(Sat)->shift->2025-06-13(Fri)
    const tasks: Task[] = [makeTask({ id: 1, dueDate: "2025-06-16" })];
    const alerts = getAlertableTasks(tasks, 2, "2025-06-13", noHolidays, noAbsences);
    expect(alerts[0]?.category).toBe("soon");
    // Not triggered yet on the day before
    expect(getAlertableTasks(tasks, 2, "2025-06-12", noHolidays, noAbsences)).toHaveLength(0);
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
