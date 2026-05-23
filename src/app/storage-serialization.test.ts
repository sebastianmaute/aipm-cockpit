import { describe, test, expect } from "vitest";
import { migrateWorkspaceV5, emptyWorkspace } from "./storage";
import type { Task } from "./types";

function task(id: number, assignee: string): Task {
  return {
    id, taskName: `T${id}`, assignee, assigneeEmail: "",
    dueDate: "2026-01-10", lastUpdateDate: "2026-01-01",
    priority: "Medium", blockers: "", notes: "",
  };
}

describe("migrateWorkspaceV5", () => {
  test("seeds disciplines/grades/plan and backfills resources from assignees", () => {
    const ws = migrateWorkspaceV5({
      ...emptyWorkspace(),
      tasks: [task(1, "Alex Example"), task(2, "Bob Lee")],
    });
    expect(ws.disciplines.map((d) => d.name)).toContain("Developer");
    expect(ws.grades.map((g) => g.name)).toContain("Principal");
    expect(ws.plan.granularity).toBe("month");
    expect(ws.resources).toHaveLength(2);
    expect(ws.tasks[0].resourceId).toBe(ws.resources.find((r) => r.name === "Alex Example")?.id);
  });

  test("is idempotent: existing resources are not rebuilt", () => {
    const seeded = migrateWorkspaceV5({ ...emptyWorkspace(), tasks: [task(1, "Alex Example")] });
    const again = migrateWorkspaceV5(seeded);
    expect(again.resources).toEqual(seeded.resources);
    expect(again.tasks[0].resourceId).toBe(seeded.tasks[0].resourceId);
  });
});
