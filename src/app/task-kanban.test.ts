import { describe, expect, it } from "vitest";
import { groupByStatus, groupByStatusAndPerson, laneResourceIds, UNASSIGNED_LANE } from "./task-kanban";
import { TASK_STATUSES, type Resource, type Task } from "./types";

const t = (id: number, status: Task["status"]): Task =>
  ({ id, taskName: "T" + id, assignee: "", assigneeEmail: "", dueDate: "2026-06-01",
     lastUpdateDate: "2026-05-01", priority: "Medium", blockers: "", description: "", status }) as Task;

describe("groupByStatus", () => {
  it("returns a bucket for every status, empty ones included", () => {
    const g = groupByStatus([]);
    for (const s of TASK_STATUSES) expect(g[s]).toEqual([]);
  });
  it("partitions tasks into their status bucket, order preserved", () => {
    const g = groupByStatus([t(1, "To Do"), t(2, "Done"), t(3, "To Do")]);
    expect(g["To Do"].map((x) => x.id)).toEqual([1, 3]);
    expect(g["Done"].map((x) => x.id)).toEqual([2]);
    expect(g["In Progress"]).toEqual([]);
  });
});

const task = (over: Partial<Task>): Task => ({
  id: 1, taskName: "T", assignee: "", assigneeEmail: "",
  dueDate: "2026-03-01", lastUpdateDate: "2026-02-01",
  priority: "Medium", status: "To Do", blockers: "", description: "",
  ...over,
});

const resources = new Map<number, Resource>([
  [1, { id: 1, firstName: "Anna", lastName: "Jordan" } as Resource],
  [2, { id: 2, firstName: "Bo", lastName: "Klein" } as Resource],
]);

describe("groupByStatusAndPerson", () => {
  it("lanes sort by display name with Unassigned last", () => {
    const out = groupByStatusAndPerson(
      [task({ id: 1, resourceId: 2 }), task({ id: 2 }), task({ id: 3, resourceId: 1 })],
      resources,
      [],
    );
    expect(out.lanes.map((l) => l.label)).toEqual(["Anna Jordan", "Bo Klein", ""]);
    expect(out.lanes.at(-1)!.key).toBe(UNASSIGNED_LANE);
  });

  it("a linked lane uses the resource's LIVE name, not the cached assignee string", () => {
    const out = groupByStatusAndPerson([task({ resourceId: 1, assignee: "Old Name" })], resources, []);
    expect(out.lanes[0].label).toBe("Anna Jordan");
  });

  it("a free-string assignee gets its own lane keyed by the string", () => {
    const out = groupByStatusAndPerson([task({ assignee: "Contractor X" })], resources, []);
    expect(out.lanes[0].key).toBe("name:Contractor X");
    expect(out.lanes[0].resourceId).toBeNull();
  });

  it("extra lane ids appear even with no tasks", () => {
    const out = groupByStatusAndPerson([task({ resourceId: 1 })], resources, [2]);
    expect(out.lanes.map((l) => l.label)).toEqual(["Anna Jordan", "Bo Klein", ""]);
    expect(out.cells["res:2"]["To Do"]).toEqual([]);
  });

  it("an extra lane id already present is not duplicated", () => {
    const out = groupByStatusAndPerson([task({ resourceId: 1 })], resources, [1]);
    expect(out.lanes.filter((l) => l.key === "res:1")).toHaveLength(1);
  });

  it("every lane has a bucket for every status", () => {
    const out = groupByStatusAndPerson([task({ resourceId: 1, status: "Done" })], resources, []);
    expect(Object.keys(out.cells["res:1"]).sort()).toEqual([...TASK_STATUSES].sort());
  });

  it("an extra lane id that does not resolve to a live resource is ignored", () => {
    const out = groupByStatusAndPerson([task({ resourceId: 1 })], resources, [999]);
    expect(out.lanes.some((l) => l.key === "res:999")).toBe(false);
    expect(out.cells["res:999"]).toBeUndefined();
  });

  it("a task with a dangling resourceId falls back to its assignee string", () => {
    const out = groupByStatusAndPerson([task({ resourceId: 99, assignee: "Ghost" })], resources, []);
    expect(out.lanes[0].key).toBe("name:Ghost");
    expect(out.lanes[0].resourceId).toBeNull();
  });

  it("a task with a dangling resourceId and no assignee string lands in Unassigned", () => {
    const out = groupByStatusAndPerson([task({ resourceId: 99 })], resources, []);
    expect(out.cells[UNASSIGNED_LANE]["To Do"].map((x) => x.id)).toEqual([1]);
  });
});

describe("laneResourceIds", () => {
  it("includes a resource that owns a task", () => {
    expect(laneResourceIds([task({ resourceId: 1 })], [])).toEqual([1]);
  });

  it("includes an extra lane id with no owning task", () => {
    expect(laneResourceIds([], [2])).toEqual([2]);
  });

  it("dedupes a resource that is both a task owner and an extra lane id", () => {
    expect(laneResourceIds([task({ resourceId: 1 })], [1])).toEqual([1]);
  });

  it("a task with no resourceId contributes nothing", () => {
    expect(laneResourceIds([task({ resourceId: undefined })], [])).toEqual([]);
  });
});
