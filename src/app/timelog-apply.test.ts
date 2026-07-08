import { describe, it, expect } from "vitest";
import { planApply, applyActualsToBuckets, bucketsMissingAllocations } from "./timelog-apply";
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
  it("skips a bucket that has overlay hours but no allocation to hold them", () => {
    const empty = { ...bucket(7), allocations: [] } as BudgetBucket;
    expect(planApply([empty], overlay)).toEqual([]);
  });
  it("uses the blended disciplineAllocation as the current-actuals source", () => {
    const b = { ...bucket(7), planningMode: "blended", allocations: [],
      disciplineAllocations: [{ disciplineId: 1, resourceIds: [], budgetHours: {}, actualHours: { "2026-06": 4 } }] } as BudgetBucket;
    expect(planApply([b], overlay)).toContainEqual({ bucketId: 7, period: "2026-06", current: 4, next: 6 });
  });
  it("skips a blended bucket with no disciplineAllocations", () => {
    const b = { ...bucket(7), planningMode: "blended", allocations: [], disciplineAllocations: [] } as BudgetBucket;
    expect(planApply([b], overlay)).toEqual([]);
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
  it("writes overlay hours into the first disciplineAllocation for a blended bucket", () => {
    const b = { ...bucket(7), planningMode: "blended", allocations: [],
      disciplineAllocations: [{ disciplineId: 1, resourceIds: [], budgetHours: {}, actualHours: { "2026-06": 2 } }] } as BudgetBucket;
    const after = applyActualsToBuckets([b], overlay);
    expect(after[0].disciplineAllocations![0].actualHours["2026-06"]).toBe(6);
    expect(after[0].allocations).toEqual([]); // detailed list left untouched
  });
  it("leaves a blended bucket with no disciplineAllocations untouched", () => {
    const b = { ...bucket(7), planningMode: "blended", allocations: [], disciplineAllocations: [] } as BudgetBucket;
    expect(applyActualsToBuckets([b], overlay)[0]).toBe(b);
  });
});

describe("bucketsMissingAllocations", () => {
  it("flags an overlay bucket with no target allocation (detailed)", () => {
    const empty = { ...bucket(7), allocations: [] } as BudgetBucket;
    expect(bucketsMissingAllocations([empty], overlay)).toEqual([7]);
  });
  it("flags a blended bucket with no disciplineAllocations", () => {
    const b = { ...bucket(7), planningMode: "blended", allocations: [], disciplineAllocations: [] } as BudgetBucket;
    expect(bucketsMissingAllocations([b], overlay)).toEqual([7]);
  });
  it("does not flag a bucket that has an allocation", () => {
    expect(bucketsMissingAllocations([bucket(7)], overlay)).toEqual([]);
  });
  it("keys the branch on planningMode: a detailed bucket ignores stray disciplineAllocations", () => {
    // Empty `allocations` but a populated `disciplineAllocations`; planningMode is
    // absent (⇒ detailed), so the discipline line must NOT count as a target.
    const b = { ...bucket(7), allocations: [],
      disciplineAllocations: [{ disciplineId: 1, resourceIds: [], budgetHours: {}, actualHours: {} }] } as BudgetBucket;
    expect(bucketsMissingAllocations([b], overlay)).toEqual([7]);
    expect(planApply([b], overlay)).toEqual([]);
    expect(applyActualsToBuckets([b], overlay)[0]).toBe(b);
  });
  it("ignores buckets absent from the overlay", () => {
    const empty = { ...bucket(8), allocations: [] } as BudgetBucket;
    expect(bucketsMissingAllocations([empty], overlay)).toEqual([]);
  });
});
