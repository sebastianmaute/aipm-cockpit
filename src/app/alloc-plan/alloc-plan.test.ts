import { describe, expect, it } from "vitest";
import {
  ALLOC_CONTEXT_MAX_RESOURCES,
  ALLOC_TOOL_MAX_CELLS,
  MAX_ALLOC_CELLS,
  PROPOSE_ALLOCATIONS_TOOL,
  applyAllocationCells,
  availableCapacityHours,
  buildAllocContext,
  buildAllocSystemPrompt,
  buildAllocationsSnapshot,
  cellKey,
  formatAllocValue,
  groundAllocationCells,
  parseAllocationProposal,
  resourceLabel,
  type GroundedAllocCell,
} from "./alloc-plan";
import {
  type Absence,
  type Discipline,
  type Grade,
  type Resource,
  type ResourcePlan,
  type Role,
} from "../types";
import { periodCapacityHours } from "../resource-capacity";

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

// Drift guard: availableCapacityHours' absence-override precedence is meant to
// mirror periodCapacityHours EXACTLY (see the doc comment on the former). At
// 100% utilization, periodCapacityHours' percent-mode formula
// `(100/100) * max(0, possible - absence)` collapses to the same "gross minus
// absence" figure availableCapacityHours computes directly — so the two
// MUST agree here across all three absence branches. A future edit to either
// function's absence resolution that breaks that lockstep fails this test,
// not just a comment.
describe("availableCapacityHours vs periodCapacityHours (contract pin)", () => {
  const period = { key: "2026-08", start: "2026-08-01", end: "2026-08-31" };
  const fullyUtilized = (over: Partial<Resource> = {}) =>
    resource(1, { utilizationMode: "percent", utilization: { "2026-08": 100 }, ...over });

  it("agree with no absence", () => {
    const r = fullyUtilized();
    expect(availableCapacityHours(r, period, [], 8, new Set<string>())).toBe(
      periodCapacityHours(r, period, [], 8, new Set<string>()),
    );
  });

  it("agree with an absenceOverride set", () => {
    const r = fullyUtilized({ absenceOverride: { "2026-08": 20 } });
    expect(availableCapacityHours(r, period, [], 8, new Set<string>())).toBe(
      periodCapacityHours(r, period, [], 8, new Set<string>()),
    );
  });

  it("agree with computed absence days", () => {
    const r = fullyUtilized();
    const absences: Absence[] = [
      { id: 1, assignee: "Last1", startDate: "2026-08-01", endDate: "2026-08-15", type: "vacation", resourceId: 1 },
    ];
    expect(availableCapacityHours(r, period, absences, 8, new Set<string>())).toBe(
      periodCapacityHours(r, period, absences, 8, new Set<string>()),
    );
  });
});

