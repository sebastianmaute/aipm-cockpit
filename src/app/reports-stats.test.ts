import { describe, expect, test } from "vitest";
import { computeStats } from "./reports-stats";
import { type Resource, type Task } from "./types";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    taskName: "Task",
    assignee: "",
    assigneeEmail: "",
    dueDate: "2026-12-01",
    lastUpdateDate: "2026-05-18",
    status: "To Do",
    priority: "Medium",
    blockers: "",
    description: "",
    group: "",
    labels: [],
    dependencies: [],
    ...overrides,
  };
}

function makeResource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: 1,
    firstName: "First",
    lastName: "Last",
    roleId: null,
    utilizationMode: "percent",
    utilization: {},
    ...overrides,
  };
}

describe("computeStats by-assignee grouping", () => {
  const today = "2026-05-18";
  const holidaySet = new Set<string>();

  test("groups tasks sharing a resourceId under the live resource name (not their stale cache)", () => {
    // Two tasks both linked to resource #7 but each carries a DIFFERENT stale
    // cached assignee string (a rename left the caches out of sync). They must
    // collapse into ONE by-assignee row keyed by the resource's CURRENT name.
    const resources = new Map<number, Resource>([
      [7, makeResource({ id: 7, firstName: "Correct", lastName: "Name" })],
    ]);
    const tasks: Task[] = [
      makeTask({ id: 1, assignee: "Old Removed", resourceId: 7 }),
      makeTask({ id: 2, assignee: "Stale Alias", resourceId: 7 }),
    ];

    const stats = computeStats(tasks, today, holidaySet, resources);

    // ONE row, under the live name, covering both tasks.
    expect(stats.byAssignee).toHaveLength(1);
    expect(stats.byAssignee[0].name).toBe("Correct Name");
    expect(stats.byAssignee[0].total).toBe(2);
  });

  test("falls back to the cached assignee string when the task is unlinked", () => {
    const resources = new Map<number, Resource>();
    const tasks: Task[] = [makeTask({ id: 1, assignee: "Freetext Person" })];

    const stats = computeStats(tasks, today, holidaySet, resources);

    expect(stats.byAssignee).toHaveLength(1);
    expect(stats.byAssignee[0].name).toBe("Freetext Person");
  });
});

describe("cancelled bucket", () => {
  test("counts a cancelled task as neither open nor completed, and never overdue", () => {
    const tasks: Task[] = [
      makeTask({ id: 1, status: "Cancelled", dueDate: "2020-01-01", assignee: "Ada", group: "G" }),
      makeTask({ id: 2, status: "To Do", dueDate: "2020-01-01", assignee: "Ada", group: "G" }),
    ];

    const s = computeStats(tasks, "2026-08-03", new Set<string>(), new Map<number, Resource>());

    expect(s.total).toBe(2);
    expect(s.open).toBe(1);
    expect(s.completed).toBe(0);
    expect(s.cancelled).toBe(1);
    // Only the To Do task is overdue — a cancelled task is closed, so it is
    // never chased.
    expect(s.overdue).toBe(1);
    expect(s.byAssignee[0]).toMatchObject({ open: 1, completed: 0, cancelled: 1, overdue: 1 });
    expect(s.byGroup[0]).toMatchObject({ open: 1, completed: 0, cancelled: 1, overdue: 1 });
  });
});
