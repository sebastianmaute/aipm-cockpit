import { describe, expect, test } from "vitest";
import {
  bucketActivePeriods, allocationPlannedHours, computeBudgetReport, computeBucketReport,
  costIsKnowable, ratesMissing,
} from "./budget-report";
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

  // ★ EXPECTATION DELIBERATELY REVERSED (was: one costable bucket keeps the
  // rollup readable as a "real — if partial — figure"). That was written before
  // three review rounds established the opposite principle: a partial total is
  // exactly the thing that misleads, because nothing on the panel says which
  // part is missing. The rateless bucket here has 40 hours of REAL booked work
  // costed at 0; a project margin that quietly omits them is not "partial", it
  // is wrong. The rollup now refuses rather than approximates.
  test("the project rollup refuses whenever any bucket carries uncosted work", () => {
    const rateless: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 0 }];
    const allRateless = computeBudgetReport([bucketWithHours], plan, rateless, resources, 8, noHolidays);
    expect(allRateless.project.costIsKnowable).toBe(false);

    const mixedRoles: Role[] = [
      { id: 1, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 0 },
      { id: 2, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
    ];
    const ratedBucket: BudgetBucket = {
      ...bucketWithHours, id: 2, name: "Rated",
      allocations: [{ roleId: 2, resourceIds: [5], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 40 } }],
    };
    const mixed = computeBudgetReport([bucketWithHours, ratedBucket], plan, mixedRoles, resources, 8, noHolidays);
    // The rated bucket alone IS costable — the veto comes from its neighbour.
    expect(mixed.buckets[1].costIsKnowable).toBe(true);
    expect(mixed.project.costIsKnowable).toBe(false);
  });

  // A bucket created by the "+ Add bucket" button starts with NO allocations.
  // `some()` over an empty list is vacuously false, which would announce
  // "no internal rates are set for this bucket's roles" before the user has
  // added a single role — pointing them at the wrong problem. With no rows
  // there is no work, so a cost of 0 is the true answer, not a missing one.
  test("an allocation-less bucket does not claim its rate card is missing", () => {
    const empty: BudgetBucket = { ...bucketWithHours, allocations: [] };
    const rated: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
    const report = computeBudgetReport([empty], plan, rated, resources, 8, noHolidays);
    expect(report.buckets[0].ratesAreMissing).toBe(false);
  });

  // Two flags, three states — they answer different questions and must not be
  // collapsed. An empty bucket has nothing to say about rates (no notice) but
  // also no basis for a cost figure (no margin). Folding them into one boolean
  // is what let an unstaffed fixed-price bucket report a 100% margin.
  test("an allocation-less bucket has NO basis for a cost figure", () => {
    const empty: BudgetBucket = { ...bucketWithHours, allocations: [] };
    const rated: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
    const report = computeBudgetReport([empty], plan, rated, resources, 8, noHolidays);
    expect(report.buckets[0].costIsKnowable).toBe(false);
  });

  // The regression that shipped in 0.195.0: an unstaffed fixed-price contract
  // computes revenue = price, cost = 0 (no rows to sum) => a 100% margin and a
  // full win, Green, with no caveat — on work nobody has started. Exactly the
  // shape this whole batch exists to remove, entering through zero ROWS rather
  // than zero RATES. A T&M fixture cannot catch it: there revenue is also 0, so
  // pct(0,0) returns null and the figure is already blank.
  test("an unstaffed FIXED-PRICE bucket cannot report a margin", () => {
    const emptyFixed: BudgetBucket = {
      id: 1, name: "Unstaffed contract", type: "fixed", currency: "EUR",
      fixedPriceAmount: 50000, startDate: "2026-01-01", endDate: "2026-01-31",
      status: "open", allocations: [],
    };
    const rated: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
    const report = computeBudgetReport([emptyFixed], plan, rated, resources, 8, noHolidays);
    // The arithmetic still yields 100 — it is the DISPLAY that must not treat
    // it as a real reading, so the flag is what surfaces gate on.
    expect(report.buckets[0].costIsKnowable).toBe(false);
    expect(report.project.costIsKnowable).toBe(false);
  });

  // ★★ A row-level version of the same defect. `some(rated)` let ONE rated row
  // vouch for the whole bucket, so real booked hours against an unrated role
  // were costed at 0 while the flags reported a sound figure. That is worse
  // than the cases above: not an unknown shown as an ideal, but a WRONG number
  // shown as a genuine reading, with no dash and no notice anywhere.
  test("a row with hours but no rate makes its bucket uncostable", () => {
    const mixed: BudgetBucket = {
      id: 1, name: "Mixed rows", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      allocations: [
        { roleId: 1, resourceIds: [], budgetHours: { "2026-01": 0 }, actualHours: { "2026-01": 0 } },
        { roleId: 2, resourceIds: [], budgetHours: { "2026-01": 40 }, actualHours: { "2026-01": 40 } },
      ],
    };
    const roles: Role[] = [
      { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
      { id: 2, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 150 },
    ];
    const report = computeBudgetReport([mixed], plan, roles, [], 8, noHolidays);
    expect(report.buckets[0].costIsKnowable).toBe(false);
    // And the user must be TOLD — a rate really is missing here.
    expect(report.buckets[0].ratesAreMissing).toBe(true);
  });

  // The converse: an unrated row carrying NO hours cannot affect cost, so it
  // must not blank an otherwise sound figure. Without this the rule degrades
  // into "any unrated row anywhere blanks the bucket", which over-blanks.
  test("an unrated row with NO hours does not make its bucket uncostable", () => {
    const mixed: BudgetBucket = {
      id: 1, name: "Idle unrated row", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      allocations: [
        { roleId: 1, resourceIds: [], budgetHours: { "2026-01": 40 }, actualHours: { "2026-01": 40 } },
        { roleId: 2, resourceIds: [], budgetHours: {}, actualHours: {} },
      ],
    };
    const roles: Role[] = [
      { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
      { id: 2, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 150 },
    ];
    const report = computeBudgetReport([mixed], plan, roles, [], 8, noHolidays);
    expect(report.buckets[0].costIsKnowable).toBe(true);
  });

  // ★★ The project rollup sums revenue and cost from EVERY bucket, so ONE
  // uncostable bucket contaminates the total — and a `.some()` flag would call
  // that total knowable the moment any OTHER bucket happened to be rated. A
  // mixed project (one active rated bucket, one unstarted contract) is an
  // entirely ordinary shape, and it is the number a PM reads first. Gating the
  // bucket display is not enough; the aggregate has to refuse to report.
  test("one uncostable bucket makes the PROJECT margin unknowable", () => {
    const ratedTm: BudgetBucket = {
      id: 1, name: "Active work", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } }],
    };
    const unstaffedFixed: BudgetBucket = {
      id: 2, name: "Unstarted contract", type: "fixed", currency: "EUR",
      fixedPriceAmount: 50000, startDate: "2026-02-01", endDate: "2026-02-28",
      status: "open", allocations: [],
    };
    const rated: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
    const report = computeBudgetReport([ratedTm, unstaffedFixed], plan, rated, [], 8, noHolidays);
    // Guard the fixture: the rated bucket really is costable on its own, so a
    // false negative here would prove nothing.
    expect(report.buckets[0].costIsKnowable).toBe(true);
    expect(report.project.costIsKnowable).toBe(false);
  });

  // `revenue === 0` alone is too loose an exemption. A bucket with BUDGETED
  // hours at no rate earns nothing yet, so it passes the revenue test — while
  // its hours land in `budgetCost` as 0 and understate the project's cost burn
  // (here a true overrun reads as exactly 100%). It also fired the notice while
  // the figures rendered, so the panel said "cost, margin and burn cannot be
  // calculated" directly beside calculated numbers.
  test("a bucket with BUDGETED hours at no rate still vetoes the project", () => {
    const ratedActive: BudgetBucket = {
      id: 1, name: "Rated active", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 40 }, actualHours: { "2026-01": 40 } }],
    };
    const unratedBudgetedOnly: BudgetBucket = {
      id: 2, name: "Unrated budgeted", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      allocations: [{ roleId: 2, resourceIds: [], budgetHours: { "2026-01": 40 }, actualHours: {} }],
    };
    const roles: Role[] = [
      { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
      { id: 2, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 150 },
    ];
    const report = computeBudgetReport([ratedActive, unratedBudgetedOnly], plan, roles, [], 8, noHolidays);
    // Guard the fixture: it really does slip the revenue-based exemption.
    expect(report.buckets[1].revenue).toBe(0);
    expect(report.buckets[1].ratesAreMissing).toBe(true);
    expect(report.project.costIsKnowable).toBe(false);
  });

  // The notice and the figures must never contradict each other: whenever a
  // bucket makes the notice fire, the project figures go unknown too.
  test("the project never shows figures beside the cannot-be-calculated notice", () => {
    const ratedActive: BudgetBucket = {
      id: 1, name: "Rated active", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 40 }, actualHours: { "2026-01": 40 } }],
    };
    const unrated: BudgetBucket = {
      id: 2, name: "Unrated", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      allocations: [{ roleId: 2, resourceIds: [], budgetHours: { "2026-01": 40 }, actualHours: {} }],
    };
    const roles: Role[] = [
      { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
      { id: 2, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 150 },
    ];
    const p = computeBudgetReport([ratedActive, unrated], plan, roles, [], 8, noHolidays).project;
    expect(p.ratesAreMissing && p.costIsKnowable).toBe(false);
  });

  // A bucket contributing NO revenue cannot distort the total, so it must not
  // veto an otherwise-costable project — else adding an empty scratch bucket
  // would blank a perfectly good margin.
  test("an empty ZERO-REVENUE bucket does not veto a costable project", () => {
    const ratedTm: BudgetBucket = {
      id: 1, name: "Active work", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } }],
    };
    const emptyScratch: BudgetBucket = {
      id: 2, name: "Empty scratch", type: "tm", currency: "EUR",
      startDate: "2026-02-01", endDate: "2026-02-28", status: "open", allocations: [],
    };
    const rated: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
    const report = computeBudgetReport([ratedTm, emptyScratch], plan, rated, [], 8, noHolidays);
    expect(report.buckets[1].revenue).toBe(0);
    expect(report.project.costIsKnowable).toBe(true);
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

