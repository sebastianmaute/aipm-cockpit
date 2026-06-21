import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { applyStatusChange, isTaskFinished, migrateTaskStatus, statusSortIndex } from "./task-status";
import { TASK_STATUSES, type Task, type TaskStatus } from "./types";

// Minimal Task builder — applyStatusChange / migrateTaskStatus / isTaskFinished
// only read `status` + `completedDate` and spread the rest, so a representative
// subset of fields is enough to exercise the invariants and field-preservation.
function mkTask(status: string, completedDate: string): Task {
  return {
    id: 1,
    taskName: "t",
    assignee: "a",
    priority: "Medium",
    dueDate: "2026-01-01",
    status,
    completedDate,
  } as unknown as Task;
}

const statusArb = fc.constantFrom(...TASK_STATUSES);
// Non-empty "today" — applyStatusChange to Done stamps `task.completedDate || today`,
// so a real (non-empty) today is required for the Done⟺completedDate invariant.
const todayArb = fc.integer({ min: Date.UTC(2000, 0, 1), max: Date.UTC(2100, 0, 1) })
  .map((ms) => new Date(ms).toISOString().slice(0, 10));

describe("task-status — properties", () => {
  test("applyStatusChange preserves the invariant status===Done ⟺ completedDate set", () => {
    fc.assert(
      fc.property(statusArb, statusArb, fc.boolean(), todayArb, (cur, next, hadCompleted, today) => {
        const task = mkTask(cur, hadCompleted ? "2025-06-01" : "");
        const out = applyStatusChange(task, next as TaskStatus, today);
        expect(out.status === "Done").toBe(Boolean(out.completedDate));
        expect(out.status).toBe(next);
      }),
    );
  });

  test("applyStatusChange keeps an existing completedDate when re-confirming Done", () => {
    fc.assert(
      fc.property(todayArb, todayArb, (existing, today) => {
        const out = applyStatusChange(mkTask("In Review", existing), "Done", today);
        expect(out.completedDate).toBe(existing || today);
      }),
    );
  });

  test("applyStatusChange touches only status + completedDate (all other fields preserved)", () => {
    fc.assert(
      fc.property(statusArb, todayArb, (next, today) => {
        const task = mkTask("To Do", "");
        const out = applyStatusChange(task, next as TaskStatus, today);
        expect(out.id).toBe(task.id);
        expect(out.taskName).toBe(task.taskName);
        expect(out.assignee).toBe(task.assignee);
        expect(out.priority).toBe(task.priority);
        expect(out.dueDate).toBe(task.dueDate);
      }),
    );
  });

  test("isTaskFinished is true exactly for Done and Cancelled", () => {
    fc.assert(
      fc.property(statusArb, (status) => {
        expect(isTaskFinished({ status })).toBe(status === "Done" || status === "Cancelled");
      }),
    );
  });

  test("migrateTaskStatus keeps any valid status and always yields a valid status", () => {
    fc.assert(
      fc.property(fc.string(), fc.boolean(), (rawStatus, hasCompleted) => {
        const task = mkTask(rawStatus, hasCompleted ? "2025-06-01" : "");
        const out = migrateTaskStatus(task);
        expect(TASK_STATUSES).toContain(out.status);
        // A status that was already valid is preserved verbatim.
        if ((TASK_STATUSES as string[]).includes(rawStatus)) {
          expect(out.status).toBe(rawStatus);
        } else {
          // Invalid/absent derives from completedDate: set ⇒ Done, else To Do.
          expect(out.status).toBe(hasCompleted ? "Done" : "To Do");
        }
      }),
    );
  });

  test("statusSortIndex orders known statuses by TASK_STATUSES and sends unknown to the end", () => {
    fc.assert(
      fc.property(statusArb, (status) => {
        expect(statusSortIndex(status)).toBe(TASK_STATUSES.indexOf(status));
      }),
    );
    fc.assert(
      fc.property(fc.string().filter((s) => !(TASK_STATUSES as string[]).includes(s)), (unknown) => {
        expect(statusSortIndex(unknown)).toBe(TASK_STATUSES.length);
      }),
    );
  });
});
