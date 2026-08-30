import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  isTaskFinished,
  applyStatusChange,
  migrateTask,
  statusSortIndex,
  reconcileStatusFromDate,
  countSplitTaskPairs,
  statusActivityKind,
} from "./task-status";
import { TASK_STATUSES, type Task, type TaskStatus } from "./types";

const base = (over: Partial<Task> = {}): Task =>
  ({
    id: 1,
    taskName: "T",
    assignee: "",
    assigneeEmail: "",
    dueDate: "2026-06-01",
    lastUpdateDate: "2026-05-01",
    priority: "Medium",
    blockers: "",
    notes: "",
    status: "To Do",
    ...over,
  }) as Task;

describe("isTaskFinished", () => {
  it("is true for Done and Cancelled", () => {
    expect(isTaskFinished(base({ status: "Done" }))).toBe(true);
    expect(isTaskFinished(base({ status: "Cancelled" }))).toBe(true);
  });
  it("is false for the four open statuses", () => {
    for (const s of ["To Do", "In Progress", "On Hold", "In Review"] as const)
      expect(isTaskFinished(base({ status: s }))).toBe(false);
  });
});

describe("applyStatusChange", () => {
  it("stamps completedDate when moving to Done", () => {
    const out = applyStatusChange(base({ status: "In Progress" }), "Done", "2026-06-19");
    expect(out.status).toBe("Done");
    expect(out.completedDate).toBe("2026-06-19");
  });
  it("keeps an existing completedDate when already Done", () => {
    const out = applyStatusChange(base({ status: "Done", completedDate: "2026-01-01" }), "Done", "2026-06-19");
    expect(out.completedDate).toBe("2026-01-01");
  });
  it("clears completedDate when moving off Done", () => {
    const out = applyStatusChange(base({ status: "Done", completedDate: "2026-01-01" }), "In Progress", "2026-06-19");
    expect(out.completedDate).toBe("");
  });
  it("leaves completedDate empty for Cancelled", () => {
    const out = applyStatusChange(base({ status: "In Progress" }), "Cancelled", "2026-06-19");
    expect(out.completedDate).toBe("");
  });
  it("clears completedDate when moving from Done to Cancelled", () => {
    const out = applyStatusChange(base({ status: "Done", completedDate: "2026-01-01" }), "Cancelled", "2026-06-19");
    expect(out.status).toBe("Cancelled");
    expect(out.completedDate).toBe("");
  });
  it("returns a new object (immutable)", () => {
    const input = base({ status: "To Do" });
    const out = applyStatusChange(input, "In Progress", "2026-06-19");
    expect(out).not.toBe(input);
    expect(input.status).toBe("To Do");
  });
});

describe("migrateTask", () => {
  it("derives Done from a set completedDate when status is absent", () => {
    const raw = { ...base(), completedDate: "2026-01-01" } as Partial<Task>;
    delete (raw as Record<string, unknown>).status;
    expect(migrateTask(raw as Task).status).toBe("Done");
  });
  it("derives To Do when no completedDate and status absent", () => {
    const raw = { ...base() } as Partial<Task>;
    delete (raw as Record<string, unknown>).status;
    expect(migrateTask(raw as Task).status).toBe("To Do");
  });
  it("keeps a valid existing status", () => {
    expect(migrateTask(base({ status: "On Hold" })).status).toBe("On Hold");
  });
  it("falls back to To Do on an invalid status string", () => {
    expect(migrateTask(base({ status: "garbage" as unknown as Task["status"] })).status).toBe("To Do");
  });
});

describe("statusSortIndex", () => {
  it("orders by TASK_STATUSES position", () => {
    expect(statusSortIndex("To Do")).toBeLessThan(statusSortIndex("Done"));
    expect(statusSortIndex("Cancelled")).toBeLessThan(statusSortIndex("Done"));
  });
});

