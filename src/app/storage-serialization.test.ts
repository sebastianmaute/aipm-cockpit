import { describe, test, expect } from "vitest";
import { migrateWorkspaceV5, migrateWorkspaceV6, emptyWorkspace, workspaceToCsv, csvToWorkspace, workspaceToMarkdown, markdownToWorkspace, workspaceToJson, jsonToWorkspace, sanitizeProjectStatus, type Workspace } from "./storage";
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
    const back = csvToWorkspace(workspaceToCsv(ws as unknown as Workspace)).resources[0];
    expect(back).toMatchObject({
      firstName: "Sample", lastName: "Dummy", title: "Architect", department: "IAM",
      company: "iC", birthday: "06-14", businessPhone: "+49 30 1", location: "Berlin",
      notes: "Note with, comma | pipe\nand newline",
    });
  });
  test("Markdown preserves all address-book fields", () => {
    const back = markdownToWorkspace(workspaceToMarkdown(ws as unknown as Workspace)).resources[0];
    expect(back).toMatchObject({ firstName: "Sample", lastName: "Dummy", birthday: "06-14" });
  });
  test("loads a legacy single-name CSV resource by splitting", () => {
    const legacy = "# RESOURCES\nid,name,email,roleId,utilizationMode,utilization,absenceOverride,active,localModifiedAt\n1,Sam Placeholder,m@x.com,,percent,,,,\n";
    const back = csvToWorkspace(legacy).resources.find((r) => r.id === 1);
    expect(back).toMatchObject({ firstName: "Fictional", lastName: "Jordan" });
  });
});

describe("task effort fields round-trip (estimate/time-spent)", () => {
  function effortWorkspace(): Workspace {
    const t: Task = {
      ...task(1, "Alex Example"),
      originalEstimateMinutes: 2400, // 1w
      timeSpentMinutes: 480, // 1d
    };
    return { ...emptyWorkspace(), tasks: [t] };
  }

  test("survive a JSON round-trip", () => {
    const back = jsonToWorkspace(workspaceToJson(effortWorkspace())).tasks[0];
    expect(back.originalEstimateMinutes).toBe(2400);
    expect(back.timeSpentMinutes).toBe(480);
  });

  test("survive a CSV round-trip", () => {
    const back = csvToWorkspace(workspaceToCsv(effortWorkspace())).tasks[0];
    expect(back.originalEstimateMinutes).toBe(2400);
    expect(back.timeSpentMinutes).toBe(480);
  });

  test("survive a Markdown round-trip", () => {
    const back = markdownToWorkspace(workspaceToMarkdown(effortWorkspace())).tasks[0];
    expect(back.originalEstimateMinutes).toBe(2400);
    expect(back.timeSpentMinutes).toBe(480);
  });

  test("absent effort fields stay undefined (empty cell !== 0)", () => {
    const ws = { ...emptyWorkspace(), tasks: [task(1, "Alex Example")] };
    const back = csvToWorkspace(workspaceToCsv(ws)).tasks[0];
    expect(back.originalEstimateMinutes).toBeUndefined();
    expect(back.timeSpentMinutes).toBeUndefined();
  });
});

describe("ProjectStatus defaults", () => {
  test("emptyWorkspace seeds an empty status object", () => {
    expect(emptyWorkspace().status).toEqual({});
  });

  test("migrateWorkspaceV6 backfills a missing status to {}", () => {
    const ws = { ...emptyWorkspace() };
    delete (ws as { status?: unknown }).status;
    expect(migrateWorkspaceV6(ws as typeof ws & { status?: never }).status).toEqual({});
  });
});

test("JSON round-trip preserves project status", () => {
  const ws = {
    ...emptyWorkspace(),
    status: { ragOverride: "A" as const, narrative: "On track, one risk to watch.", narrativeUpdatedAt: "2026-06-02T10:00:00.000Z" },
  };
  const back = jsonToWorkspace(workspaceToJson(ws));
  expect(back.status).toEqual(ws.status);
});

test("sanitizeProjectStatus rejects malformed input and whitelists known fields", () => {
  expect(sanitizeProjectStatus(null)).toEqual({});
  expect(sanitizeProjectStatus(42)).toEqual({});
  expect(sanitizeProjectStatus(["R"])).toEqual({});
  expect(sanitizeProjectStatus({ ragOverride: "X", junk: 1 })).toEqual({});
  expect(sanitizeProjectStatus({ narrative: 5 })).toEqual({});
  expect(sanitizeProjectStatus({ ragOverride: "G", narrative: "ok" })).toEqual({ ragOverride: "G", narrative: "ok" });
});

test("CSV round-trip preserves project status", () => {
  const ws = {
    ...emptyWorkspace(),
    status: { ragOverride: "R" as const, scopeOverride: "A" as const, narrative: "Scope creep, see note: \"phase 2\".", narrativeUpdatedAt: "2026-06-02T10:00:00.000Z" },
  };
  const back = csvToWorkspace(workspaceToCsv(ws));
  expect(back.status).toEqual(ws.status);
});