describe("formatAllocValue", () => {
  it("formats a percent-mode value with a % suffix", () => {
    expect(formatAllocValue({ mode: "percent", value: 50 })).toBe("50%");
  });

  it("formats an hours-mode value with an h suffix", () => {
    expect(formatAllocValue({ mode: "hours", value: 84 })).toBe("84h");
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

    expect(parsed?.cells).toEqual([
      { resourceId: 1, periodKey: "2026-08", hours: 40 },
      { resourceId: 3, periodKey: "2026-09", hours: 12.5 },
    ]);
    expect(parsed?.truncated).toBe(false);
  });

  it("caps the number of cells it will parse AND reports truncated: true", () => {
    // THIS is where a too-large proposal actually gets cut in the real
    // Anthropic-tool-response path — groundAllocationCells's own cap never
    // sees the overflow, because it never receives more than this many cells.
    const cells = Array.from({ length: MAX_ALLOC_CELLS + 10 }, (_, i) => ({
      resourceId: 1,
      periodKey: `2026-${String((i % 12) + 1).padStart(2, "0")}`,
      hours: 1,
    }));

    const parsed = parseAllocationProposal({ cells });

    expect(parsed?.cells).toHaveLength(MAX_ALLOC_CELLS);
    expect(parsed?.truncated).toBe(true);
  });

  it("does not report truncated when the raw proposal fits under the cap", () => {
    const parsed = parseAllocationProposal({
      cells: [{ resourceId: 1, periodKey: "2026-08", hours: 10 }],
    });
    expect(parsed?.truncated).toBe(false);
  });

  it("does not report truncated when raw input lands exactly at the cap with nothing left over", () => {
    const cells = Array.from({ length: MAX_ALLOC_CELLS }, (_, i) => ({
      resourceId: 1,
      periodKey: `2026-${String((i % 12) + 1).padStart(2, "0")}`,
      hours: 1,
    }));

    const parsed = parseAllocationProposal({ cells });

    expect(parsed?.cells).toHaveLength(MAX_ALLOC_CELLS);
    expect(parsed?.truncated).toBe(false);
  });

  it("drops a non-object cell entry (falsy, and truthy-but-not-an-object)", () => {
    const parsed = parseAllocationProposal({
      cells: [null, 42, { resourceId: 9, periodKey: "2026-08", hours: 5 }],
    });

    expect(parsed?.cells).toEqual([{ resourceId: 9, periodKey: "2026-08", hours: 5 }]);
  });

  it("drops a cell whose resourceId is neither a number nor a string", () => {
    const parsed = parseAllocationProposal({
      cells: [
        { resourceId: null, periodKey: "2026-08", hours: 5 },
        { resourceId: 9, periodKey: "2026-08", hours: 5 },
      ],
    });

    expect(parsed?.cells).toEqual([{ resourceId: 9, periodKey: "2026-08", hours: 5 }]);
  });

  it("drops a cell whose hours is neither a finite number nor a numeric string", () => {
    const parsed = parseAllocationProposal({
      cells: [
        { resourceId: 9, periodKey: "2026-08", hours: null },
        { resourceId: 9, periodKey: "2026-09", hours: 5 },
      ],
    });

    expect(parsed?.cells).toEqual([{ resourceId: 9, periodKey: "2026-09", hours: 5 }]);
  });
});

