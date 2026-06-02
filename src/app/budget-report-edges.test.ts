import { describe, expect, test } from "vitest";
import {
  bucketActivePeriods,
  computeBudgetReport,
  computeBucketReport,
  getBucketReminders,
} from "./budget-report";
import type { ResourcePlan, Resource, Role, BudgetBucket } from "./types";

const plan: ResourcePlan = {
  startDate: "2026-01-01",
  endDate: "2026-03-31",
  granularity: "month",
  currency: "EUR",
};
const oneMonth: ResourcePlan = { ...plan, endDate: "2026-01-31" };
const roles: Role[] = [{ id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
const noResources: Resource[] = [];
const noHolidays = new Set<string>();

function bucket(over: Partial<BudgetBucket>): BudgetBucket {
  return {
    id: 1, name: "B", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-03-31", status: "open",
    allocations: [],
    ...over,
  };
}

describe("computeBucketReport — fixed-price over-burn clamp", () => {
  // actualHours (150) exceeds budgetHours (100): consumedValue must cap at the
  // contract amount, never exceed it. This branch was previously untested.
  const b = bucket({
    type: "fixed", fixedPriceAmount: 20000,
    startDate: "2026-01-01", endDate: "2026-01-31",
    allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 150 } }],
  });
  const rep = computeBucketReport(b, oneMonth, roles, noResources, 8, noHolidays);

  test("consumedValue is clamped to the fixed price (not 30000)", () => {
    expect(rep.consumedValue).toBe(20000);
  });
  test("consumption is fully burned: amount 0, percent 100", () => {
    expect(rep.consumption.amount).toBe(0);
    expect(rep.consumption.percent).toBeCloseTo(100, 5);
  });
  test("win/loss reflects cost over the contract value", () => {
    expect(rep.winLossHours).toBe(100 - 150);
    expect(rep.winLossValue).toBe(20000 - 150 * 100);
  });
});

describe("computeSpillover (via computeBudgetReport)", () => {
  function closed(id: number, successorId: number, budget: number, actual: number): BudgetBucket {
    return bucket({
      id, name: `closed-${id}`, status: "closed", closedDate: "2026-01-31", successorId,
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": budget }, actualHours: { "2026-01": actual } }],
    });
  }

  test("two closed predecessors accumulate into one successor", () => {
    const a = closed(1, 3, 100, 40); // winLoss 60h, value 15000-6000 = 9000
    const b = closed(2, 3, 50, 10); //  winLoss 40h, value 7500-1500 = 6000
    const c = bucket({ id: 3, name: "successor", status: "open" });
    const report = computeBudgetReport([a, b, c], plan, roles, noResources, 8, noHolidays);
    const cRep = report.buckets.find((r) => r.bucketId === 3)!;
    expect(cRep.spilloverInHours).toBe(100); // 60 + 40
    expect(cRep.spilloverInValue).toBe(15000); // 9000 + 6000
  });

  test("an OPEN bucket with a successorId contributes no spillover", () => {
    const openPred = bucket({
      id: 1, status: "open", successorId: 2,
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 10 } }],
    });
    const succ = bucket({ id: 2, name: "successor" });
    const report = computeBudgetReport([openPred, succ], plan, roles, noResources, 8, noHolidays);
    expect(report.buckets.find((r) => r.bucketId === 2)!.spilloverInHours).toBe(0);
  });

  test("a closed bucket pointing at a missing successor id is ignored (no throw)", () => {
    const orphan = closed(1, 999, 100, 40);
    const report = computeBudgetReport([orphan], plan, roles, noResources, 8, noHolidays);
    // Only the orphan exists; nothing receives spillover and the call succeeds.
    expect(report.buckets).toHaveLength(1);
    expect(report.buckets[0].spilloverInHours).toBe(0);
  });

  test("a closed bucket whose successor is itself is ignored", () => {
    const selfRef = closed(1, 1, 100, 40);
    const report = computeBudgetReport([selfRef], plan, roles, noResources, 8, noHolidays);
    expect(report.buckets[0].spilloverInHours).toBe(0);
  });
});

describe("bucketActivePeriods", () => {
  test("an undated bucket spans every plan period", () => {
    const periods = bucketActivePeriods({ startDate: "", endDate: "" }, plan);
    expect(periods.map((p) => p.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });
  test("a bucket window entirely outside the plan yields no periods", () => {
    const periods = bucketActivePeriods({ startDate: "2027-01-01", endDate: "2027-12-31" }, plan);
    expect(periods).toEqual([]);
  });
});

describe("computeBudgetReport — project rollup null percents", () => {
  test("zero revenue makes contribution-margin percent null", () => {
    const zeroExternal: Role[] = [{ id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 0 }];
    const b = bucket({
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 50 } }],
    });
    const report = computeBudgetReport([b], plan, zeroExternal, noResources, 8, noHolidays);
    expect(report.project.revenue).toBe(0);
    expect(report.project.contributionMargin.percent).toBeNull();
    // budgetValue is also 0 here, so consumption percent is null too.
    expect(report.project.consumption.percent).toBeNull();
  });
});

describe("getBucketReminders", () => {
  const today = "2026-06-02";
  const leadDays = 7;

  function endingOn(id: number, endDate: string, over: Partial<BudgetBucket> = {}): BudgetBucket {
    return bucket({ id, name: `b${id}`, endDate, ...over });
  }

  test("categorizes overdue / today / soon and skips beyond the lead window", () => {
    const buckets = [
      endingOn(1, "2026-05-30"), // overdue (-3)
      endingOn(2, "2026-06-02"), // today (0)
      endingOn(3, "2026-06-09"), // soon (exactly leadDays = 7)
      endingOn(4, "2026-06-10"), // 8 days out — excluded
    ];
    const out = getBucketReminders(buckets, leadDays, today);
    const byId = new Map(out.map((r) => [r.bucket.id, r]));
    expect(byId.get(1)!.category).toBe("overdue");
    expect(byId.get(1)!.daysLeft).toBeLessThan(0);
    expect(byId.get(2)!.category).toBe("today");
    expect(byId.get(2)!.daysLeft).toBe(0);
    expect(byId.get(3)!.category).toBe("soon");
    expect(byId.get(3)!.daysLeft).toBe(7);
    expect(byId.has(4)).toBe(false);
  });

  test("skips closed buckets and buckets without an end date", () => {
    const buckets = [
      endingOn(1, "2026-06-02", { status: "closed", closedDate: "2026-06-02" }),
      endingOn(2, ""),
    ];
    expect(getBucketReminders(buckets, leadDays, today)).toEqual([]);
  });

  test("returns reminders sorted by end date ascending", () => {
    const buckets = [
      endingOn(1, "2026-06-09"),
      endingOn(2, "2026-05-30"),
      endingOn(3, "2026-06-02"),
    ];
    const out = getBucketReminders(buckets, leadDays, today);
    expect(out.map((r) => r.bucket.id)).toEqual([2, 3, 1]);
  });
});
