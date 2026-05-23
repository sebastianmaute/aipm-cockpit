import { describe, test, expect } from "vitest";
import { migrateWorkspaceV5, emptyWorkspace, workspaceToCsv, csvToWorkspace, workspaceToMarkdown, markdownToWorkspace } from "./storage";
import type { Task, Resource, Role, Discipline, Grade } from "./types";

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

function sampleWorkspace() {
  const disciplines: Discipline[] = [{ id: 1, name: "Developer" }];
  const grades: Grade[] = [{ id: 1, name: "Senior" }];
  const roles: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 90, externalRate: 180 }];
  const resources: Resource[] = [
    { id: 1, name: "Alex Example", email: "Sample@x.io", roleId: 1, utilizationMode: "percent",
      utilization: { "2026-01": 80, "2026-02": 100 }, absenceOverride: { "2026-01": 8 } },
  ];
  return {
    ...emptyWorkspace(), resources, roles, disciplines, grades,
    plan: { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month" as const, currency: "USD" },
  };
}

describe("CSV round-trip (new entities)", () => {
  test("preserves resources/roles/disciplines/grades/plan", () => {
    const ws = sampleWorkspace();
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.resources).toEqual(ws.resources);
    expect(back.roles).toEqual(ws.roles);
    expect(back.disciplines).toEqual(ws.disciplines);
    expect(back.grades).toEqual(ws.grades);
    expect(back.plan).toEqual(ws.plan);
  });
});

describe("Markdown round-trip (new entities)", () => {
  test("preserves resources/roles/plan", () => {
    const ws = sampleWorkspace();
    const back = markdownToWorkspace(workspaceToMarkdown(ws));
    expect(back.resources).toEqual(ws.resources);
    expect(back.roles).toEqual(ws.roles);
    expect(back.plan).toEqual(ws.plan);
  });
});
