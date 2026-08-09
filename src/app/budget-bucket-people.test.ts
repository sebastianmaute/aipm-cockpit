import { describe, it, expect } from "vitest";
import { buildBucketPeopleRows, type BucketPeopleResource } from "./budget-bucket-people";

const PERIODS = [{ key: "2026-01", start: "2026-01-01", end: "2026-01-31" }];

// ★ `Resource` carries firstName/lastName, NOT a `name` field — the row's `name`
//   is the derived display name. A one-word person keeps that word verbatim.
const resources: BucketPeopleResource[] = [
  { id: 1, firstName: "Zoe", lastName: "", roleId: 10 },
  { id: 2, firstName: "Adam", lastName: "", roleId: 10 },
  { id: 3, firstName: "Mia", lastName: "", roleId: 10 },
  { id: 4, firstName: "Other", lastName: "", roleId: 99 },
];

const cell = (byResource?: Record<number, { hours: number; billableHours: number }>) => ({
  hours: 0, billableHours: 0, byResource,
});

describe("buildBucketPeopleRows", () => {
  it("includes plan-line members first, alphabetically, then the rest alphabetically", () => {
    const rows = buildBucketPeopleRows({
      allocation: { roleId: 10, resourceIds: [1, 2] },
      resources,
      actualsByPeriod: { "2026-01": cell({ 3: { hours: 4, billableHours: 4 } }) },
      plannedByResourcePeriod: { 1: { "2026-01": 8 }, 2: { "2026-01": 8 } },
      periods: PERIODS,
    });
    expect(rows.map((r) => r.name)).toEqual(["Adam", "Zoe", "Mia"]);
    expect(rows.map((r) => r.hasPlanLine)).toEqual([true, true, false]);
  });

  it("excludes a booker whose role does not match the allocation", () => {
    const rows = buildBucketPeopleRows({
      allocation: { roleId: 10, resourceIds: [] },
      resources,
      actualsByPeriod: { "2026-01": cell({ 4: { hours: 9, billableHours: 9 } }) },
      plannedByResourcePeriod: {},
      periods: PERIODS,
    });
    // Role 99 has no line in this bucket — those hours stay in `unattributed`.
    expect(rows).toEqual([]);
  });

  it("ignores a breakdown id that resolves to no resource", () => {
    const rows = buildBucketPeopleRows({
      allocation: { roleId: 10, resourceIds: [] },
      resources,
      actualsByPeriod: { "2026-01": cell({ 999: { hours: 3, billableHours: 3 } }) },
      plannedByResourcePeriod: {},
      periods: PERIODS,
    });
    expect(rows).toEqual([]);
  });

  it("gives a no-plan-line member null planned for every period", () => {
    const rows = buildBucketPeopleRows({
      allocation: { roleId: 10, resourceIds: [] },
      resources,
      actualsByPeriod: { "2026-01": cell({ 3: { hours: 4, billableHours: 4 } }) },
      plannedByResourcePeriod: { 3: { "2026-01": 8 } },
      periods: PERIODS,
    });
    expect(rows[0].planned["2026-01"]).toBeNull();
    expect(rows[0].plannedTotal).toBeNull();
  });

  it("counts a plan-line member with no planned entry as 0, not null", () => {
    const rows = buildBucketPeopleRows({
      allocation: { roleId: 10, resourceIds: [1] },
      resources,
      actualsByPeriod: { "2026-01": cell({ 1: { hours: 4, billableHours: 4 } }) },
      plannedByResourcePeriod: {},
      periods: PERIODS,
    });
    expect(rows[0].planned["2026-01"]).toBe(0);
    expect(rows[0].plannedTotal).toBe(0);
  });

  // ★★ THE TRAP: a fixture with byResource present everywhere cannot tell
  //    `null` from `0`. This period deliberately has NO breakdown.
  // ★★ The role line these rows explain gets its budget from
  //    `allocationPlannedHours`, which SKIPS `isExternal` resources. Nothing
  //    stops an allocation naming one, so a planned figure here for an external
  //    would make the breakdown sum to MORE than the line above it under
  //    budget-follows-plan. The map deliberately CARRIES a figure for id 5 —
  //    otherwise the assertion would pass on a plain lookup miss and say nothing
  //    about the exclusion.
  it("gives an EXTERNAL plan-line member null planned, mirroring allocationPlannedHours", () => {
    const rows = buildBucketPeopleRows({
      allocation: { roleId: 10, resourceIds: [1, 5] },
      resources: [...resources, { id: 5, firstName: "Ext", lastName: "", roleId: 10, isExternal: true }],
      actualsByPeriod: { "2026-01": cell({ 5: { hours: 7, billableHours: 7 } }) },
      plannedByResourcePeriod: { 1: { "2026-01": 8 }, 5: { "2026-01": 8 } },
      periods: PERIODS,
    });
    const ext = rows.find((r) => r.resourceId === 5)!;
    // Still ON the plan line and still shows what they booked — only the budget
    // figure is withheld, because that is the only axis the role row excludes.
    expect(ext.hasPlanLine).toBe(true);
    expect(ext.bookedTotal).toBe(7);
    expect(ext.planned["2026-01"]).toBeNull();
    expect(ext.plannedTotal).toBeNull();
    // The INTERNAL member on the same line is untouched — proves the exclusion
    // is scoped to the external and did not simply blank the whole allocation.
    expect(rows.find((r) => r.resourceId === 1)!.plannedTotal).toBe(8);
  });

  it("yields NULL booked — never 0 — for a period whose cell has no byResource", () => {
    const rows = buildBucketPeopleRows({
      allocation: { roleId: 10, resourceIds: [1] },
      resources,
      actualsByPeriod: { "2026-01": cell(undefined) },
      plannedByResourcePeriod: { 1: { "2026-01": 8 } },
      periods: PERIODS,
    });
    expect(rows[0].booked["2026-01"]).toBeNull();
    expect(rows[0].booked["2026-01"]).not.toBe(0);
  });

  it("yields 0 — not null — when the breakdown exists but omits this person", () => {
    const rows = buildBucketPeopleRows({
      allocation: { roleId: 10, resourceIds: [1] },
      resources,
      actualsByPeriod: { "2026-01": cell({ 2: { hours: 5, billableHours: 5 } }) },
      plannedByResourcePeriod: { 1: { "2026-01": 8 } },
      periods: PERIODS,
    });
    expect(rows.find((r) => r.resourceId === 1)!.booked["2026-01"]).toBe(0);
  });

  it("sums totals across periods, skipping null cells", () => {
    const periods = [
      { key: "2026-01", start: "2026-01-01", end: "2026-01-31" },
      { key: "2026-02", start: "2026-02-01", end: "2026-02-28" },
    ];
    const rows = buildBucketPeopleRows({
      allocation: { roleId: 10, resourceIds: [1] },
      resources,
      actualsByPeriod: {
        "2026-01": cell({ 1: { hours: 6, billableHours: 6 } }),
        "2026-02": cell(undefined),
      },
      plannedByResourcePeriod: { 1: { "2026-01": 8, "2026-02": 8 } },
      periods,
    });
    expect(rows[0].bookedTotal).toBe(6);
    expect(rows[0].plannedTotal).toBe(16);
  });

  it("gives a NULL booked total when every period is unknown", () => {
    const rows = buildBucketPeopleRows({
      allocation: { roleId: 10, resourceIds: [1] },
      resources,
      actualsByPeriod: { "2026-01": cell(undefined) },
      plannedByResourcePeriod: { 1: { "2026-01": 8 } },
      periods: PERIODS,
    });
    // A total of 0 across all-unknown periods is the same fabricated zero the
    // per-cell null exists to prevent.
    expect(rows[0].bookedTotal).toBeNull();
  });

  it("returns an empty list when the bucket has neither members nor bookings", () => {
    expect(buildBucketPeopleRows({
      allocation: { roleId: 10, resourceIds: [] },
      resources,
      actualsByPeriod: {},
      plannedByResourcePeriod: {},
      periods: PERIODS,
    })).toEqual([]);
  });
});