describe("parseAllocationProposal -> groundAllocationCells (real production pipeline)", () => {
  it("surfaces truncation only when the caller ORs BOTH functions' flags — grounded.truncated alone misses a parse-level drop", () => {
    // A proposal 50 cells over the cap, one distinct resource per cell so
    // every cell that survives parsing grounds cleanly (nothing else gets
    // skipped, isolating the truncation signal).
    const overCap = MAX_ALLOC_CELLS + 50;
    const resources = Array.from({ length: overCap }, (_, i) =>
      resource(i + 1, { utilizationMode: "hours" }),
    );
    const raw = Array.from({ length: overCap }, (_, i) => ({
      resourceId: i + 1,
      periodKey: "2026-08",
      hours: 10,
    }));

    const parsed = parseAllocationProposal({ cells: raw });
    expect(parsed).not.toBeNull();
    const grounded = groundAllocationCells(parsed!.cells, groundCtx(resources));

    // parseAllocationProposal already cut 50 cells before grounding ever ran,
    // so grounding receives exactly MAX_ALLOC_CELLS cells and never hits its
    // OWN cap — grounded.truncated is false even though real cells were lost.
    expect(parsed!.cells).toHaveLength(MAX_ALLOC_CELLS);
    expect(parsed!.truncated).toBe(true);
    expect(grounded.truncated).toBe(false);

    // A caller reading only grounded.truncated would report "everything was
    // shown" while 50 cells were silently dropped. Only the OR is correct.
    expect(parsed!.truncated || grounded.truncated).toBe(true);
  });

  it("reports no truncation anywhere when a proposal fits comfortably under the cap", () => {
    const resources = [resource(1, { utilizationMode: "hours" })];
    const parsed = parseAllocationProposal({
      cells: [{ resourceId: 1, periodKey: "2026-08", hours: 10 }],
    });
    expect(parsed).not.toBeNull();
    const grounded = groundAllocationCells(parsed!.cells, groundCtx(resources));

    expect(parsed!.truncated).toBe(false);
    expect(grounded.truncated).toBe(false);
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

  it("silently drops a genuinely zero request against an already-zero value (hours mode)", () => {
    // The one exception to either skip reason: hours: 0 is a real no-op
    // (nothing was actually asked for), not a collapsed-away request.
    const r = groundAllocationCells(
      [{ resourceId: 1, periodKey: "2026-08", hours: 0 }],
      groundCtx([resource(1, { utilizationMode: "hours", utilization: {} })]),
    );
    expect(r.cells).toEqual([]);
    expect(r.skipped).toEqual([]);
  });

  it("silently drops a genuinely zero request against an already-zero value (percent mode)", () => {
    const r = groundAllocationCells(
      [{ resourceId: 1, periodKey: "2026-08", hours: 0 }],
      groundCtx([resource(1, { utilizationMode: "percent", utilization: {} })]),
    );
    expect(r.cells).toEqual([]);
    expect(r.skipped).toEqual([]);
  });

  it('reports an "already-set" skip (not below-resolution) when an hours-mode request exactly restates the current value', () => {
    // Not a rounding artifact here — hours mode has no division — this is a
    // ROUTINE, unambiguous restatement of the existing value (e.g. "make sure
    // Ada has 40h in August" when she already does), and must be labelled as
    // such rather than as a precision/resolution problem, which would be false.
    const r = groundAllocationCells(
      [{ resourceId: 1, periodKey: "2026-08", hours: 40 }],
      groundCtx([resource(1, { utilizationMode: "hours", utilization: { "2026-08": 40 } })]),
    );
    expect(r.cells).toEqual([]);
    expect(r.skipped).toEqual([{ resourceId: 1, periodKey: "2026-08", reason: "already-set" }]);
  });

  it("reports a below-resolution skip for a percent-mode request too small to move the rounded percentage off zero", () => {
    // The bug this closes: 0.4h against a 168h month rounds to 0%, and with
    // an already-zero stored value the old no-op guard dropped it with no
    // trace anywhere the user could see. This one IS a genuine precision
    // problem — the hours-to-percent conversion is what collapsed it — unlike
    // the hours-mode "already-set" case above.
    const r = groundAllocationCells(
      [{ resourceId: 1, periodKey: "2026-08", hours: 0.4 }],
      groundCtx([resource(1, { utilizationMode: "percent", utilization: {} })]),
    );
    expect(r.cells).toEqual([]);
    expect(r.skipped).toEqual([{ resourceId: 1, periodKey: "2026-08", reason: "below-resolution" }]);
  });

  it('reports a below-resolution skip for a percent-mode request that restates the current non-zero percentage', () => {
    // Even an "exact" percent-mode restatement is reported as below-resolution
    // (not already-set) — the model's hours figure went through a conversion
    // before it could be compared, so percent mode is ALWAYS the conversion
    // family, never the exact-restatement family (see the mode-based split
    // documented on groundAllocationCells).
    const r = groundAllocationCells(
      [{ resourceId: 1, periodKey: "2026-08", hours: 84 }],
      groundCtx([resource(1, { utilizationMode: "percent", utilization: { "2026-08": 50 } })]),
    );
    expect(r.cells).toEqual([]);
    expect(r.skipped).toEqual([{ resourceId: 1, periodKey: "2026-08", reason: "below-resolution" }]);
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

  it("[defense in depth] stops accumulating once MAX_ALLOC_CELLS accepted cells are reached, and reports truncated", () => {
    // This calls groundAllocationCells DIRECTLY with 220 raw cells — a state
    // parseAllocationProposal's own MAX_ALLOC_CELLS cap never lets through in
    // the real Anthropic-tool-response path (see the
    // "parseAllocationProposal -> groundAllocationCells" describe above for
    // the real production pipeline). This test exercises ONLY the
    // defense-in-depth branch documented on groundAllocationCells, for a
    // hypothetical caller that skips parseAllocationProposal.
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
    expect(r.truncated).toBe(true);
  });

  it("does not report truncated when every raw cell was processed (under the cap)", () => {
    const r = groundAllocationCells(
      [{ resourceId: 1, periodKey: "2026-08", hours: 10 }],
      groundCtx([resource(1, { utilizationMode: "hours" })]),
    );
    expect(r.truncated).toBe(false);
  });

  it("does not report truncated when raw input lands exactly at the cap with nothing left over", () => {
    const resources = Array.from({ length: MAX_ALLOC_CELLS }, (_, i) =>
      resource(i + 1, { utilizationMode: "hours" }),
    );
    const raw = Array.from({ length: MAX_ALLOC_CELLS }, (_, i) => ({
      resourceId: i + 1,
      periodKey: "2026-08",
      hours: 10,
    }));

    const r = groundAllocationCells(raw, groundCtx(resources));

    expect(r.cells).toHaveLength(MAX_ALLOC_CELLS);
    expect(r.truncated).toBe(false);
  });
});

function cell(over: Partial<GroundedAllocCell> = {}): GroundedAllocCell {
  return {
    resourceId: 1,
    resourceName: "Last1",
    periodKey: "2026-08",
    mode: "hours",
    currentValue: 10,
    nextValue: 40,
    hours: 40,
    capacityHours: 168,
    clamped: false,
    ...over,
  };
}

describe("applyAllocationCells", () => {
  it("writes only the named cells and leaves the rest of the map alone", () => {
    const before = [resource(1, { utilizationMode: "hours", utilization: { "2026-08": 10, "2026-09": 99 } })];

    const { nextResources } = applyAllocationCells(before, [cell()], "2026-07-25T00:00:00.000Z");

    expect(nextResources[0]?.utilization).toEqual({ "2026-08": 40, "2026-09": 99 });
  });

  it("leaves untouched resources byte-identical", () => {
    const other = resource(2, { utilizationMode: "hours", utilization: { "2026-08": 5 } });
    const before = [resource(1, { utilizationMode: "hours", utilization: {} }), other];

    const { nextResources } = applyAllocationCells(before, [cell()], "2026-07-25T00:00:00.000Z");

    expect(nextResources[1]).toBe(other); // same reference — dirty-table detection
  });

  it("returns the pre-edit images an undo entry needs", () => {
    const original = resource(1, { utilizationMode: "hours", utilization: { "2026-08": 10 } });

    const { editedBefore } = applyAllocationCells([original], [cell()], "2026-07-25T00:00:00.000Z");

    expect(editedBefore).toEqual([original]);
    expect(editedBefore[0]?.utilization["2026-08"]).toBe(10);
  });

  it("stamps localModifiedAt only on changed resources", () => {
    const before = [resource(1, { utilizationMode: "hours", utilization: {} })];

    const { nextResources } = applyAllocationCells(before, [cell()], "2026-07-25T00:00:00.000Z");

    expect(nextResources[0]?.localModifiedAt).toBe("2026-07-25T00:00:00.000Z");
  });

  it("applies several cells for one resource in a single pass", () => {
    const before = [resource(1, { utilizationMode: "hours", utilization: {} })];

    const { nextResources, editedBefore } = applyAllocationCells(
      before,
      [cell(), cell({ periodKey: "2026-09", nextValue: 20 })],
      "2026-07-25T00:00:00.000Z",
    );

    expect(nextResources[0]?.utilization).toEqual({ "2026-08": 40, "2026-09": 20 });
    expect(editedBefore).toHaveLength(1); // one entry per resource, not per cell
  });

  it("does not mutate the input array or its resources", () => {
    const original = resource(1, { utilizationMode: "hours", utilization: { "2026-08": 10 } });
    const before = [original];

    applyAllocationCells(before, [cell()], "2026-07-25T00:00:00.000Z");

    expect(original.utilization).toEqual({ "2026-08": 10 });
    expect(before).toHaveLength(1);
  });

  it("ignores a cell naming a resource that is not in the list", () => {
    const before = [resource(1, { utilizationMode: "hours", utilization: { "2026-08": 10 } })];

    const { nextResources, editedBefore } = applyAllocationCells(
      before,
      [cell({ resourceId: 99 })],
      "2026-07-25T00:00:00.000Z",
    );

    expect(nextResources).toHaveLength(1);
    expect(nextResources[0]).toBe(before[0]);
    expect(editedBefore).toEqual([]);
  });

  it("returns a resource by reference when its only cell already matches the stored value", () => {
    const original = resource(1, { utilizationMode: "hours", utilization: { "2026-08": 40 } });
    const before = [original];

    const { nextResources, editedBefore } = applyAllocationCells(before, [cell()], "2026-07-25T00:00:00.000Z");

    expect(nextResources[0]).toBe(original);
    expect(editedBefore).toEqual([]);
  });

  it("treats an absent period as already zero, so an explicit nextValue: 0 is a no-op", () => {
    const original = resource(1, { utilizationMode: "hours", utilization: {} });
    const before = [original];

    const { nextResources, editedBefore } = applyAllocationCells(
      before,
      [cell({ nextValue: 0 })],
      "2026-07-25T00:00:00.000Z",
    );

    expect(nextResources[0]).toBe(original);
    expect(editedBefore).toEqual([]);
    expect(nextResources[0]?.localModifiedAt).toBeUndefined();
  });

  it("writes an explicit nextValue of 0 into the map instead of deleting the key", () => {
    const before = [resource(1, { utilizationMode: "hours", utilization: { "2026-08": 40 } })];

    const { nextResources } = applyAllocationCells(before, [cell({ nextValue: 0 })], "2026-07-25T00:00:00.000Z");

    expect(nextResources[0]?.utilization).toEqual({ "2026-08": 0 });
    expect(Object.prototype.hasOwnProperty.call(nextResources[0]?.utilization ?? {}, "2026-08")).toBe(true);
  });
});

describe("buildAllocationsSnapshot", () => {
  it("reports the plan window, granularity, and period keys", () => {
    const snap = buildAllocationsSnapshot({
      resources: [resource(1)],
      plan,
      absences: [],
      workdayHours: 8,
      holidaySet: new Set<string>(),
    });

    expect(snap.planStartDate).toBe("2026-08-01");
    expect(snap.planEndDate).toBe("2026-09-30");
    expect(snap.granularity).toBe("month");
    expect(snap.periods).toEqual(["2026-08", "2026-09"]);
  });

  it("emits only non-zero cells, but still lists a resource with none", () => {
    const r = resource(1, { utilizationMode: "hours", utilization: {} });

    const snap = buildAllocationsSnapshot({
      resources: [r],
      plan,
      absences: [],
      workdayHours: 8,
      holidaySet: new Set<string>(),
    });

    expect(snap.resources).toHaveLength(1);
    expect(snap.resources[0]?.id).toBe(1);
    expect(snap.resources[0]?.cells).toEqual([]);
  });

  it("skips a zero-value period on a resource that also has a real cell elsewhere", () => {
    const r = resource(1, { utilizationMode: "hours", utilization: { "2026-08": 0, "2026-09": 10 } });

    const snap = buildAllocationsSnapshot({
      resources: [r],
      plan,
      absences: [],
      workdayHours: 8,
      holidaySet: new Set<string>(),
    });

    expect(snap.resources[0]?.cells).toEqual([
      { periodKey: "2026-09", value: 10, unit: "hours", hours: 10, capacityHours: 176 },
    ]);
  });

  // Regression: capacityHours/hours must come from availableCapacityHours, NOT
  // periodCapacityHours — the latter multiplies by the resource's own stored
  // utilization, so a 50%-allocated, otherwise-unallocated person would be
  // reported as 42/84 (capacityHours wrongly scaled down to 84) instead of the
  // real 84/168. capacityHours here must be the REAL, non-scaled-down 168.
  it("reports the hours a percent-mode cell stands for, against the REAL (non-zero) capacity", () => {
    const r = resource(1, { utilizationMode: "percent", utilization: { "2026-08": 50 } });

    const snap = buildAllocationsSnapshot({
      resources: [r],
      plan,
      absences: [],
      workdayHours: 8,
      holidaySet: new Set<string>(),
    });

    expect(snap.resources[0]?.cells).toEqual([
      { periodKey: "2026-08", value: 50, unit: "percent", hours: 84, capacityHours: 168 },
    ]);
  });

  it("passes an hours-mode cell's value straight through as hours", () => {
    const r = resource(1, { utilizationMode: "hours", utilization: { "2026-08": 40 } });

    const snap = buildAllocationsSnapshot({
      resources: [r],
      plan,
      absences: [],
      workdayHours: 8,
      holidaySet: new Set<string>(),
    });

    expect(snap.resources[0]?.cells).toEqual([
      { periodKey: "2026-08", value: 40, unit: "hours", hours: 40, capacityHours: 168 },
    ]);
  });

  it("does not flag truncated (top-level or per-resource) when every non-zero cell fits under the cap", () => {
    const r = resource(1, { utilizationMode: "hours", utilization: { "2026-08": 10 } });

    const snap = buildAllocationsSnapshot({
      resources: [r],
      plan,
      absences: [],
      workdayHours: 8,
      holidaySet: new Set<string>(),
    });

    expect(snap.truncated).toBe(false);
    expect(snap.resources[0]?.truncated).toBe(false);
  });

  it("reports truncated: false with empty cells for a genuinely idle resource", () => {
    const r = resource(1, { utilizationMode: "hours", utilization: {} });

    const snap = buildAllocationsSnapshot({
      resources: [r],
      plan,
      absences: [],
      workdayHours: 8,
      holidaySet: new Set<string>(),
    });

    expect(snap.resources[0]?.cells).toEqual([]);
    expect(snap.resources[0]?.truncated).toBe(false);
  });

  it("stops emitting cells once ALLOC_TOOL_MAX_CELLS is reached and flags truncated", () => {
    const resourceCount = Math.ceil((ALLOC_TOOL_MAX_CELLS + 20) / 2);
    const resources = Array.from({ length: resourceCount }, (_, i) =>
      resource(i + 1, { utilizationMode: "hours", utilization: { "2026-08": 10, "2026-09": 10 } }),
    );

    const snap = buildAllocationsSnapshot({
      resources,
      plan,
      absences: [],
      workdayHours: 8,
      holidaySet: new Set<string>(),
    });

    const totalCells = snap.resources.reduce((sum, r) => sum + r.cells.length, 0);
    expect(totalCells).toBe(ALLOC_TOOL_MAX_CELLS);
    expect(snap.truncated).toBe(true);
    // every resource is still listed even though some of its cells were dropped
    expect(snap.resources).toHaveLength(resourceCount);
  });

  // Exact-boundary regression: sitting right AT the cap (nothing omitted) must
  // not flip truncated — a `>` vs `>=` slip, or an increment-before-check
  // slip, would only show up exactly here (the earlier tests sit either side
  // of the boundary and would not catch it).
  it("does not flag truncated when exactly ALLOC_TOOL_MAX_CELLS non-zero cells are emitted", () => {
    const resources = Array.from({ length: ALLOC_TOOL_MAX_CELLS }, (_, i) =>
      resource(i + 1, { utilizationMode: "hours", utilization: { "2026-08": 10 } }),
    );

    const snap = buildAllocationsSnapshot({
      resources,
      plan,
      absences: [],
      workdayHours: 8,
      holidaySet: new Set<string>(),
    });

    const totalCells = snap.resources.reduce((sum, r) => sum + r.cells.length, 0);
    expect(totalCells).toBe(ALLOC_TOOL_MAX_CELLS);
    expect(snap.truncated).toBe(false);
    expect(snap.resources.every((r) => !r.truncated)).toBe(true);
  });

  it("flags truncated: true with empty cells for a resource whose entire load was omitted by the cap", () => {
    // One resource beyond the exact boundary above: the cap fills exactly on
    // the first ALLOC_TOOL_MAX_CELLS resources (one cell each), so the very
    // next resource's real, non-zero load is entirely dropped.
    const resources = Array.from({ length: ALLOC_TOOL_MAX_CELLS + 1 }, (_, i) =>
      resource(i + 1, { utilizationMode: "hours", utilization: { "2026-08": 10 } }),
    );

    const snap = buildAllocationsSnapshot({
      resources,
      plan,
      absences: [],
      workdayHours: 8,
      holidaySet: new Set<string>(),
    });

    const omitted = snap.resources[snap.resources.length - 1];
    expect(omitted?.cells).toEqual([]);
    expect(omitted?.truncated).toBe(true);
    expect(snap.truncated).toBe(true);
    // every earlier resource still kept its own real cell and is NOT flagged
    expect(snap.resources.slice(0, ALLOC_TOOL_MAX_CELLS).every((r) => r.cells.length === 1 && !r.truncated)).toBe(
      true,
    );
  });
});
