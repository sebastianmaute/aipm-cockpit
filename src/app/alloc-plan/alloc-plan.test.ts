import { describe, expect, it } from "vitest";
import {
  MAX_ALLOC_CELLS,
  PROPOSE_ALLOCATIONS_TOOL,
  buildAllocContext,
  parseAllocationProposal,
} from "./alloc-plan";
import { type Discipline, type Grade, type Resource, type ResourcePlan, type Role } from "../types";

const plan: ResourcePlan = {
  startDate: "2026-08-01",
  endDate: "2026-09-30",
  granularity: "month",
  currency: "EUR",
};

function resource(id: number, over: Partial<Resource> = {}): Resource {
  return {
    id,
    firstName: "First",
    lastName: `Last${id}`,
    roleId: null,
    utilizationMode: "percent",
    utilization: {},
    ...over,
  };
}

describe("PROPOSE_ALLOCATIONS_TOOL", () => {
  it("requires a cells array", () => {
    expect(PROPOSE_ALLOCATIONS_TOOL.name).toBe("propose_allocations");
    expect(PROPOSE_ALLOCATIONS_TOOL.input_schema.required).toContain("cells");
  });
});

describe("buildAllocContext", () => {
  it("lists each resource with its mode, role and per-period capacity", () => {
    const roles: Role[] = [{ id: 5, disciplineId: 1, gradeId: 2, internalRate: 50, externalRate: 100 }];
    const disciplines: Discipline[] = [{ id: 1, name: "Design" }];
    const grades: Grade[] = [{ id: 2, name: "Senior" }];
    const r = resource(3, { firstName: "Ada", lastName: "Lovelace", roleId: 5 });

    const text = buildAllocContext({
      resources: [r], roles, disciplines, grades, plan,
      absences: [], workdayHours: 8, holidaySet: new Set<string>(),
    });

    expect(text).toContain("#3 Ada Lovelace");
    expect(text).toContain("percent");
    expect(text).toContain("Design / Senior");
    expect(text).toContain("2026-08");
    expect(text).toContain("2026-09");
  });

  it("names the plan window and granularity so the model uses valid period keys", () => {
    const text = buildAllocContext({
      resources: [resource(1)], roles: [], disciplines: [], grades: [], plan,
      absences: [], workdayHours: 8, holidaySet: new Set<string>(),
    });

    expect(text).toContain("month");
    expect(text).toContain("2026-08-01");
    expect(text).toContain("2026-09-30");
  });
});

describe("parseAllocationProposal", () => {
  it("returns null when the shape is unusable", () => {
    expect(parseAllocationProposal(null)).toBeNull();
    expect(parseAllocationProposal({})).toBeNull();
    expect(parseAllocationProposal({ cells: "nope" })).toBeNull();
  });

  it("keeps well-formed cells and drops malformed ones without failing", () => {
    const parsed = parseAllocationProposal({
      cells: [
        { resourceId: 1, periodKey: "2026-08", hours: 40 },
        { resourceId: "nope", periodKey: "2026-08", hours: 10 },
        { resourceId: 2, periodKey: 7, hours: 10 },
        { resourceId: 3, periodKey: "2026-09", hours: "12.5" },
      ],
      rationale: "spread the design load",
    });

    expect(parsed).toEqual([
      { resourceId: 1, periodKey: "2026-08", hours: 40 },
      { resourceId: 3, periodKey: "2026-09", hours: 12.5 },
    ]);
  });

  it("caps the number of cells it will parse", () => {
    const cells = Array.from({ length: MAX_ALLOC_CELLS + 10 }, (_, i) => ({
      resourceId: 1,
      periodKey: `2026-${String((i % 12) + 1).padStart(2, "0")}`,
      hours: 1,
    }));

    expect(parseAllocationProposal({ cells })).toHaveLength(MAX_ALLOC_CELLS);
  });
});
