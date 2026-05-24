import { describe, test, expect } from "vitest";
import { migrateWorkspaceV5, emptyWorkspace, workspaceToCsv, csvToWorkspace, workspaceToMarkdown, markdownToWorkspace } from "./storage";
import type { Task, Resource, Role, Discipline, Grade } from "./types";
import { resourceDisplayName } from "./resource-foundation";

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
    expect(ws.tasks[0].resourceId).toBe(ws.resources.find((r) => resourceDisplayName(r) === "Alex Example")?.id);
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
    { id: 1, firstName: "Sample", lastName: "Dummy", email: "Sample@x.io", roleId: 1, utilizationMode: "percent",
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

describe("resource address-book round-trip", () => {
  const ws = {
    tasks: [], raid: [], absences: [], shifts: [], roles: [], disciplines: [], grades: [],
    plan: { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month" as const, currency: "EUR" },
    resources: [{
      id: 1, firstName: "Sample", lastName: "Dummy", email: "Sample@x.com",
      title: "Architect", businessPhone: "+49 30 1", location: "Berlin",
      department: "IAM", company: "iC", birthday: "06-14",
      notes: "Note with, comma | pipe\nand newline", roleId: null,
      utilizationMode: "percent" as const, utilization: {},
    }],
  };
  test("CSV preserves all address-book fields incl. tricky notes", () => {
    const back = csvToWorkspace(workspaceToCsv(ws as any)).resources[0];
    expect(back).toMatchObject({
      firstName: "Sample", lastName: "Dummy", title: "Architect", department: "IAM",
      company: "iC", birthday: "06-14", businessPhone: "+49 30 1", location: "Berlin",
      notes: "Note with, comma | pipe\nand newline",
    });
  });
  test("Markdown preserves all address-book fields", () => {
    const back = markdownToWorkspace(workspaceToMarkdown(ws as any)).resources[0];
    expect(back).toMatchObject({ firstName: "Sample", lastName: "Dummy", birthday: "06-14" });
  });
  test("loads a legacy single-name CSV resource by splitting", () => {
    const legacy = "# RESOURCES\nid,name,email,roleId,utilizationMode,utilization,absenceOverride,active,localModifiedAt\n1,Sam Placeholder,m@x.com,,percent,,,,\n";
    const back = csvToWorkspace(legacy).resources.find((r) => r.id === 1);
    expect(back).toMatchObject({ firstName: "Fictional", lastName: "Jordan" });
  });
});
