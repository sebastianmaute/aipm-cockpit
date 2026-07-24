import { describe, expect, test } from "vitest";
import fc from "fast-check";
import {
  workdaysUntil,
  shiftToWorkingDay,
  summarizeAlerts,
  getAlertableTasks,
  absenceDayMap,
  type AlertCategory,
  type AlertableTask,
} from "./due-dates";
import type { Task, Absence } from "./types";

const isoDateArb = fc
  .date({ min: new Date("2020-01-01"), max: new Date("2030-12-31"), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

function makeTask(over: Partial<Task> & Pick<Task, "id" | "dueDate">): Task {
  return {
    taskName: "T",
    assignee: "alice",
    assigneeEmail: "",
    lastUpdateDate: "2024-01-01",
    status: "To Do",
    priority: "Medium",
    blockers: "",
    description: "",
    ...over,
  };
}

const taskArb: fc.Arbitrary<Task> = fc
  .record({
    id: fc.integer({ min: 1, max: 10000 }),
    dueDate: isoDateArb,
    assignee: fc.constantFrom("alice", "bob", "carol"),
    completed: fc.boolean(),
    completedDate: isoDateArb,
  })
  .map(({ id, dueDate, assignee, completed, completedDate }) =>
    makeTask({ id, dueDate, assignee, completedDate: completed ? completedDate : undefined }),
  );

describe("due-dates — properties", () => {
  test("workdaysUntil is non-negative, and 0 when due <= today", () => {
    fc.assert(
      fc.property(isoDateArb, isoDateArb, (due, today) => {
        const n = workdaysUntil(due, today, new Set());
        expect(n).toBeGreaterThanOrEqual(0);
        if (due <= today) expect(n).toBe(0);
      }),
    );
  });

  test("shiftToWorkingDay never moves the date forward", () => {
    const daySet = fc.array(isoDateArb, { maxLength: 30 }).map((xs) => new Set(xs));
    fc.assert(
      fc.property(isoDateArb, daySet, daySet, (iso, holidays, absences) => {
        expect(shiftToWorkingDay(iso, holidays, absences) <= iso).toBe(true);
      }),
    );
  });

  test("shiftToWorkingDay lands on a working day when no holidays/absences", () => {
    const empty: ReadonlySet<string> = new Set();
    fc.assert(
      fc.property(isoDateArb, (iso) => {
        const result = shiftToWorkingDay(iso, empty, empty);
        const dow = new Date(`${result}T00:00:00`).getDay();
        expect(dow === 0 || dow === 6).toBe(false); // not Sun/Sat
      }),
    );
  });

  test("summarizeAlerts counts partition the input (sum === length)", () => {
    const itemArb: fc.Arbitrary<AlertableTask> = fc
      .record({
        category: fc.constantFrom<AlertCategory>("overdue", "today", "soon"),
        workDaysLeft: fc.nat({ max: 100 }),
        id: fc.integer({ min: 1, max: 1000 }),
        dueDate: isoDateArb,
      })
      .map(({ category, workDaysLeft, id, dueDate }) => ({
        task: makeTask({ id, dueDate }),
        category,
        workDaysLeft,
      }));
    fc.assert(
      fc.property(fc.array(itemArb, { maxLength: 50 }), (items) => {
        const { overdue, today, soon } = summarizeAlerts(items);
        expect(overdue + today + soon).toBe(items.length);
      }),
    );
  });

  test("getAlertableTasks output is sorted ascending by dueDate and never throws", () => {
    const absenceArb: fc.Arbitrary<Absence> = fc.record({
      id: fc.integer({ min: 1, max: 1000 }),
      assignee: fc.constantFrom("alice", "bob", "carol"),
      startDate: isoDateArb,
      endDate: isoDateArb,
      type: fc.constant("other" as const),
    });
    fc.assert(
      fc.property(
        fc.array(taskArb, { maxLength: 40 }),
        fc.nat({ max: 14 }),
        isoDateArb,
        fc.array(absenceArb, { maxLength: 10 }),
        (tasks, leadDays, today, absences) => {
          const out = getAlertableTasks(tasks, leadDays, today, new Set(), absences);
          for (let i = 1; i < out.length; i++) {
            expect(out[i - 1].task.dueDate <= out[i].task.dueDate).toBe(true);
          }
        },
      ),
    );
  });

  test("absenceDayMap only contains days inside some absence range for that assignee", () => {
    const absenceArb: fc.Arbitrary<Absence> = fc
      .record({
        id: fc.integer({ min: 1, max: 1000 }),
        assignee: fc.constantFrom("alice", "bob"),
        a: isoDateArb,
        b: isoDateArb,
      })
      .map(({ id, assignee, a, b }) => {
        const [startDate, endDate] = a <= b ? [a, b] : [b, a];
        return { id, assignee, startDate, endDate, type: "other" as const };
      });
    fc.assert(
      fc.property(fc.array(absenceArb, { maxLength: 8 }), (absences) => {
        const map = absenceDayMap(absences);
        for (const [key, days] of map) {
          const ranges = absences.filter((a) => a.assignee.trim().toLowerCase() === key);
          for (const day of days) {
            expect(ranges.some((r) => r.startDate <= day && day <= r.endDate)).toBe(true);
          }
        }
      }),
    );
  });
});
