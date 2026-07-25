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

  it("reports multiple roots with their names — but only once an OPEN bucket IS chained", () => {
    // Bucket 3 -> 4 is the intent that makes "not one chain" a real complaint;
    // without it these are ordinary parallel buckets (see the unchained tests).
    const r = resolveBucketChain([
      bucket({ id: 1, name: "Phase 1" }),
      bucket({ id: 2, name: "Phase 2" }),
      bucket({ id: 3, name: "Phase 3", successorId: 4 }),
      bucket({ id: 4, name: "Phase 4" }),
    ]);
    expect(r).toEqual({
      kind: "broken",
      reason: "multiple-roots",
      offenders: [{ id: 1, name: "Phase 1" }, { id: 2, name: "Phase 2" }, { id: 3, name: "Phase 3" }],
    });
  });

  it("returns unchained — not a break — when nobody set a successor", () => {
    // Parallel workstream buckets are the normal budget model (the shipped
    // sample workspace chains nothing), so this must not warn.
    const r = resolveBucketChain([bucket({ id: 1, name: "Phase 1" }), bucket({ id: 2, name: "Phase 2" })]);
    expect(r).toEqual({ kind: "unchained" });
  });

  it("treats a CLOSED bucket's successor as spillover, not as a chain declaration", () => {
    // The shipped sample's exact shape: a closed "Discovery Phase" spilling into
    // bucket 1, everything else a parallel workstream. `successorId` is shared
    // with computeSpillover, so counting this as chain intent bannered the demo.
    const r = resolveBucketChain([
      bucket({ id: 1, name: "T&M" }),
      bucket({ id: 2, name: "Retainer" }),
      bucket({ id: 3, name: "Fixed price" }),
      bucket({ id: 4, name: "Discovery", status: "closed", successorId: 1 }),
    ]);
    expect(r).toEqual({ kind: "unchained" });
  });

  it("still trims a COMPLETE chain that starts at a closed bucket", () => {
    // The case the closed-bucket exclusion must not cost us: "phase 1 done,
    // phase 2 next" is the commonest real chain there is. A complete chain is
    // returned regardless of intent, so it trims exactly as before.
    const r = resolveBucketChain([
      bucket({ id: 1, status: "closed", startDate: "2026-01-01", endDate: "2026-03-31", successorId: 2 }),
      bucket({ id: 2, startDate: "2026-04-01", endDate: "2026-06-30" }),
    ]);
    expect(r).toEqual({ kind: "chain", start: "2026-01-01", end: "2026-06-30", order: [1, 2] });
  });

  it("stays silent when only a closed bucket carries a dangling link", () => {
    // A spillover target that no longer exists says nothing about the axis.
    const r = resolveBucketChain([
      bucket({ id: 1 }),
      bucket({ id: 2, status: "closed", successorId: 99 }),
    ]);
    expect(r).toEqual({ kind: "unchained" });
  });

  it("still reports a single bucket as a chain, so its window trims the axis", () => {
    const r = resolveBucketChain([bucket({ id: 1, startDate: "2026-02-01", endDate: "2026-04-30" })]);
    expect(r).toMatchObject({ kind: "chain", start: "2026-02-01", end: "2026-04-30" });
  });

  it("reports a successor that no longer exists as dangling, not as multiple roots", () => {
    // Arrives via import/CSV/MD/Turso — sanitizeBudgetBucket only checks >0 and
    // !== id, and an in-app delete clears successors.
    const r = resolveBucketChain([
      bucket({ id: 1, name: "Phase 1", successorId: 99 }),
      bucket({ id: 2, name: "Phase 2" }),
    ]);
    expect(r).toEqual({ kind: "broken", reason: "dangling", offenders: [{ id: 1, name: "Phase 1" }] });
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

  it("stays silent about an undated bucket when nothing is chained", () => {
    // Nothing was going to be trimmed, so the missing date cannot mislead the
    // axis — reporting it would banner the project over a non-problem.
    const r = resolveBucketChain([
      bucket({ id: 1 }),
      bucket({ id: 2, name: "Undated", startDate: "", endDate: "" }),
    ]);
    expect(r).toEqual({ kind: "unchained" });
  });

  it("still reports an undated bucket once something else IS chained", () => {
    const r = resolveBucketChain([
      bucket({ id: 1, successorId: 3 }),
      bucket({ id: 2, name: "Undated", startDate: "", endDate: "" }),
      bucket({ id: 3 }),
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

  // An empty list is not a BROKEN chain — there is nothing to repair, and a
  // break here would reach the warning banner with an empty offender list.
  it("returns unchained for an empty list", () => {
    expect(resolveBucketChain([])).toEqual({ kind: "unchained" });
  });
});

describe("resolveBucketChain — plan range", () => {
  const chained = [
    bucket({ id: 1, name: "Phase 1", startDate: "2027-01-01", endDate: "2027-03-31", successorId: 2 }),
    bucket({ id: 2, name: "Phase 2", startDate: "2027-04-01", endDate: "2027-06-30" }),
  ];

  it("reports a chain dated entirely outside the plan range", () => {
    // Without this the burn-down's empty-slice fallback draws the whole plan
    // axis under a `chain` result, so nothing warns about the wrong span.
    const r = resolveBucketChain(chained, { start: "2026-01-01", end: "2026-12-31" });
    expect(r).toEqual({
      kind: "broken",
      reason: "outside-plan",
      offenders: [{ id: 1, name: "Phase 1" }, { id: 2, name: "Phase 2" }],
    });
  });

  it("reports a chain ending before the plan starts", () => {
    const r = resolveBucketChain(chained, { start: "2028-01-01", end: "2028-12-31" });
    expect(r).toMatchObject({ kind: "broken", reason: "outside-plan" });
  });

  it("keeps a chain that overlaps the plan range even partially", () => {
    const r = resolveBucketChain(chained, { start: "2027-06-01", end: "2027-12-31" });
    expect(r).toMatchObject({ kind: "chain", start: "2027-01-01", end: "2027-06-30" });
  });

  it("keeps a chain when no plan range is supplied", () => {
    expect(resolveBucketChain(chained)).toMatchObject({ kind: "chain" });
  });
});
