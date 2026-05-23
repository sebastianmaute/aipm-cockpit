import { describe, test, expect } from "vitest";
import {
  seedDisciplines,
  seedGrades,
  defaultResourcePlan,
  backfillResources,
} from "./resource-foundation";
import { PRESET_DISCIPLINES, PRESET_GRADES, type Task, type Absence } from "./types";

function task(id: number, assignee: string, email?: string): Task {
  return {
    id, taskName: `T${id}`, assignee, assigneeEmail: email ?? "",
    dueDate: "2026-01-10", lastUpdateDate: "2026-01-01",
    priority: "Medium", blockers: "", notes: "",
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
    const Sample = resources.find((r) => r.name === "Alex Example");
    expect(Sample?.email).toBe("Sample@x.io");
    expect(tasks[0].resourceId).toBe(Sample?.id);
    expect(tasks[1].resourceId).toBe(Sample?.id); // case-folded match
    expect(absences[0].resourceId).toBe(resources.find((r) => r.name === "Bob Lee")?.id);
  });

  test("ignores blank assignees and defaults role/mode", () => {
    const { resources, tasks } = backfillResources([task(1, "   ")], []);
    expect(resources).toHaveLength(0);
    expect(tasks[0].resourceId).toBeUndefined();
  });
});