// ★★ STRUCTURAL GUARD. Three separate commits each fixed this defect at one
// layer and left it open at the next: rateless rows, then empty buckets, then
// the project rollup. Every fix was correct for the case it was written
// against, and every set of tests was a hand-picked scenario that happened to
// miss the next one.
//
// This enumerates the bucket kinds instead, and asserts the INVARIANT rather
// than any specific outcome: if the project total is presented as knowable,
// then no bucket contributing revenue may be uncostable — because `revenue`
// and `cost` are summed across all of them, so one uncostable contributor
// silently poisons the ratio.
//
// Deliberately expressed over the OUTPUT (which buckets carry revenue, which
// are costable), not over the rollup expression, so it stays a real check if
// that expression is rewritten.
describe("computeBudgetReport — project cost-knowability invariant", () => {
  const rated: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
  const rateless: Role[] = [{ id: 2, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 150 }];

  const kinds = {
    ratedTm: (id: number): BudgetBucket => ({
      id, name: `rated-tm-${id}`, type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } }],
    }),
    ratelessTm: (id: number): BudgetBucket => ({
      id, name: `rateless-tm-${id}`, type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      allocations: [{ roleId: 2, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } }],
    }),
    emptyTm: (id: number): BudgetBucket => ({
      id, name: `empty-tm-${id}`, type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open", allocations: [],
    }),
    emptyFixed: (id: number): BudgetBucket => ({
      id, name: `empty-fixed-${id}`, type: "fixed", currency: "EUR",
      fixedPriceAmount: 50000, startDate: "2026-01-01", endDate: "2026-01-31",
      status: "open", allocations: [],
    }),
    ratedFixed: (id: number): BudgetBucket => ({
      id, name: `rated-fixed-${id}`, type: "fixed", currency: "EUR",
      fixedPriceAmount: 50000, startDate: "2026-01-01", endDate: "2026-01-31",
      status: "open",
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } }],
    }),
  } as const;

  const names = Object.keys(kinds) as (keyof typeof kinds)[];
  const roles = [...rated, ...rateless];

  // Every single bucket, and every ordered pair including like-with-like.
  const combos: (keyof typeof kinds)[][] = [
    ...names.map((n) => [n]),
    ...names.flatMap((a) => names.map((b) => [a, b])),
  ];

  for (const combo of combos) {
    test(`invariant holds for [${combo.join(" + ")}]`, () => {
      const buckets = combo.map((n, i) => kinds[n](i + 1));
      const report = computeBudgetReport(buckets, plan, roles, [], 8, noHolidays);
      if (report.project.costIsKnowable) {
        const poisoned = report.buckets.filter((b) => !b.costIsKnowable && b.revenue !== 0);
        expect(
          poisoned.map((b) => `${b.name} (revenue ${b.revenue})`),
        ).toEqual([]);
      }
    });
  }

  // The invariant is satisfiable by always answering "unknowable", so pin that
  // a genuinely costable project still reports a real figure.
  test("a wholly costable project still reports its margin", () => {
    const report = computeBudgetReport(
      [kinds.ratedTm(1), kinds.ratedFixed(2)], plan, roles, [], 8, noHolidays,
    );
    expect(report.project.costIsKnowable).toBe(true);
    expect(report.project.contributionMargin.percent).not.toBeNull();
  });
});

