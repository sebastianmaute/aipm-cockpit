// src/app/visible-task-rows.test.ts
import { describe, expect, it } from "vitest";
import { visibleTaskRows } from "./visible-task-rows";
import { type Task } from "./types";

// The spread MUST come last: an earlier draft of this fixture only mentioned
// `over` in a type cast, so every override silently did nothing and the tests
// passed against broken code.
const task = (over: Partial<Task>): Task =>
  ({
    id: 1,
    taskName: "t",
    assignee: "a",
    assigneeEmail: "",
    priority: "Medium",
    status: "To Do",
    dueDate: "2026-09-01",
    lastUpdateDate: "2026-08-01",
    blockers: "",
    description: "",
    inquiriesSent: 0,
    ...over,
  }) as Task;

describe("visibleTaskRows", () => {
  const args = { today: "2026-08-03", holidaySet: new Set<string>() };

  it("keeps finished tasks when hideFinished is off", () => {
    const tasks = [task({ id: 1 }), task({ id: 2, status: "Done", completedDate: "2026-08-01" })];
    expect(visibleTaskRows(tasks, "all", false, args).map((t) => t.id)).toEqual([1, 2]);
  });

  it("drops finished tasks when hideFinished is on", () => {
    const tasks = [task({ id: 1 }), task({ id: 2, status: "Done", completedDate: "2026-08-01" })];
    expect(visibleTaskRows(tasks, "all", true, args).map((t) => t.id)).toEqual([1]);
  });

  it("drops a cancelled task when hideFinished is on", () => {
    const tasks = [task({ id: 1 }), task({ id: 3, status: "Cancelled" })];
    expect(visibleTaskRows(tasks, "all", true, args).map((t) => t.id)).toEqual([1]);
  });

  it("applies the health filter as well", () => {
    const tasks = [task({ id: 1, dueDate: "2020-01-01" }), task({ id: 2, dueDate: "2027-01-01" })];
    expect(visibleTaskRows(tasks, "red", false, args).map((t) => t.id)).toEqual([1]);
  });

  it("narrows by both filters at once", () => {
    // NOT an ordering test, and no fixture can make it one: both stages are
    // element-wise predicates, so their composition commutes. What it pins is
    // that BOTH actually run — and that needs a filter a FINISHED task can
    // survive. Under "red" none can (health.ts returns Green for Done AND
    // Cancelled before it ever looks at dueDate), so a red fixture exercises the
    // health filter alone and passes with hide-finished disconnected entirely.
    const tasks = [
      task({ id: 1 }), //                                            green + open → kept
      task({ id: 2, status: "Done", completedDate: "2026-08-01" }), // green, dropped by hide-finished
      task({ id: 3, dueDate: "2020-01-01" }), //                     red, dropped by the health filter
    ];
    expect(visibleTaskRows(tasks, "green", true, args).map((t) => t.id)).toEqual([1]);
  });
});
