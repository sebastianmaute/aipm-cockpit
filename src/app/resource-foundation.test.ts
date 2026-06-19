import { describe, test, it, expect } from "vitest";
import {
  seedDisciplines,
  seedGrades,
  defaultResourcePlan,
  backfillResources,
  nextId,
  findRoleByCombo,
  roleLabel,
  splitName,
  resourceDisplayName,
} from "./resource-foundation";
import { PRESET_DISCIPLINES, PRESET_GRADES, type Task, type Absence, type Role, type Discipline, type Grade } from "./types";

function task(id: number, assignee: string, email?: string): Task {
  return {
    id, taskName: `T${id}`, assignee, assigneeEmail: email ?? "",
    dueDate: "2026-01-10", lastUpdateDate: "2026-01-01",
    status: "To Do", priority: "Medium", blockers: "", notes: "",
  };
}
function absence(id: number, assignee: string): Absence {
  return { id, assignee, startDate: "2026-01-05", endDate: "2026-01-06", type: "vacation" };
}

describe("seedDisciplines / seedGrades", () => {
  test("seed presets with 1-based ids", () => {
    const d = seedDisciplines();
    expect(d.map((x) => x.name)).toEqual([...PRESET_DISCIPLINES]);
    expect(d[0].id).toBe(1);
    expect(seedGrades().map((x) => x.name)).toEqual([...PRESET_GRADES]);
  });
});

describe("defaultResourcePlan", () => {
  test("spans the current month plus 11 months, monthly, EUR", () => {
    const plan = defaultResourcePlan("2026-05-23");
    expect(plan.startDate).toBe("2026-05-01");
    expect(plan.endDate).toBe("2027-04-30");
    expect(plan.granularity).toBe("month");
    expect(plan.currency).toBe("EUR");
  });
});

describe("backfillResources", () => {
  test("creates one resource per case-folded assignee and stamps resourceId", () => {
    const { resources, tasks, absences } = backfillResources(
      [task(1, "Alex Example", "Sample@x.io"), task(2, "Alex Example")],
      [absence(9, "Bob Lee")],
    );
    expect(resources).toHaveLength(2);
    const Sample = resources.find((r) => resourceDisplayName(r) === "Alex Example");
    expect(Sample?.email).toBe("Sample@x.io");
    expect(tasks[0].resourceId).toBe(Sample?.id);
    expect(tasks[1].resourceId).toBe(Sample?.id); // case-folded match
    expect(absences[0].resourceId).toBe(resources.find((r) => resourceDisplayName(r) === "Bob Lee")?.id);
  });

  test("ignores blank assignees and defaults role/mode", () => {
    const { resources, tasks } = backfillResources([task(1, "   ")], []);
    expect(resources).toHaveLength(0);
    expect(tasks[0].resourceId).toBeUndefined();
  });
});

describe("nextId", () => {
  test("returns 1 for empty, max+1 otherwise", () => {
    expect(nextId([])).toBe(1);
    expect(nextId([{ id: 3 }, { id: 7 }, { id: 5 }])).toBe(8);
  });
});

describe("findRoleByCombo", () => {
  const roles: Role[] = [{ id: 1, disciplineId: 2, gradeId: 3, internalRate: 0, externalRate: 0 }];
  test("matches on discipline+grade", () => {
    expect(findRoleByCombo(roles, 2, 3)?.id).toBe(1);
    expect(findRoleByCombo(roles, 2, 4)).toBeUndefined();
  });
});

describe("roleLabel", () => {
  const disciplines: Discipline[] = [{ id: 2, name: "Developer" }];
  const grades: Grade[] = [{ id: 3, name: "Senior" }];
  test("formats discipline + grade; empty for null role", () => {
    const role: Role = { id: 1, disciplineId: 2, gradeId: 3, internalRate: 0, externalRate: 0 };
    expect(roleLabel(role, disciplines, grades)).toBe("Developer Senior");
    expect(roleLabel(undefined, disciplines, grades)).toBe("");
  });
  it("renders an unresolved/sentinel dimension as n/a", () => {
    const role = { id: 5, disciplineId: 0, gradeId: 2, internalRate: 0, externalRate: 0 };
    expect(roleLabel(role as never, [], [{ id: 2, name: "Senior" }])).toBe("n/a Senior");
  });
});

describe("splitName", () => {
  test("splits on the first space", () => {
    expect(splitName("Alex Example")).toEqual({ firstName: "Sample", lastName: "Dummy" });
  });
  test("keeps multi-word surnames together", () => {
    expect(splitName("Sample Anne Dummy")).toEqual({ firstName: "Sample", lastName: "Anne Dummy" });
  });
  test("handles a single token", () => {
    expect(splitName("Madonna")).toEqual({ firstName: "Madonna", lastName: "" });
  });
  test("collapses and trims whitespace", () => {
    expect(splitName("  Sample   Dummy  ")).toEqual({ firstName: "Sample", lastName: "Dummy" });
  });
  test("returns empty parts for empty input", () => {
    expect(splitName("")).toEqual({ firstName: "", lastName: "" });
  });
});

describe("resourceDisplayName", () => {
  test("joins first and last", () => {
    expect(resourceDisplayName({ firstName: "Sample", lastName: "Dummy" })).toBe("Alex Example");
  });
  test("omits the trailing space when last name is empty", () => {
    expect(resourceDisplayName({ firstName: "Madonna", lastName: "" })).toBe("Madonna");
  });
});