describe("computeBucketReport — costUnknownReason", () => {
  const plan: ResourcePlan = {
    startDate: "2026-01-01", endDate: "2026-01-31", granularity: "month", currency: "EUR",
  };
  const noHolidays = new Set<string>();
  const ratedRoles: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
  const partlyPricedRoles: Role[] = [
    { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
    { id: 2, disciplineId: 1, gradeId: 2, internalRate: 0, externalRate: 210 },
  ];

  function tmBucket(over: Partial<BudgetBucket> = {}): BudgetBucket {
    return {
      id: 1, name: "b", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } }],
      ...over,
    };
  }

  function blendedBucket(over: Partial<BudgetBucket> = {}): BudgetBucket {
    return {
      id: 1, name: "b", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      planningMode: "blended",
      allocations: [],
      disciplineAllocations: [
        { disciplineId: 1, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } },
      ],
      ...over,
    };
  }

  test("a fully costable bucket has no reason", () => {
    const rep = computeBucketReport(tmBucket(), plan, ratedRoles, [], 8, noHolidays);
    expect(rep.costUnknownReason).toBeNull();
    expect(rep.unpricedDisciplineIds).toEqual([]);
  });

  test("an empty bucket is no-rows", () => {
    const rep = computeBucketReport(tmBucket({ allocations: [] }), plan, ratedRoles, [], 8, noHolidays);
    expect(rep.costUnknownReason).toBe("no-rows");
  });

  test("rows with no rate at all are no-rates", () => {
    const rateless: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 150 }];
    const rep = computeBucketReport(tmBucket(), plan, rateless, [], 8, noHolidays);
    expect(rep.costUnknownReason).toBe("no-rates");
  });

  test("hours booked at a zero rate beside a rated row are unrated-hours", () => {
    const b = tmBucket({
      allocations: [
        { roleId: 1, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } },
        { roleId: 2, resourceIds: [], budgetHours: { "2026-01": 40 }, actualHours: { "2026-01": 40 } },
      ],
    });
    const roles: Role[] = [
      { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
      { id: 2, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 150 },
    ];
    const rep = computeBucketReport(b, plan, roles, [], 8, noHolidays);
    expect(rep.costUnknownReason).toBe("unrated-hours");
  });

  test("a blended bucket on a partly priced discipline is unpriced-blend and names it", () => {
    const rep = computeBucketReport(blendedBucket(), plan, partlyPricedRoles, [], 8, noHolidays);
    expect(rep.costUnknownReason).toBe("unpriced-blend");
    expect(rep.unpricedDisciplineIds).toEqual([1]);
  });

  test("a bucket internal override beats the poison — the rate card behind it is irrelevant", () => {
    const rep = computeBucketReport(
      blendedBucket({ rateOverrideInternal: 90 }), plan, partlyPricedRoles, [], 8, noHolidays,
    );
    expect(rep.costUnknownReason).toBeNull();
    expect(rep.unpricedDisciplineIds).toEqual([]);
    expect(rep.cost).toBe(10 * 90);
  });

  test("a ZERO override suppresses the naming variant but still reports unrated work", () => {
    // Parity trap. `effectiveRates` treats a 0 override as usable, so the rate
    // resolves to 0 whatever the rate card holds. Gating the poison on `> 0`
    // would name disciplines the override has already overruled — telling the
    // user to fix something that cannot change the outcome. The generic
    // unrated-hours message is the honest one here.
    const rep = computeBucketReport(
      blendedBucket({ rateOverrideInternal: 0 }), plan, partlyPricedRoles, [], 8, noHolidays,
    );
    expect(rep.costUnknownReason).toBe("unrated-hours");
    expect(rep.unpricedDisciplineIds).toEqual([]);
  });

  test("a poisoned discipline carrying NO hours does not blank a sound figure", () => {
    // The shipped rule: an unrated row with no hours contributes nothing to cost,
    // so it must not blank the bucket. The poison inherits that rule.
    const b: BudgetBucket = {
      id: 1, name: "b", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      planningMode: "blended",
      allocations: [],
      disciplineAllocations: [
        { disciplineId: 2, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } },
        { disciplineId: 1, resourceIds: [], budgetHours: {}, actualHours: {} },
      ],
    };
    const roles: Role[] = [
      ...partlyPricedRoles,
      { id: 3, disciplineId: 2, gradeId: 1, internalRate: 80, externalRate: 120 },
    ];
    const rep = computeBucketReport(b, plan, roles, [], 8, noHolidays);
    expect(rep.costUnknownReason).toBeNull();
    expect(rep.unpricedDisciplineIds).toEqual([]);
  });

  test("the derived helpers agree with the reason", () => {
    const ok = computeBucketReport(tmBucket(), plan, ratedRoles, [], 8, noHolidays);
    const empty = computeBucketReport(tmBucket({ allocations: [] }), plan, ratedRoles, [], 8, noHolidays);
    expect(costIsKnowable(ok)).toBe(true);
    expect(ratesMissing(ok)).toBe(false);
    expect(costIsKnowable(empty)).toBe(false);
    // An empty bucket has no roles to rate, so the rate card is NOT the problem.
    expect(ratesMissing(empty)).toBe(false);
  });

  test("a zero override is not a 'no rate card' bucket — the override is the cause", () => {
    // Pins the override-message arm (`hasInternalOverride ? "unrated-hours"`) under
    // its own name: a 0 override → "unrated-hours", never "no-rates". The
    // ZERO-override test above also happens to catch a regression here, but it
    // is named for the naming-variant suppression, so an edit to that test
    // could silently unpin this rule.
    const b: BudgetBucket = {
      id: 1, name: "b", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      rateOverrideInternal: 0,
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } }],
    };
    const rated: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
    // The rate card is fully populated — pointing the user at it would be
    // instructing them to do something their own override overrules.
    const rep = computeBucketReport(b, plan, rated, [], 8, noHolidays);
    expect(rep.costUnknownReason).toBe("unrated-hours");
  });

  test("a zero-override fixed-price bucket with no hours is NOT knowable (I1 regression)", () => {
    const b: BudgetBucket = {
      id: 1, name: "b", type: "fixed", currency: "EUR", fixedPriceAmount: 100000,
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      rateOverrideInternal: 0,
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: {}, actualHours: {} }],
    };
    const rated: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
    const rep = computeBucketReport(b, plan, rated, [], 8, noHolidays);
    // revenue 100000, cost 0 — must NOT read as a 100% margin.
    expect(costIsKnowable(rep)).toBe(false);
    expect(rep.costUnknownReason).not.toBeNull();
  });

  test("the helpers exactly reproduce the booleans they replace, for every state", () => {
    // Task 7 deletes rep.costIsKnowable / rep.ratesAreMissing and points every
    // consumer at the helpers. This pins that the swap is behaviour-preserving —
    // a divergence here is a silent UI change with nothing else to catch it.
    const rateless: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 150 }];
    const uncostedBucket = tmBucket({
      allocations: [
        { roleId: 1, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } },
        { roleId: 2, resourceIds: [], budgetHours: { "2026-01": 40 }, actualHours: { "2026-01": 40 } },
      ],
    });
    const ratedPlusUnrated: Role[] = [
      { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
      { id: 2, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 150 },
    ];
    const i1FixedNoHours: BudgetBucket = {
      id: 1, name: "b", type: "fixed", currency: "EUR", fixedPriceAmount: 100000,
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      rateOverrideInternal: 0,
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: {}, actualHours: {} }],
    };
    const cases: { name: string; bucket: BudgetBucket; roles: Role[] }[] = [
      { name: "costable", bucket: tmBucket(), roles: ratedRoles },
      { name: "empty", bucket: tmBucket({ allocations: [] }), roles: ratedRoles },
      { name: "rateless+hours", bucket: tmBucket(), roles: rateless },
      { name: "rated+uncosted", bucket: uncostedBucket, roles: ratedPlusUnrated },
      { name: "partly-priced blend", bucket: blendedBucket(), roles: partlyPricedRoles },
      { name: "90-override", bucket: blendedBucket({ rateOverrideInternal: 90 }), roles: partlyPricedRoles },
      { name: "0-override+hours", bucket: blendedBucket({ rateOverrideInternal: 0 }), roles: partlyPricedRoles },
      { name: "0-override fixed no-hours", bucket: i1FixedNoHours, roles: ratedRoles },
    ];
    for (const c of cases) {
      const rep = computeBucketReport(c.bucket, plan, c.roles, [], 8, noHolidays);
      expect(costIsKnowable(rep), `costIsKnowable @ ${c.name}`).toBe(rep.costIsKnowable);
      expect(ratesMissing(rep), `ratesMissing @ ${c.name}`).toBe(rep.ratesAreMissing);
    }
  });

  test("two poisoned allocations on the same discipline name it once, not twice", () => {
    const b: BudgetBucket = {
      id: 1, name: "b", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      planningMode: "blended",
      allocations: [],
      disciplineAllocations: [
        { disciplineId: 1, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } },
        { disciplineId: 1, resourceIds: [], budgetHours: { "2026-01": 20 }, actualHours: { "2026-01": 20 } },
      ],
    };
    const rep = computeBucketReport(b, plan, partlyPricedRoles, [], 8, noHolidays);
    expect(rep.costUnknownReason).toBe("unpriced-blend");
    expect(rep.unpricedDisciplineIds).toEqual([1]);
  });
});

