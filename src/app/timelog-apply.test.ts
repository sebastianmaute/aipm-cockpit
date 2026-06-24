import { describe, it, expect } from "vitest";
import { planApply, applyActualsToBuckets } from "./timelog-apply";
import type { BudgetBucket } from "./types";
import type { ActualsByBucket } from "./timelog-actuals";

const bucket = (id: number, actual: Record<string, number> = {}): BudgetBucket =>
  ({ id, name: "B", type: "tm", currency: "EUR", startDate: "", endDate: "", status: "open",
     allocations: [{ roleId: 1, resourceIds: [], budgetHours: {}, actualHours: actual }] } as BudgetBucket);

const overlay: ActualsByBucket = { 7: { "2026-06": { hours: 6, billableHours: 6 } } };

describe("planApply", () => {
  it("produces a diff of current→next actualHours per bucket·period", () => {
    const diff = planApply([bucket(7, { "2026-06": 2 })], overlay);
    expect(diff).toContainEqual({ bucketId: 7, period: "2026-06", current: 2, next: 6 });
  });
  it("treats a missing current period as current 0", () => {
    const diff = planApply([bucket(7, {})], overlay);
    expect(diff).toContainEqual({ bucketId: 7, period: "2026-06", current: 0, next: 6 });
  });
  it("skips buckets not in the overlay", () => {
    expect(planApply([bucket(8)], overlay)).toEqual([]);
  });
  it("skips an overlay bucketId that has no matching bucket", () => {
    expect(planApply([bucket(1)], overlay)).toEqual([]);
  });
});

describe("applyActualsToBuckets", () => {
  it("writes overlay hours into the first allocation (immutably) and leaves the input unmutated", () => {
    const before = [bucket(7, { "2026-06": 2 })];
    const after = applyActualsToBuckets(before, overlay);
    expect(after[0].allocations[0].actualHours["2026-06"]).toBe(6);
    expect(before[0].allocations[0].actualHours["2026-06"]).toBe(2); // input untouched
  });
  it("preserves other periods already in actualHours", () => {
    const after = applyActualsToBuckets([bucket(7, { "2026-05": 9 })], overlay);
    expect(after[0].allocations[0].actualHours["2026-05"]).toBe(9);
    expect(after[0].allocations[0].actualHours["2026-06"]).toBe(6);
  });
  it("leaves a bucket with no allocations untouched (no crash)", () => {
    const empty = { ...bucket(7), allocations: [] } as BudgetBucket;
    expect(applyActualsToBuckets([empty], overlay)[0]).toBe(empty);
  });
  it("does not touch buckets absent from the overlay", () => {
    const other = bucket(8, { "2026-06": 3 });
    const after = applyActualsToBuckets([other], overlay);
    expect(after[0]).toBe(other); // same reference — untouched
  });
});
