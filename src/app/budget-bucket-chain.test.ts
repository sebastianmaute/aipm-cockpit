import { describe, it, expect } from "vitest";
import { resolveBucketChain } from "./budget-bucket-chain";
import type { BudgetBucket } from "./types";

const bucket = (over: Partial<BudgetBucket> & { id: number }): BudgetBucket => ({
  name: `B${over.id}`,
  type: "tm",
  currency: "EUR",
  startDate: "2026-01-01",
  endDate: "2026-03-31",
  status: "open",
  allocations: [],
  ...over,
} as BudgetBucket);

describe("resolveBucketChain", () => {
  it("spans a single bucket", () => {
    const r = resolveBucketChain([bucket({ id: 1, startDate: "2026-02-01", endDate: "2026-04-30" })]);
    expect(r).toEqual({ kind: "chain", start: "2026-02-01", end: "2026-04-30", order: [1] });
  });

  it("spans a two-bucket chain from the first start to the last end", () => {
    const r = resolveBucketChain([
      bucket({ id: 1, startDate: "2026-01-01", endDate: "2026-03-31", successorId: 2 }),
      bucket({ id: 2, startDate: "2026-04-01", endDate: "2026-06-30" }),
    ]);
    expect(r).toEqual({ kind: "chain", start: "2026-01-01", end: "2026-06-30", order: [1, 2] });
  });

  it("uses min start / max end, not walk order", () => {
    const r = resolveBucketChain([
      bucket({ id: 1, startDate: "2026-05-01", endDate: "2026-06-30", successorId: 2 }),
      bucket({ id: 2, startDate: "2026-01-01", endDate: "2026-02-28" }),
    ]);
    expect(r).toMatchObject({ kind: "chain", start: "2026-01-01", end: "2026-06-30" });
  });

  it("reports multiple roots with their names", () => {
    const r = resolveBucketChain([bucket({ id: 1, name: "Phase 1" }), bucket({ id: 2, name: "Phase 2" })]);
    expect(r).toEqual({
      kind: "broken",
      reason: "multiple-roots",
      offenders: [{ id: 1, name: "Phase 1" }, { id: 2, name: "Phase 2" }],
    });
  });

  it("reports a bucket unreachable from the root", () => {
    const r = resolveBucketChain([
      bucket({ id: 1, successorId: 2 }),
      bucket({ id: 2, successorId: 1 }),
      bucket({ id: 3, name: "Orphan" }),
    ]);
    // 1 and 2 point at each other, so 3 is the only root; 1 and 2 are unreached.
    expect(r).toMatchObject({ kind: "broken", reason: "unreachable" });
    expect((r as { offenders: readonly { id: number }[] }).offenders.map((o) => o.id)).toEqual([1, 2]);
  });

  it("reports a cycle when every bucket is someone's successor", () => {
    const r = resolveBucketChain([bucket({ id: 1, successorId: 2 }), bucket({ id: 2, successorId: 1 })]);
    expect(r).toMatchObject({ kind: "broken", reason: "cycle" });
  });

  it("refuses to trim when any bucket has no dates", () => {
    const r = resolveBucketChain([
      bucket({ id: 1, successorId: 2 }),
      bucket({ id: 2, name: "Undated", startDate: "", endDate: "" }),
    ]);
    expect(r).toEqual({ kind: "broken", reason: "missing-dates", offenders: [{ id: 2, name: "Undated" }] });
  });

  it("treats a self-reference and a dangling successor as the end of the walk", () => {
    expect(resolveBucketChain([bucket({ id: 1, successorId: 1 })])).toMatchObject({ kind: "chain", order: [1] });
    expect(resolveBucketChain([bucket({ id: 1, successorId: 99 })])).toMatchObject({ kind: "chain", order: [1] });
  });

  it("reports a cycle that closes downstream of a real root", () => {
    // root(1) is nobody's successor, so the roots.length===0 pre-check does not
    // fire; the loop 2 -> 3 -> 2 is only caught by the in-walk revisit guard.
    const r = resolveBucketChain([
      bucket({ id: 1, name: "Root", successorId: 2 }),
      bucket({ id: 2, name: "A", successorId: 3 }),
      bucket({ id: 3, name: "B", successorId: 2 }),
    ]);
    expect(r).toMatchObject({ kind: "broken", reason: "cycle" });
    // Only the loop members — bucket 1 is upstream of the loop, not part of it.
    expect((r as { offenders: readonly { id: number }[] }).offenders.map((o) => o.id)).toEqual([2, 3]);
  });

  it("returns broken for an empty list", () => {
    expect(resolveBucketChain([])).toEqual({ kind: "broken", reason: "unreachable", offenders: [] });
  });
});
