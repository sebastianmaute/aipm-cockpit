import { describe, expect, it } from "vitest";
import { bucketIdForTask, moveTasksToBucket } from "./budget-task-link";
import type { BudgetBucket } from "./types";

const bucket = (id: number, taskIds: number[]): BudgetBucket =>
  ({ id, name: `B${id}`, taskIds }) as unknown as BudgetBucket;

const STAMP = "2026-07-28T10:00:00.000Z";

describe("bucketIdForTask", () => {
  it("finds the linking bucket", () => {
    expect(bucketIdForTask([bucket(1, [5]), bucket(2, [7])], 7)).toBe(2);
  });

  it("is null when no bucket links the task", () => {
    expect(bucketIdForTask([bucket(1, [5])], 7)).toBeNull();
  });

  it("returns the FIRST match when a workspace holds a duplicate link", () => {
    expect(bucketIdForTask([bucket(1, [7]), bucket(2, [7])], 7)).toBe(1);
  });
});

describe("moveTasksToBucket", () => {
  it("adds to the target and removes from the previous bucket", () => {
    const before = [bucket(1, [7, 12]), bucket(2, [3])];
    const after = moveTasksToBucket(before, [7], 2, STAMP);
    expect(after[0].taskIds).toEqual([12]);
    expect(after[1].taskIds).toEqual([3, 7]);
  });

  it("moves several tasks out of several source buckets in one call", () => {
    const before = [bucket(1, [7]), bucket(2, [8]), bucket(3, [])];
    const after = moveTasksToBucket(before, [7, 8], 3, STAMP);
    expect(after[0].taskIds).toEqual([]);
    expect(after[1].taskIds).toEqual([]);
    expect(after[2].taskIds).toEqual([7, 8]);
  });

  it("unlinks without adding anywhere when the target is null", () => {
    const after = moveTasksToBucket([bucket(1, [7]), bucket(2, [])], [7], null, STAMP);
    expect(after[0].taskIds).toEqual([]);
    expect(after[1].taskIds).toEqual([]);
  });

  it("returns the SAME ARRAY REFERENCE when the task is already in the target", () => {
    const before = [bucket(1, [3]), bucket(2, [7])];
    // Reference identity, not deep equality: a fresh copy would satisfy toEqual
    // and prove nothing, and the no-op guard is what stops a spurious undo entry.
    expect(moveTasksToBucket(before, [7], 2, STAMP)).toBe(before);
  });

  it("returns the same reference when unlinking a task that is not linked", () => {
    const before = [bucket(1, [3])];
    expect(moveTasksToBucket(before, [7], null, STAMP)).toBe(before);
  });

  it("is a no-op for an unknown target id and LEAVES the existing link intact", () => {
    const before = [bucket(1, [7])];
    const after = moveTasksToBucket(before, [7], 99, STAMP);
    expect(after).toBe(before);
    expect(after[0].taskIds).toEqual([7]);
  });

  it("keeps untouched buckets at their original object identity and stamp", () => {
    const untouched = { ...bucket(1, [3]), localModifiedAt: "2026-01-01T00:00:00.000Z" } as BudgetBucket;
    const before = [untouched, bucket(2, [])];
    const after = moveTasksToBucket(before, [9], 2, STAMP);
    expect(after[0]).toBe(untouched);
    expect(after[1].localModifiedAt).toBe(STAMP);
  });

  it("dedupes repeated ids in the input", () => {
    const after = moveTasksToBucket([bucket(1, [])], [7, 7], 1, STAMP);
    expect(after[0].taskIds).toEqual([7]);
  });

  it("removes a duplicate link from the other bucket while leaving the target untouched", () => {
    const target = bucket(2, [7]);
    const after = moveTasksToBucket([bucket(1, [7]), target], [7], 2, STAMP);
    expect(after[0].taskIds).toEqual([]);
    expect(after[1]).toBe(target);
  });
});
