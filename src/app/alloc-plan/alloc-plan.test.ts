import { describe, expect, it } from "vitest";
import {
  ALLOC_CONTEXT_MAX_RESOURCES,
  MAX_ALLOC_CELLS,
  PROPOSE_ALLOCATIONS_TOOL,
  availableCapacityHours,
  buildAllocContext,
  buildAllocSystemPrompt,
  cellKey,
  groundAllocationCells,
  parseAllocationProposal,
  resourceLabel,
} from "./alloc-plan";
import {
  type Absence,
  type Discipline,
  type Grade,
  type Resource,
  type ResourcePlan,
  type Role,
} from "../types";

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

describe("resourceLabel", () => {
  it("falls back to the email when there is no name", () => {
    const r = resource(9, { firstName: "", lastName: "", email: "ada@example.com" });
    expect(resourceLabel(r)).toBe("ada@example.com");
  });

  it("falls back to #id when there is no name and no email", () => {
    const r = resource(9, { firstName: "", lastName: "" });
    expect(resourceLabel(r)).toBe("#9");
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

  it("truncates past ALLOC_CONTEXT_MAX_RESOURCES and reports how many were dropped", () => {
    const extra = 1;
    const resources = Array.from({ length: ALLOC_CONTEXT_MAX_RESOURCES + extra }, (_, i) => resource(i + 1));

    const text = buildAllocContext({
      resources, roles: [], disciplines: [], grades: [], plan,
      absences: [], workdayHours: 8, holidaySet: new Set<string>(),
    });

    expect(text).toContain(`…(${extra} more resources truncated)`);
  });

  it("falls back to '-' for a dangling roleId that matches no role", () => {
    const r = resource(20, { roleId: 42 });

    const text = buildAllocContext({
      resources: [r], roles: [], disciplines: [], grades: [], plan,
      absences: [], workdayHours: 8, holidaySet: new Set<string>(),
    });

    expect(text).toContain("role=- ::");
  });

  it("falls back to '-' when the role's discipline AND grade are both missing", () => {
    const roles: Role[] = [{ id: 8, disciplineId: 999, gradeId: 999, internalRate: 50, externalRate: 100 }];
    const r = resource(21, { roleId: 8 });

    const text = buildAllocContext({
      resources: [r], roles, disciplines: [], grades: [], plan,
      absences: [], workdayHours: 8, holidaySet: new Set<string>(),
    });

    expect(text).toContain("role=- ::");
  });

  it("renders a '?' placeholder for whichever half (discipline or grade) is missing", () => {
    const roles: Role[] = [
      { id: 6, disciplineId: 1, gradeId: 999, internalRate: 50, externalRate: 100 }, // grade missing
      { id: 7, disciplineId: 999, gradeId: 2, internalRate: 50, externalRate: 100 }, // discipline missing
    ];
    const disciplines: Discipline[] = [{ id: 1, name: "Design" }];
    const grades: Grade[] = [{ id: 2, name: "Senior" }];
    const gradeMissing = resource(22, { roleId: 6 });
    const disciplineMissing = resource(23, { roleId: 7 });

    const text = buildAllocContext({
      resources: [gradeMissing, disciplineMissing], roles, disciplines, grades, plan,
      absences: [], workdayHours: 8, holidaySet: new Set<string>(),
    });

    expect(text).toContain("role=Design / ? ::");
    expect(text).toContain("role=? / Senior ::");
  });

  it("marks an external resource in its digest line", () => {
    const r = resource(24, { isExternal: true });

    const text = buildAllocContext({
      resources: [r], roles: [], disciplines: [], grades: [], plan,
      absences: [], workdayHours: 8, holidaySet: new Set<string>(),
    });

    expect(text).toContain(" external ::");
  });

  it("reads current load straight from the stored value for an hours-mode resource", () => {
    const r = resource(25, { utilizationMode: "hours", utilization: { "2026-08": 20 } });

    const text = buildAllocContext({
      resources: [r], roles: [], disciplines: [], grades: [], plan,
      absences: [], workdayHours: 8, holidaySet: new Set<string>(),
    });

    expect(text).toContain("2026-08=20/");
  });

  // Regression: capacity must come from availableCapacityHours (workdays minus
  // absences, no utilization applied) — NOT periodCapacityHours, which
  // multiplies by the resource's OWN stored utilization and would report an
  // unallocated resource as having zero capacity.
  it("reports the real 168h August capacity for a percent-mode resource with no stored utilization yet", () => {
    const r = resource(30, { utilizationMode: "percent" }); // utilization: {}

    const text = buildAllocContext({
      resources: [r], roles: [], disciplines: [], grades: [], plan,
      absences: [], workdayHours: 8, holidaySet: new Set<string>(),
    });

    expect(text).toContain("2026-08=0/168");
  });

  it("derives current hours as stored% of the REAL capacity for a percent-mode resource", () => {
    const r = resource(31, { utilizationMode: "percent", utilization: { "2026-08": 50 } });

    const text = buildAllocContext({
      resources: [r], roles: [], disciplines: [], grades: [], plan,
      absences: [], workdayHours: 8, holidaySet: new Set<string>(),
    });

    expect(text).toContain("2026-08=84/168");
  });

  it("reports the same 168h capacity for an hours-mode resource regardless of its stored value", () => {
    const r = resource(32, { utilizationMode: "hours", utilization: { "2026-08": 40 } });

    const text = buildAllocContext({
      resources: [r], roles: [], disciplines: [], grades: [], plan,
      absences: [], workdayHours: 8, holidaySet: new Set<string>(),
    });

    expect(text).toContain("2026-08=40/168");
  });
});

describe("availableCapacityHours", () => {
  const period = { key: "2026-08", start: "2026-08-01", end: "2026-08-31" };

  it("returns the gross workday capacity when there is no absence", () => {
    const r = resource(1);
    expect(availableCapacityHours(r, period, [], 8, new Set<string>())).toBe(168);
  });

  it("returns 0 when a full-period absence consumes every workday", () => {
    const r = resource(1);
    const absences: Absence[] = [
      { id: 1, assignee: "Last1", startDate: "2026-08-01", endDate: "2026-08-31", type: "vacation", resourceId: 1 },
    ];
    expect(availableCapacityHours(r, period, absences, 8, new Set<string>())).toBe(0);
  });

  it("prefers an explicit absenceOverride over the computed absence-day figure", () => {
    const r = resource(1, { absenceOverride: { "2026-08": 20 } });
    const absences: Absence[] = [
      { id: 1, assignee: "Last1", startDate: "2026-08-01", endDate: "2026-08-31", type: "vacation", resourceId: 1 },
    ];
    // Without the override this would be 168 - 168 = 0; the override (20) wins.
    expect(availableCapacityHours(r, period, absences, 8, new Set<string>())).toBe(148);
  });
});

describe("buildAllocSystemPrompt", () => {
  it("returns a non-empty prompt mentioning the tool name", () => {
    const prompt = buildAllocSystemPrompt();
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain("propose_allocations");
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

  it("drops a non-object cell entry (falsy, and truthy-but-not-an-object)", () => {
    const parsed = parseAllocationProposal({
      cells: [null, 42, { resourceId: 9, periodKey: "2026-08", hours: 5 }],
    });

    expect(parsed).toEqual([{ resourceId: 9, periodKey: "2026-08", hours: 5 }]);
  });

  it("drops a cell whose resourceId is neither a number nor a string", () => {
    const parsed = parseAllocationProposal({
      cells: [
        { resourceId: null, periodKey: "2026-08", hours: 5 },
        { resourceId: 9, periodKey: "2026-08", hours: 5 },
      ],
    });

    expect(parsed).toEqual([{ resourceId: 9, periodKey: "2026-08", hours: 5 }]);
  });

  it("drops a cell whose hours is neither a finite number nor a numeric string", () => {
    const parsed = parseAllocationProposal({
      cells: [
        { resourceId: 9, periodKey: "2026-08", hours: null },
        { resourceId: 9, periodKey: "2026-09", hours: 5 },
      ],
    });

    expect(parsed).toEqual([{ resourceId: 9, periodKey: "2026-09", hours: 5 }]);
  });
});

const groundCtx = (
  resources: Resource[],
  over: Partial<Parameters<typeof groundAllocationCells>[1]> = {},
) => ({
  resources,
  plan,
  absences: [],
  workdayHours: 8,
  holidaySet: new Set<string>(),
  ...over,
});

describe("groundAllocationCells", () => {
  it("drops a cell whose resource does not exist", () => {
    const r = groundAllocationCells([{ resourceId: 99, periodKey: "2026-08", hours: 10 }], groundCtx([resource(1)]));
    expect(r.cells).toEqual([]);
    expect(r.skipped).toEqual([{ resourceId: 99, periodKey: "2026-08", reason: "unknown-resource" }]);
  });

  it("skips a period key outside the plan window", () => {
    const r = groundAllocationCells([{ resourceId: 1, periodKey: "2027-01", hours: 10 }], groundCtx([resource(1)]));
    expect(r.cells).toEqual([]);
    expect(r.skipped[0]?.reason).toBe("out-of-window");
  });

  it("skips a key at the wrong granularity", () => {
    const r = groundAllocationCells([{ resourceId: 1, periodKey: "2026-W32", hours: 10 }], groundCtx([resource(1)]));
    expect(r.cells).toEqual([]);
    expect(r.skipped[0]?.reason).toBe("out-of-window");
  });

  it("skips negative or non-finite hours", () => {
    const r = groundAllocationCells(
      [
        { resourceId: 1, periodKey: "2026-08", hours: -5 },
        { resourceId: 1, periodKey: "2026-09", hours: Number.NaN },
      ],
      groundCtx([resource(1)]),
    );
    expect(r.cells).toEqual([]);
    expect(r.skipped.every((s) => s.reason === "bad-hours")).toBe(true);
  });

  it("converts hours to a percentage of the period's capacity", () => {
    const r = groundAllocationCells(
      [{ resourceId: 1, periodKey: "2026-08", hours: 84 }],
      groundCtx([resource(1, { utilizationMode: "percent" })]),
    );
    expect(r.cells).toHaveLength(1);
    expect(r.cells[0]?.mode).toBe("percent");
    expect(r.cells[0]?.nextValue).toBe(50);
    expect(r.cells[0]?.capacityHours).toBe(168);
    expect(r.cells[0]?.clamped).toBe(false);
  });

  it("writes hours straight through for an hours-mode resource", () => {
    const r = groundAllocationCells(
      [{ resourceId: 1, periodKey: "2026-08", hours: 84 }],
      groundCtx([resource(1, { utilizationMode: "hours" })]),
    );
    expect(r.cells[0]?.nextValue).toBe(84);
  });

  it("clamps a percentage above 100 and flags it", () => {
    const r = groundAllocationCells(
      [{ resourceId: 1, periodKey: "2026-08", hours: 400 }],
      groundCtx([resource(1, { utilizationMode: "percent" })]),
    );
    expect(r.cells[0]?.nextValue).toBe(100);
    expect(r.cells[0]?.clamped).toBe(true);
  });

  it("clamps hours to the sanitizer's ceiling and flags it", () => {
    const r = groundAllocationCells(
      [{ resourceId: 1, periodKey: "2026-08", hours: 5000 }],
      groundCtx([resource(1, { utilizationMode: "hours" })]),
    );
    expect(r.cells[0]?.nextValue).toBe(1000);
    expect(r.cells[0]?.clamped).toBe(true);
  });

  it("skips a percent-mode cell with zero capacity instead of writing 0 or 100", () => {
    // A full-period absence leaves no capacity to express a percentage against.
    const absences: Absence[] = [
      {
        id: 1,
        assignee: "Last1",
        startDate: "2026-08-01",
        endDate: "2026-08-31",
        type: "vacation",
        resourceId: 1,
      },
    ];
    const r = groundAllocationCells(
      [{ resourceId: 1, periodKey: "2026-08", hours: 40 }],
      groundCtx([resource(1, { utilizationMode: "percent" })], { absences }),
    );
    expect(r.cells).toEqual([]);
    expect(r.skipped[0]?.reason).toBe("no-capacity");
  });

  it("keeps the first of two cells for the same resource and period", () => {
    const r = groundAllocationCells(
      [
        { resourceId: 1, periodKey: "2026-08", hours: 80 },
        { resourceId: 1, periodKey: "2026-08", hours: 20 },
      ],
      groundCtx([resource(1, { utilizationMode: "hours" })]),
    );
    expect(r.cells).toHaveLength(1);
    expect(r.cells[0]?.nextValue).toBe(80);
    expect(r.skipped[0]?.reason).toBe("duplicate");
  });

  it("omits a cell that would not change anything", () => {
    const r = groundAllocationCells(
      [{ resourceId: 1, periodKey: "2026-08", hours: 40 }],
      groundCtx([resource(1, { utilizationMode: "hours", utilization: { "2026-08": 40 } })]),
    );
    expect(r.cells).toEqual([]);
    expect(r.skipped).toEqual([]);
  });

  it("keeps an explicit zero, so a cell can be cleared", () => {
    const r = groundAllocationCells(
      [{ resourceId: 1, periodKey: "2026-08", hours: 0 }],
      groundCtx([resource(1, { utilizationMode: "hours", utilization: { "2026-08": 40 } })]),
    );
    expect(r.cells).toHaveLength(1);
    expect(r.cells[0]?.currentValue).toBe(40);
    expect(r.cells[0]?.nextValue).toBe(0);
  });

  it("builds a stable cell key", () => {
    expect(cellKey({ resourceId: 3, periodKey: "2026-08" })).toBe("3:2026-08");
  });

  it("stops accumulating once MAX_ALLOC_CELLS accepted cells are reached", () => {
    const resourceCount = Math.ceil((MAX_ALLOC_CELLS + 20) / 2);
    const resources = Array.from({ length: resourceCount }, (_, i) =>
      resource(i + 1, { utilizationMode: "hours" }),
    );
    const raw = Array.from({ length: MAX_ALLOC_CELLS + 20 }, (_, i) => ({
      resourceId: (i % resourceCount) + 1,
      periodKey: i < resourceCount ? "2026-08" : "2026-09",
      hours: 10,
    }));

    const r = groundAllocationCells(raw, groundCtx(resources));

    expect(r.cells).toHaveLength(MAX_ALLOC_CELLS);
    expect(r.skipped).toEqual([]);
  });
});
