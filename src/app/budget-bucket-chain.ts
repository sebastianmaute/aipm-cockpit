// Pure, i18n-free resolution of the budget buckets' `successorId` chain. Feeds
// the burn-down x-axis so it spans the real budget window instead of the whole
// resource-plan range — and, when the buckets are NOT one chain, says so instead
// of silently drawing a misleading span.
//
// No React, no I/O, no clock read. `successorId`'s only other consumer,
// computeSpillover (budget-report.ts), is a single-hop CLOSED-bucket transfer and
// is deliberately untouched: a chain of open buckets is still a chain.
//
// ★ Because the field is SHARED with that spillover feature, this module cannot
// tell a spillover link from a chain declaration — a closed bucket pointing at
// its successor is exactly what a real "phase 1 done, phase 2 next" chain looks
// like. So a project using spillover alone still reads as a half-built chain.
// Special-casing closed buckets out of the intent gate below would silence that,
// but it would ALSO stop trimming for the commonest legitimate chain there is,
// so it is deliberately not done. See the `unchained` note.
import type { BudgetBucket } from "./types";

export type BucketRef = { id: number; name: string };

export type BucketChainBreak =
  | "multiple-roots" | "cycle" | "unreachable" | "missing-dates" | "dangling" | "outside-plan";

export type BucketChain =
  | { kind: "chain"; start: string; end: string; order: readonly number[] }
  // No bucket has a successorId set at all: parallel workstream buckets are the normal
  // budget model, not a mistake. Behaves like `broken` (full plan span, no trim)
  // but is NOT warned about — see the intent rule in resolveBucketChain.
  | { kind: "unchained" }
  | { kind: "broken"; reason: BucketChainBreak; offenders: readonly BucketRef[] };

const ref = (b: BudgetBucket): BucketRef => ({ id: b.id, name: b.name });

/** Resolve the buckets into one connected successor chain, or explain why not.
 *
 *  `planRange` (the resource plan's own window) is optional and only used to
 *  reject a chain that cannot be drawn on the plan axis at all — see the
 *  "outside-plan" branch. */
export function resolveBucketChain(
  buckets: readonly BudgetBucket[],
  planRange?: { start: string; end: string },
): BucketChain {
  if (buckets.length === 0) return { kind: "broken", reason: "unreachable", offenders: [] };

  const byId = new Map(buckets.map((b) => [b.id, b] as const));
  const isSuccessor = new Set<number>();
  for (const b of buckets) {
    const s = b.successorId;
    if (s != null && s !== b.id && byId.has(s)) isSuccessor.add(s);
  }

  // ★★ INTENT GATE, and it runs before every other check: `successorId` is
  // OPTIONAL and parallel workstream buckets are the ordinary budget model.
  // Treating "nobody chained anything" as a break bannered such a project — on
  // two surfaces — to fix something that was never broken. With no intent there
  // is nothing to trim, so nothing to
  // explain either: full plan span, silently. It also subsumes missing-dates,
  // whose only job is to stop a trim that was never going to happen.
  // ★ Intent is "a successor was TYPED", not "a successor resolves": a link
  // pointing at a deleted bucket is broken intent, and the whole point of the
  // "dangling" branch below is to say so. Reading intent off `isSuccessor`
  // (resolvable links only) would swallow exactly that case as `unchained`.
  // A self-reference conveys no ordering, so it does not count.
  const hasIntent = buckets.some((b) => b.successorId != null && b.successorId !== b.id);
  if (!hasIntent && buckets.length > 1) return { kind: "unchained" };

  // ★ Load-bearing guard: a bucket without both dates claims EVERY plan period
  // (bucketActivePeriods, budget-report.ts:21), so a trimmed axis would drop
  // hours the report still counts. Refuse to trim rather than under-report.
  // Reached only WITH intent, and then it still wins over everything below.
  const undated = buckets.filter((b) => !b.startDate || !b.endDate);
  if (undated.length > 0) return { kind: "broken", reason: "missing-dates", offenders: undated.map(ref) };

  // A successorId pointing at a bucket that no longer exists (import / CSV / MD /
  // Turso — sanitizeBudgetBucket only checks `> 0` and `!== id`) never enters
  // `isSuccessor`, so without this it surfaced as "multiple-roots" and told the
  // user to set a successor that IS already set. Only meaningful with siblings:
  // a lone bucket resolves to its own window regardless, hiding nothing.
  if (buckets.length > 1) {
    const dangling = buckets.filter(
      (b) => b.successorId != null && b.successorId !== b.id && !byId.has(b.successorId),
    );
    if (dangling.length > 0) return { kind: "broken", reason: "dangling", offenders: dangling.map(ref) };
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
    if (seen.has(cur.id)) {
      // Report ONLY the buckets in the loop, not the whole walked prefix: the
      // offenders are rendered as a user-facing "these form a loop" list, and
      // naming an innocent upstream bucket sends the user to fix the wrong link.
      const revisitedId = cur.id;
      const loopStart = walked.findIndex((b) => b.id === revisitedId);
      return { kind: "broken", reason: "cycle", offenders: walked.slice(loopStart).map(ref) };
    }
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

  // ★ A perfectly valid chain dated entirely outside the plan (buckets moved to
  // next year, plan not extended) selects no period, so the burn-down falls back
  // to the full plan axis — silently, because a `chain` result warns about
  // nothing. That is exactly the misleading span this module exists to prevent,
  // so say it here, where the plan window is visible.
  if (planRange && (end < planRange.start || start > planRange.end)) {
    return { kind: "broken", reason: "outside-plan", offenders: buckets.map(ref) };
  }
  return { kind: "chain", start, end, order: walked.map((b) => b.id) };
}
