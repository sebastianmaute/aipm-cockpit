// Pure, i18n-free resolution of the budget buckets' `successorId` chain. Feeds
// the burn-down x-axis so it spans the real budget window instead of the whole
// resource-plan range — and, when the buckets are NOT one chain, says so instead
// of silently drawing a misleading span.
//
// No React, no I/O, no clock read. `successorId`'s only other consumer,
// computeSpillover (budget-report.ts), is a single-hop CLOSED-bucket transfer and
// is deliberately untouched: a chain of open buckets is still a chain.
//
// ★★ The intent gate below gates the WARNING, not the TRIM, and that split is
// what makes the shared field workable. A CLOSED bucket's `successorId` is a
// spillover declaration, so it does not count as chain intent — otherwise every
// project using spillover alone (including the shipped sample) reads as a
// half-built chain and banners forever. The case that costs nothing to give up:
// a real "phase 1 (closed) → phase 2" pair resolves to a COMPLETE chain, and a
// complete chain is returned regardless of intent, so it still trims exactly as
// before. Only BREAKS are filtered by intent.
import type { BudgetBucket } from "./types";

export type BucketRef = { id: number; name: string };

export type BucketChainBreak =
  | "multiple-roots" | "cycle" | "unreachable" | "missing-dates" | "dangling" | "outside-plan";

export type BucketChain =
  | { kind: "chain"; start: string; end: string; order: readonly number[] }
  // The buckets do not form one chain, but nobody DECLARED one either, so there
  // is nothing to repair: parallel workstream buckets are the normal budget
  // model. Behaves like `broken` (full plan span, no trim) but is NOT warned
  // about — see the intent gate in resolveBucketChain.
  | { kind: "unchained" }
  | { kind: "broken"; reason: BucketChainBreak; offenders: readonly BucketRef[] };

const ref = (b: BudgetBucket): BucketRef => ({ id: b.id, name: b.name });

/** A chain result before the intent gate: either it resolves or it explains why not. */
type ChainOutcome = Exclude<BucketChain, { kind: "unchained" }>;

/** Did the user DECLARE an ordering? A successor typed on an OPEN bucket is a
 *  chain declaration; the same field on a CLOSED bucket is the pre-existing
 *  single-hop spillover transfer (computeSpillover), which says nothing about
 *  how the burn-down axis should be trimmed. A self-reference conveys no
 *  ordering either. ★ Intent is "typed", not "resolves": a link pointing at a
 *  deleted bucket is BROKEN intent, and reporting it is the whole point of the
 *  "dangling" break — reading intent off resolvable links only would swallow
 *  exactly that case. */
function hasChainIntent(buckets: readonly BudgetBucket[]): boolean {
  return buckets.some((b) => b.status !== "closed" && b.successorId != null && b.successorId !== b.id);
}

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

  const outcome = analyseChain(buckets, planRange);
  // ★★ INTENT GATES THE WARNING, NOT THE TRIM.
  // A COMPLETE chain is returned whatever the user intended — buckets that
  // happen to form one still trim the axis correctly, and there is nothing to
  // warn about, so intent is irrelevant. Only a BREAK is filtered: nagging
  // someone to repair a chain they never declared is the false alarm this gate
  // exists to stop (parallel workstream buckets are the ordinary budget model).
  if (outcome.kind === "chain" || hasChainIntent(buckets)) return outcome;
  return { kind: "unchained" };
}

function analyseChain(
  buckets: readonly BudgetBucket[],
  planRange?: { start: string; end: string },
): ChainOutcome {
  const byId = new Map(buckets.map((b) => [b.id, b] as const));
  const isSuccessor = new Set<number>();
  for (const b of buckets) {
    const s = b.successorId;
    if (s != null && s !== b.id && byId.has(s)) isSuccessor.add(s);
  }

  // ★ Load-bearing guard: a bucket without both dates claims EVERY plan period
  // (bucketActivePeriods, budget-report.ts:21), so a trimmed axis would drop
  // hours the report still counts. Refuse to trim rather than under-report.
  // (With no chain intent the gate downgrades this to `unchained` — nothing was
  // going to be trimmed, so there is no under-reporting to prevent.)
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
