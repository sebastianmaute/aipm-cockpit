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

  test("reports budgetMirrorsPlan when follow-plan is on and every row is resourced", () => {
    const report = computeBudgetReport(
      [resourcedStaleBucket], { ...plan, budgetFollowsPlan: true }, roles, resources, 8, noHolidays,
    );
    expect(report.buckets[0].budgetMirrorsPlan).toBe(true);
  });

  test("does NOT report budgetMirrorsPlan when follow-plan is off", () => {
    const report = computeBudgetReport(
      [resourcedStaleBucket], { ...plan, budgetFollowsPlan: false }, roles, resources, 8, noHolidays,
    );
    expect(report.buckets[0].budgetMirrorsPlan).toBe(false);
  });

  test("does NOT report budgetMirrorsPlan when a row has no resources", () => {
    const mixed: BudgetBucket = {
      ...resourcedStaleBucket,
      allocations: [
        ...resourcedStaleBucket.allocations,
        { roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: {} },
      ],
    };
    const report = computeBudgetReport(
      [mixed], { ...plan, budgetFollowsPlan: true }, roles, resources, 8, noHolidays,
    );
    expect(report.buckets[0].budgetMirrorsPlan).toBe(false);
  });

  // The reported `budgetHours` is `budgetHours + spilloverInHours` while
  // `plannedHours` carries no spillover, so a follow-plan bucket that INHERITS
  // budget from a closed predecessor displays two genuinely different numbers.
  // Suppressing the badge there hides real information — the exact inverse of
  // the case the flag exists for.
  test("does NOT report budgetMirrorsPlan when spillover makes the two figures differ", () => {
    // Both buckets must sit INSIDE the plan window or they contribute no
    // periods and no spillover at all. Predecessor closes in Jan having burned
    // 40 of 100 h; the successor runs Feb and is follow-plan eligible.
    const predecessor: BudgetBucket = {
      id: 9, name: "Closed predecessor", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31",
      status: "closed", closedDate: "2026-01-31", successorId: 10,
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 40 } }],
    };
    const successorBucket: BudgetBucket = {
      id: 10, name: "Successor", type: "tm", currency: "EUR",
      startDate: "2026-02-01", endDate: "2026-02-28", status: "open",
      allocations: [{ roleId: 3, resourceIds: [7], budgetHours: { "2026-02": 0 }, actualHours: {} }],
    };
    const febResources = [res(7, 3, { "2026-02": 100 })];
    const report = computeBudgetReport(
      [predecessor, successorBucket], { ...plan, budgetFollowsPlan: true },
      roles, febResources, 8, noHolidays,
    );
    const successor = report.buckets.find((b) => b.bucketId === 10)!;
    // Guard the fixture itself: without real spillover this test proves nothing.
    expect(successor.spilloverInHours).toBeGreaterThan(0);
    expect(successor.budgetHours).not.toBe(successor.plannedHours);
    expect(successor.budgetMirrorsPlan).toBe(false);
  });
});

describe("computeBudgetReport — is cost knowable at all", () => {
  // A bucket with real hours booked, so cost is genuinely being computed —
  // whether it lands on 0 depends purely on whether a rate exists.
  const bucketWithHours: BudgetBucket = {
    id: 1, name: "PAM", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
    allocations: [{ roleId: 1, resourceIds: [5], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 40 } }],
  };
  const resources = [res(5, 1, { "2026-01": 100 })];

  test("flags a bucket whose roles carry no internal rate", () => {
    const rateless: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 0 }];
    const report = computeBudgetReport([bucketWithHours], plan, rateless, resources, 8, noHolidays);
    // cost === 0 here only because the rate card is empty — NOT because the work
    // was free. Surfaces must not read that as a 100% margin.
    expect(report.buckets[0].cost).toBe(0);
    expect(report.buckets[0].costIsKnowable).toBe(false);
  });

  test("does not flag a bucket with a real internal rate", () => {
    const rated: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
    const report = computeBudgetReport([bucketWithHours], plan, rated, resources, 8, noHolidays);
    expect(report.buckets[0].costIsKnowable).toBe(true);
  });

  test("the project rollup is unknowable only when NO bucket can be costed", () => {
    const rateless: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 0 }];
    const allRateless = computeBudgetReport([bucketWithHours], plan, rateless, resources, 8, noHolidays);
    expect(allRateless.project.costIsKnowable).toBe(false);

    // One costable bucket makes the project total a real — if partial — figure,
    // so the rollup stays readable rather than collapsing to unknown.
    const mixedRoles: Role[] = [
      { id: 1, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 0 },
      { id: 2, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
    ];
    const ratedBucket: BudgetBucket = {
      ...bucketWithHours, id: 2, name: "Rated",
      allocations: [{ roleId: 2, resourceIds: [5], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 40 } }],
    };
    const mixed = computeBudgetReport([bucketWithHours, ratedBucket], plan, mixedRoles, resources, 8, noHolidays);
    expect(mixed.project.costIsKnowable).toBe(true);
  });

  // A bucket created by the "+ Add bucket" button starts with NO allocations.
  // `some()` over an empty list is vacuously false, which would announce
  // "no internal rates are set for this bucket's roles" before the user has
  // added a single role — pointing them at the wrong problem. With no rows
  // there is no work, so a cost of 0 is the true answer, not a missing one.
  test("an allocation-less bucket is knowable, not unrated", () => {
    const empty: BudgetBucket = { ...bucketWithHours, allocations: [] };
    const rated: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
    const report = computeBudgetReport([empty], plan, rated, resources, 8, noHolidays);
    expect(report.buckets[0].costIsKnowable).toBe(true);
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

describe("computeBudgetReport — consumption amount", () => {
  const roles: Role[] = [{ id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
  // A fixed-price bucket: 33,760 price, 75 of 275 hours booked => 27.3% consumed.
  const fixedBucket75of275: BudgetBucket = {
    id: 1, name: "FX", type: "fixed", currency: "EUR", fixedPriceAmount: 33760,
    startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
    allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 275 }, actualHours: { "2026-01": 75 } }],
  };

  test("consumption.amount is the consumed value, matching its own percent", () => {
    // The tile renders percent and amount together, so the amount must be what
    // was consumed (9,207), not what remains (24,553).
    const report = computeBudgetReport([fixedBucket75of275], plan, roles, [], 8, noHolidays);
    const c = report.buckets[0].consumption;
    expect(c.percent).toBeCloseTo(27.27, 1);
    expect(c.amount).toBeCloseTo(9207.27, 1);
  });

  test("the project rollup carries the same consumed amount", () => {
    const report = computeBudgetReport([fixedBucket75of275], plan, roles, [], 8, noHolidays);
    const c = report.project.consumption;
    expect(c.percent).toBeCloseTo(27.27, 1);
    expect(c.amount).toBeCloseTo(9207.27, 1);
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
