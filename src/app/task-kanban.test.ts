import { describe, expect, it } from "vitest";
import { groupByStatus } from "./task-kanban";
import { TASK_STATUSES, type Task } from "./types";

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
