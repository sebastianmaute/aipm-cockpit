import { describe, expect, test } from "vitest";
import { bucketActivePeriods, allocationPlannedHours, computeBudgetReport } from "./budget-report";
import type { ResourcePlan, Resource, BudgetBucket, Role } from "./types";

const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-03-31", granularity: "month", currency: "EUR" };
const noHolidays = new Set<string>();

function res(id: number, roleId: number, util: Record<string, number>): Resource {
  return { id, firstName: `R${id}`, lastName: "", roleId, utilizationMode: "percent", utilization: util };
}

describe("bucketActivePeriods", () => {
  test("intersects bucket [start,end] with plan periods", () => {
    const bucket = { startDate: "2026-02-01", endDate: "2026-02-28" } as BudgetBucket;
    const periods = bucketActivePeriods(bucket, plan);
    expect(periods.map((p) => p.key)).toEqual(["2026-02"]);
  });
});

describe("allocationPlannedHours", () => {
  test("sums capacity of the allocation's resources for a period at given util", () => {
    const resources = [res(5, 3, { "2026-01": 100 }), res(7, 3, { "2026-01": 50 })];
    const alloc = { roleId: 3, resourceIds: [5, 7], budgetHours: {}, actualHours: {} };
    const period = { key: "2026-01", start: "2026-01-01", end: "2026-01-31" };
    const hours = allocationPlannedHours(alloc, period, [period], resources, 8, noHolidays, "month");
    // Jan 2026 has 22 Mon–Fri workdays × 8h = 176h at 100%, +88h at 50%.
    expect(hours).toBeCloseTo(176 + 88, 5);
  });

  test("excludes external resources from planned hours", () => {
    const external: Resource = { ...res(9, 3, { "2026-01": 100 }), isExternal: true };
    const resources = [res(5, 3, { "2026-01": 100 }), external];
    const alloc = { roleId: 3, resourceIds: [5, 9], budgetHours: {}, actualHours: {} };
    const period = { key: "2026-01", start: "2026-01-01", end: "2026-01-31" };
    const hours = allocationPlannedHours(alloc, period, [period], resources, 8, noHolidays, "month");
    // Only the internal resource (5) contributes — external (9) is skipped.
    expect(hours).toBeCloseTo(176, 5);
  });
});

describe("computeBudgetReport — budget follows plan", () => {
  const roles: Role[] = [{ id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
  // Jan 2026 = 22 Mon–Fri workdays × 8h = 176h planned capacity at 100% util.
  const PLANNED_JAN = 176;
  // A resourced allocation whose STORED budget (0) is stale vs the plan.
  const resourcedStaleBucket: BudgetBucket = {
    id: 1, name: "PAM", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
    allocations: [{ roleId: 3, resourceIds: [5], budgetHours: { "2026-01": 0 }, actualHours: { "2026-01": 40 } }],
  };
  const resources = [res(5, 3, { "2026-01": 100 })];

  test("ON — a resourced row's budget hours equal the planned hours, not the stored 0", () => {
    const report = computeBudgetReport(
      [resourcedStaleBucket], { ...plan, budgetFollowsPlan: true }, roles, resources, 8, noHolidays,
    );
    const b = report.buckets[0];
    expect(b.budgetHours).toBeCloseTo(PLANNED_JAN, 5);
    // Derived budget value (external rate 150) follows the planned hours too.
    expect(b.budgetValue).toBeCloseTo(PLANNED_JAN * 150, 5);
    expect(report.project.budgetHours).toBeCloseTo(PLANNED_JAN, 5);
  });

  test("OFF — a resourced row uses the stored budget hours (unchanged behavior)", () => {
    const report = computeBudgetReport(
      [resourcedStaleBucket], { ...plan, budgetFollowsPlan: false }, roles, resources, 8, noHolidays,
    );
    expect(report.buckets[0].budgetHours).toBe(0);
  });

  test("ON — a resource-LESS row still uses its stored budget hours", () => {
    const unresourced: BudgetBucket = {
      ...resourcedStaleBucket,
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 40 } }],
    };
    const report = computeBudgetReport(
      [unresourced], { ...plan, budgetFollowsPlan: true }, roles, resources, 8, noHolidays,
    );
    expect(report.buckets[0].budgetHours).toBe(100);
  });
});

describe("computeBudgetReport — spillover", () => {
  test("removing a predecessor zeroes the successor's incoming spillover", () => {
    const roles = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
    const resources: Resource[] = [];

    const bucketA: BudgetBucket = {
      id: 1, name: "Bucket A", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31",
      status: "closed", closedDate: "2026-01-31",
      successorId: 2,
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 40 } }],
    };

    const bucketB: BudgetBucket = {
      id: 2, name: "Bucket B", type: "tm", currency: "EUR",
      startDate: "2026-02-01", endDate: "2026-03-31",
      status: "open",
      allocations: [],
    };

    // Sanity: with [A, B], B receives nonzero spillover from A.
    const reportWithA = computeBudgetReport([bucketA, bucketB], plan, roles, resources, 8, noHolidays);
    const bWithA = reportWithA.buckets.find((r) => r.bucketId === 2)!;
    expect(bWithA.spilloverInHours).toBeGreaterThan(0);
    expect(bWithA.spilloverInValue).toBeGreaterThan(0);

    // Simulate removal: A is gone; B's successorId link is nulled.
    const bucketBUnlinked: BudgetBucket = { ...bucketB, successorId: null };
    const reportWithoutA = computeBudgetReport([bucketBUnlinked], plan, roles, resources, 8, noHolidays);
    const bWithoutA = reportWithoutA.buckets.find((r) => r.bucketId === 2)!;
    expect(bWithoutA.spilloverInHours).toBe(0);
    expect(bWithoutA.spilloverInValue).toBe(0);
  });
});

describe("computeBudgetReport — order", () => {
  test("buckets come back sorted by their `order` field, not array position", () => {
    const roles = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
    const resources: Resource[] = [];

    const bucketA: BudgetBucket = {
      id: 10, name: "Bucket A", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      order: 1, allocations: [],
    };
    const bucketB: BudgetBucket = {
      id: 20, name: "Bucket B", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      order: 0, allocations: [],
    };

    // Array order is [A(order:1), B(order:0)] — report should be B then A.
    const report = computeBudgetReport([bucketA, bucketB], plan, roles, resources, 8, noHolidays);
    expect(report.buckets.map((r) => r.bucketId)).toEqual([20, 10]);
  });
});