describe("migrateTask createdDate backfill", () => {
  const base: Task = {
    id: 1, taskName: "T", assignee: "", assigneeEmail: "",
    dueDate: "2026-03-01", lastUpdateDate: "2026-02-01",
    priority: "Medium", status: "To Do", blockers: "", description: "",
  };

  it("keeps an existing createdDate", () => {
    const out = migrateTask({ ...base, createdDate: "2026-01-15" });
    expect(out.createdDate).toBe("2026-01-15");
  });

  it("backfills from lastUpdateDate when absent", () => {
    const out = migrateTask(base);
    expect(out.createdDate).toBe("2026-02-01");
  });

  it("falls back to empty string when there is nothing to backfill from", () => {
    const out = migrateTask({ ...base, lastUpdateDate: "" });
    expect(out.createdDate).toBe("");
  });

  it("still migrates status (the original responsibility)", () => {
    const out = migrateTask({ ...base, status: "bogus" as TaskStatus, completedDate: "2026-02-02" });
    expect(out.status).toBe("Done");
    expect(out.createdDate).toBe("2026-02-01");
  });

  it("returns a new object and never mutates its input", () => {
    const input = { ...base };
    const out = migrateTask(input);
    expect(out).not.toBe(input);
    expect(input.createdDate).toBeUndefined();
  });

  it("returns the same reference when nothing needs migrating", () => {
    const input = { ...base, createdDate: "2026-01-15" };
    expect(migrateTask(input)).toBe(input);
  });
});