describe("computeBudgetReport — project costUnknownReason", () => {
  const plan: ResourcePlan = {
    startDate: "2026-01-01", endDate: "2026-01-31", granularity: "month", currency: "EUR",
  };
  const noHolidays = new Set<string>();
  const roles: Role[] = [
    { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
    { id: 2, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 150 },
  ];

  function bucket(id: number, roleId: number): BudgetBucket {
    return {
      id, name: `b${id}`, type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      allocations: [{ roleId, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } }],
    };
  }

  // A rated role AND a rateless role, both with hours → hasRatedRow true AND
  // uncostedWork true → bucket reason `unrated-hours` (the top severity). A
  // single rateless role would instead be `no-rates` (no rate ANYWHERE), which
  // is a different, lower-severity reason.
  function mixedBucket(id: number): BudgetBucket {
    return {
      id, name: `mix${id}`, type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      allocations: [
        { roleId: 1, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } },
        { roleId: 2, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } },
      ],
    };
  }

  test("a costable project has no reason", () => {
    const rep = computeBudgetReport([bucket(1, 1)], plan, roles, [], 8, noHolidays);
    expect(rep.project.costUnknownReason).toBeNull();
    expect(rep.project.unpricedDisciplineIds).toEqual([]);
  });

  test("a project with no buckets is no-rows", () => {
    const rep = computeBudgetReport([], plan, roles, [], 8, noHolidays);
    expect(rep.project.costUnknownReason).toBe("no-rows");
  });

  test("the reason comes from the failing bucket, not the healthy one", () => {
    const rep = computeBudgetReport([bucket(1, 1), mixedBucket(2)], plan, roles, [], 8, noHolidays);
    expect(rep.project.costUnknownReason).toBe("unrated-hours");
  });

  test("a higher-severity reason wins when two failing buckets both distort the total", () => {
    // Both buckets carry revenue, so BOTH reach `blamed` — the zero-revenue
    // exemption would remove a bucket from it, which is why an EMPTY bucket
    // (revenue 0) cannot be used here: it never enters the blame set, so pairing
    // it with an unrated-hours bucket leaves only one reason and the test would
    // pass regardless of ordering (the vacuous version this replaces).
    const noRates = bucket(2, 2); // single rateless role + hours → no-rates, revenue != 0
    const rep = computeBudgetReport([mixedBucket(1), noRates], plan, roles, [], 8, noHolidays);
    // Fixture guard: the two failing buckets really do carry DIFFERENT reasons,
    // so the reduce over REASON_RANK has a genuine choice to make. Without this a
    // fixture drift that collapsed them to one reason would silently re-vacuum
    // the test.
    expect(rep.buckets.map((b) => b.costUnknownReason).sort()).toEqual(["no-rates", "unrated-hours"]);
    // unrated-hours (real hours costed at zero) outranks no-rates by severity of
    // distortion — the ordering REASON_RANK encodes, which a plain
    // derivation order would get backwards.
    expect(rep.project.costUnknownReason).toBe("unrated-hours");
  });

  test("an all-empty project reports no-rows (nothing to cost anywhere)", () => {
    // The only way `no-rows` becomes a PROJECT reason: every bucket is a
    // zero-revenue empty one, so the blame set is empty and the reduce yields
    // null, which the `?? "no-rows"` default names.
    const empty = (id: number): BudgetBucket => ({ ...bucket(id, 1), allocations: [] });
    const rep = computeBudgetReport([empty(1), empty(2)], plan, roles, [], 8, noHolidays);
    expect(rep.project.costUnknownReason).toBe("no-rows");
  });

  test("unpriced ids are empty when a more severe reason wins the headline", () => {
    // A mixed project: one unrated-hours bucket (revenue > 0) and one
    // unpriced-blend bucket (revenue > 0). Both are blamed, but unrated-hours
    // outranks — so the project message names no disciplines and the ids MUST be
    // empty, or a surface would render discipline names under an unrated-hours
    // headline (the doc's invariant: non-empty IFF reason === unpriced-blend).
    const blend: BudgetBucket = {
      id: 2, name: "blend", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      planningMode: "blended", allocations: [],
      disciplineAllocations: [
        { disciplineId: 9, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } },
      ],
    };
    const blendRoles: Role[] = [
      ...roles,
      { id: 3, disciplineId: 9, gradeId: 1, internalRate: 100, externalRate: 150 },
      { id: 4, disciplineId: 9, gradeId: 2, internalRate: 0, externalRate: 210 },
    ];
    const rep = computeBudgetReport([mixedBucket(1), blend], plan, blendRoles, [], 8, noHolidays);
    // Fixture guard: the two failing buckets really carry the two reasons.
    expect(rep.buckets.map((b) => b.costUnknownReason).sort()).toEqual(["unpriced-blend", "unrated-hours"]);
    expect(rep.project.costUnknownReason).toBe("unrated-hours");
    expect(rep.project.unpricedDisciplineIds).toEqual([]);
  });

  test("costIsKnowable and the project reason never disagree", () => {
    const rep = computeBudgetReport([bucket(1, 1), bucket(2, 2)], plan, roles, [], 8, noHolidays);
    expect(rep.project.costIsKnowable).toBe(costIsKnowable(rep.project));
  });

  test("the project's knowability verdict is unchanged by this task", () => {
    // Pins that switching the predicate's inputs from the boolean fields to the
    // equivalent helpers did NOT move the verdict. The shipped some/every rule
    // and its exemption are preserved exactly.
    const oneCostableOneEmpty = computeBudgetReport(
      [bucket(1, 1), { ...bucket(2, 1), allocations: [] }], plan, roles, [], 8, noHolidays,
    );
    // one costable bucket + one zero-revenue empty ⇒ still knowable (the exemption).
    expect(oneCostableOneEmpty.project.costIsKnowable).toBe(true);

    const nothingCostable = computeBudgetReport([bucket(1, 2)], plan, roles, [], 8, noHolidays);
    expect(nothingCostable.project.costIsKnowable).toBe(false);
  });

  test("the project names the failing buckets' unpriced disciplines, deduped", () => {
    const blended = (id: number): BudgetBucket => ({
      id, name: `blend${id}`, type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      planningMode: "blended", allocations: [],
      disciplineAllocations: [
        { disciplineId: 9, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } },
      ],
    });
    const blendRoles: Role[] = [
      { id: 3, disciplineId: 9, gradeId: 1, internalRate: 100, externalRate: 150 },
      { id: 4, disciplineId: 9, gradeId: 2, internalRate: 0, externalRate: 210 },
    ];
    // Two buckets, same poisoned discipline 9 — the union must be [9], not [9, 9].
    const rep = computeBudgetReport([blended(1), blended(2)], plan, blendRoles, [], 8, noHolidays);
    expect(rep.project.costUnknownReason).toBe("unpriced-blend");
    expect(rep.project.unpricedDisciplineIds).toEqual([9]);
  });
});
