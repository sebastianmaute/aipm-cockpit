// Pure, i18n-free resolution of the budget buckets' `successorId` chain. Feeds
// the burn-down x-axis so it spans the real budget window instead of the whole
// resource-plan range — and, when the buckets are NOT one chain, says so instead
// of silently drawing a misleading span.
//
// No React, no I/O, no clock read. `successorId`'s only other consumer,
// computeSpillover (budget-report.ts), is a single-hop CLOSED-bucket transfer and
// is deliberately untouched: a chain of open buckets is still a chain.
import type { BudgetBucket } from "./types";

export type BucketRef = { id: number; name: string };

export type BucketChainBreak = "multiple-roots" | "cycle" | "unreachable" | "missing-dates";

export type BucketChain =
  | { kind: "chain"; start: string; end: string; order: readonly number[] }
  | { kind: "broken"; reason: BucketChainBreak; offenders: readonly BucketRef[] };

const ref = (b: BudgetBucket): BucketRef => ({ id: b.id, name: b.name });

/** Resolve the buckets into one connected successor chain, or explain why not. */
export function resolveBucketChain(buckets: readonly BudgetBucket[]): BucketChain {
  if (buckets.length === 0) return { kind: "broken", reason: "unreachable", offenders: [] };

  // ★ Load-bearing guard: a bucket without both dates claims EVERY plan period
  // (bucketActivePeriods, budget-report.ts:21), so a trimmed axis would drop
  // hours the report still counts. Refuse to trim rather than under-report.
  const undated = buckets.filter((b) => !b.startDate || !b.endDate);
  if (undated.length > 0) return { kind: "broken", reason: "missing-dates", offenders: undated.map(ref) };

  const byId = new Map(buckets.map((b) => [b.id, b] as const));
  const isSuccessor = new Set<number>();
  for (const b of buckets) {
    const s = b.successorId;
    if (s != null && s !== b.id && byId.has(s)) isSuccessor.add(s);
  }

  const roots = buckets.filter((b) => !isSuccessor.has(b.id));
  // No root at all means every bucket is someone's successor — only possible
  // when the links close a loop.
  if (roots.length === 0) return { kind: "broken", reason: "cycle", offenders: buckets.map(ref) };
  if (roots.length > 1) return { kind: "broken", reason: "multiple-roots", offenders: roots.map(ref) };

  const walked: BudgetBucket[] = [];
  const seen = new Set<number>();
  let cur: BudgetBucket | undefined = roots[0];
  while (cur) {
    if (seen.has(cur.id)) return { kind: "broken", reason: "cycle", offenders: walked.map(ref) };
    seen.add(cur.id);
    walked.push(cur);
    // Annotated because `cur` is reassigned from `next` below — without it TS
    // sees a circular initializer (TS7022) and falls back to `any`.
    const next: number | null | undefined = cur.successorId;
    // A self-reference or a dangling id ends the walk, mirroring computeSpillover's
    // tolerance; anything left unreached surfaces as "unreachable" below.
    cur = next != null && next !== cur.id ? byId.get(next) : undefined;
  }

  const missed = buckets.filter((b) => !seen.has(b.id));
  if (missed.length > 0) return { kind: "broken", reason: "unreachable", offenders: missed.map(ref) };

  let start = walked[0].startDate;
  let end = walked[0].endDate;
  for (const b of walked) {
    if (b.startDate < start) start = b.startDate;
    if (b.endDate > end) end = b.endDate;
  }
  return { kind: "chain", start, end, order: walked.map((b) => b.id) };
}