describe("reconcileStatusFromDate", () => {
  it("leaves a consistent Done row untouched", () => {
    const t = base({ status: "Done", completedDate: "2026-03-04" });
    expect(reconcileStatusFromDate(t)).toBe(t); // same reference — nothing changed
  });

  it("leaves a consistent open row untouched", () => {
    const t = base({ status: "In Progress" });
    expect(reconcileStatusFromDate(t)).toBe(t);
  });

  it("a date on a non-Done row forces Done and KEEPS the date", () => {
    const out = reconcileStatusFromDate(base({ status: "To Do", completedDate: "2026-03-04" }));
    expect(out.status).toBe("Done");
    expect(out.completedDate).toBe("2026-03-04");
  });

  it("Done with no date demotes to the default status and invents nothing", () => {
    const t = base({ status: "Done" });
    const out = reconcileStatusFromDate(t);
    expect(out.status).toBe("To Do");
    expect(out.completedDate).toBe(t.completedDate); // untouched, not merely falsy
  });

  it("treats an empty-string completedDate as absent, like isTaskDelivered does", () => {
    const out = reconcileStatusFromDate(base({ status: "Done", completedDate: "" }));
    expect(out.status).toBe("To Do");
  });

  it("clears a stray date on a Cancelled row — the STATUS wins, not the date", () => {
    // Cancelled is CLOSED but never DELIVERED (task-closed.ts), so promoting it
    // to Done would silently turn an explicit human decision into delivered
    // work. For this ONE status the date is the stray value, and it is cleared
    // to "" — the same blank applyStatusChange writes for every non-Done status.
    const t = base({ status: "Cancelled", completedDate: "2026-03-04" });
    const out = reconcileStatusFromDate(t);
    expect(out.status).toBe("Cancelled");
    expect(out.completedDate).toBe("");
    expect(t.completedDate).toBe("2026-03-04"); // argument not mutated
  });

  it("leaves an undated Cancelled row alone, BY REFERENCE", () => {
    // Guards against clearing outside the date branch: a Cancelled row that is
    // already consistent must not be churned into a fresh object.
    const t = base({ status: "Cancelled" });
    expect(reconcileStatusFromDate(t)).toBe(t);
  });

  it("does not mutate its argument", () => {
    const t = base({ status: "To Do", completedDate: "2026-03-04" });
    reconcileStatusFromDate(t);
    expect(t.status).toBe("To Do");
  });

  it("does not mutate its argument on the demotion branch either", () => {
    const t = base({ status: "Done" });
    reconcileStatusFromDate(t);
    expect(t.status).toBe("Done");
  });

  it("is idempotent", () => {
    for (const t of [
      base({ status: "To Do", completedDate: "2026-03-04" }),
      base({ status: "Done" }),
      base({ status: "Cancelled", completedDate: "2026-03-04" }),
    ]) {
      const once = reconcileStatusFromDate(t);
      expect(reconcileStatusFromDate(once)).toEqual(once);
    }
  });

  it("output always satisfies status===Done ⟺ completedDate set", () => {
    // ★ NOT fc.date(): it can emit an Invalid Date whose .toISOString() throws —
    //   green under vitest, red at runtime. Map an integer ms range instead.
    const isoDay = fc
      .integer({ min: 0, max: 4102444800000 }) // 1970-01-01 .. 2100-01-01
      .map((ms) => new Date(ms).toISOString().slice(0, 10));
    fc.assert(
      fc.property(
        fc.constantFrom(...TASK_STATUSES),
        fc.oneof(fc.constant(undefined), fc.constant(""), isoDay),
        (status, completedDate) => {
          const out = reconcileStatusFromDate(base({ status, completedDate }));
          expect(out.status === "Done").toBe(!!out.completedDate);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("countSplitTaskPairs", () => {
  // The invariant is `status === "Done"` <=> `completedDate` set. These four
  // rows are the complete truth table for that biconditional, and the fifth is
  // the Cancelled case reconcileStatusFromDate handles by clearing the DATE.
  const row = (over: Partial<Task>): Task =>
    ({
      id: 1,
      taskName: "t",
      status: "To Do",
      createdDate: "2026-01-01",
      lastUpdateDate: "2026-01-01",
      ...over,
    }) as Task;

  it("counts nothing when every pair is consistent", () => {
    const tasks = [
      row({ id: 1, status: "Done", completedDate: "2026-01-01" }),
      row({ id: 2, status: "In Progress", completedDate: undefined }),
      row({ id: 3, status: "To Do", completedDate: "" }),
    ];
    expect(countSplitTaskPairs(tasks)).toBe(0);
  });

  it("counts a Done row with no date", () => {
    expect(countSplitTaskPairs([row({ status: "Done", completedDate: undefined })])).toBe(1);
    expect(countSplitTaskPairs([row({ status: "Done", completedDate: "" })])).toBe(1);
  });

  it("counts a dated row that is not Done", () => {
    expect(countSplitTaskPairs([row({ status: "In Progress", completedDate: "2026-01-01" })])).toBe(1);
  });

  it("counts a Cancelled row carrying a stray date", () => {
    // reconcileStatusFromDate repairs this one by CLEARING the date (status
    // wins for Cancelled), but it is still a broken pair and must be counted.
    expect(countSplitTaskPairs([row({ status: "Cancelled", completedDate: "2026-01-01" })])).toBe(1);
  });

  it("counts a Cancelled row with no date as consistent", () => {
    expect(countSplitTaskPairs([row({ status: "Cancelled", completedDate: undefined })])).toBe(0);
  });

  it("sums across a mixed list and returns 0 for an empty one", () => {
    const tasks = [
      row({ id: 1, status: "Done", completedDate: "2026-01-01" }),
      row({ id: 2, status: "Done", completedDate: undefined }),
      row({ id: 3, status: "To Do", completedDate: "2026-02-02" }),
    ];
    expect(countSplitTaskPairs(tasks)).toBe(2);
    expect(countSplitTaskPairs([])).toBe(0);
  });
});

describe("statusActivityKind", () => {
  const t = (status: TaskStatus, completedDate?: string) =>
    ({ id: 1, taskName: "T", status, completedDate }) as unknown as Task;

  it("reports a completion when the task becomes delivered", () => {
    expect(statusActivityKind(t("In Progress"), t("Done", "2026-06-10"))).toBe("task.completed");
  });

  it("reports a reopening when the task stops being delivered", () => {
    expect(statusActivityKind(t("Done", "2026-06-10"), t("In Progress"))).toBe("task.reopened");
  });

  it("reports nothing when delivered-ness did not change", () => {
    expect(statusActivityKind(t("To Do"), t("In Progress"))).toBeNull();
  });

  it("treats a move to Cancelled as no transition", () => {
    // Cancelled is CLOSED but never DELIVERED. Using isTaskClosed here instead
    // of isTaskDelivered would report a completion for cancelled work — the
    // exact confusion task-closed.ts exists to prevent.
    //
    // Mutation-checked (swapping both isTaskDelivered calls for isTaskClosed):
    // this block fails, along with the next two below — the one mutant kills
    // all three at once (isTaskClosed treats Cancelled as equivalent to Done
    // on both sides of the comparison), so none of the three is pinned in
    // isolation by this mutant alone.
    expect(statusActivityKind(t("In Progress"), t("Cancelled"))).toBeNull();
  });

  it("treats a move OFF Cancelled as no transition either", () => {
    // Positive control for the block above: a single-direction guard would
    // satisfy one of these two and not the other. See the mutation note above.
    expect(statusActivityKind(t("Cancelled"), t("In Progress"))).toBeNull();
  });

  it("reports a completion when a Cancelled task is delivered instead", () => {
    // Also killed by the isTaskClosed mutant above: isTaskClosed(Cancelled)
    // and isTaskClosed(Done) are both true, so the mutant reads this as no
    // transition instead of a completion.
    expect(statusActivityKind(t("Cancelled"), t("Done", "2026-06-10"))).toBe("task.completed");
  });
});
