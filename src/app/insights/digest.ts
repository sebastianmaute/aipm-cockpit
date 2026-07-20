// Pure, i18n-free. Derives a rolling-window digest from the lifecycle
// timestamps SP1-SP3 already persist. No clock in this module — `today` is
// passed in. Adds NO persisted field: everything here is derivation.
import type { Insight } from "./insight";

export const DIGEST_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;
/** ~10 years. Anything beyond is nonsense, and a large enough value overflows
 *  the Date range and throws. */
const MAX_WINDOW_DAYS = 3650;

export interface InsightDigest {
  readonly windowDays: number;
  readonly from: string;
  readonly to: string;
  readonly firedCount: number;
  readonly actedCount: number;
  readonly wins: readonly Insight[];
  readonly regressions: readonly Insight[];
  readonly openNow: number;
  readonly isEmpty: boolean;
}

/** A bare YYYY-MM-DD. In-app every lifecycle stamp is exactly that, but
 *  sanitizeInsights admits up to 40 chars from an imported blob — slice before
 *  the lexicographic compare so a longer ISO string still lands in its day. */
function dayOf(v: string | undefined): string | null {
  if (typeof v !== "string") return null;
  const s = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function emptyDigest(windowDays: number, from: string, to: string): InsightDigest {
  return {
    windowDays, from, to,
    firedCount: 0, actedCount: 0,
    wins: [], regressions: [],
    openNow: 0, isEmpty: true,
  };
}

export function computeInsightDigest(
  insights: readonly Insight[],
  today: string,
  windowDays?: number,
): InsightDigest {
  const days =
    typeof windowDays === "number" && Number.isFinite(windowDays) && windowDays > 0
      ? // Capped: `new Date(ms).toISOString()` THROWS RangeError once the offset
        // leaves the ±8.64e15 ms Date range, and emits a malformed negative-year
        // string well before that. This engine's contract is "never throws".
        Math.min(Math.floor(windowDays), MAX_WINDOW_DAYS)
      : DIGEST_WINDOW_DAYS;
  const to = dayOf(today);
  if (to === null) return emptyDigest(days, "", "");
  // UTC-midnight parse (the bucketMilestonesByHorizon pattern) — never `new Date()` of now.
  const toMs = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(toMs)) return emptyDigest(days, "", to);
  // Inclusive of BOTH ends: a 7-day window is today plus the 6 prior days.
  const from = new Date(toMs - (days - 1) * DAY_MS).toISOString().slice(0, 10);

  const inWindow = (v: string | undefined): boolean => {
    const d = dayOf(v);
    // Future-dated is EXCLUDED: a clock-skewed or imported record must not
    // inflate "this week".
    return d !== null && d >= from && d <= to;
  };

  let firedCount = 0;
  let actedCount = 0;
  let openNow = 0;
  const wins: Insight[] = [];
  const regressions: Insight[] = [];

  for (const i of insights) {
    if (inWindow(i.firstSeenAt)) firedCount++;
    if (inWindow(i.actedAt)) actedCount++;
    // "Open" MUST mean what the panel's list means. That list hides only the
    // TERMINAL statuses, so an `acted` record renders in it — and an
    // acted-but-not-yet-measured insight is the normal steady state of the SP3
    // outcome flow. Counting only active+acknowledged would print "2 open now"
    // directly above three visible rows.
    if (i.status !== "dismissed" && i.status !== "resolved") openNow++;
    // A win CLAIMS things got better, so gate on the direction, not merely on
    // "has an outcome". Otherwise a resolved+worsened record renders under
    // "Resolved after you acted" carrying a red dot reading "Worsened by 5" —
    // one row asserting both directions at once, and an inflated win count.
    // In-app this is a no-op (computeClearedOutcome always writes "improved"),
    // but sanitizeOutcome RE-DERIVES direction from baseline/current, so an
    // imported blob reaches the contradictory shape. Gating here also keeps the
    // two buckets exclusive BY CONSTRUCTION rather than by a status guard.
    if (i.status === "resolved" && i.outcome?.direction === "improved" && inWindow(i.resolvedAt)) {
      wins.push(i);
    }
    // Gated on measuredAt, not on `acted`: a worsened outcome is a live
    // measurement on a still-firing record, and a months-old one is not "this
    // week". `resolved` IS excluded though — the condition cleared, so it is a
    // win, and without this guard a resolved+worsened record would be counted
    // in BOTH buckets, inflating the digest in two directions at once. In-app
    // that shape is unreachable (computeClearedOutcome always writes
    // "improved"), but sanitizeInsights RE-DERIVES direction from
    // baseline/current and will admit it from an imported or edited blob.
    if (
      i.status !== "resolved" &&
      i.outcome?.direction === "worsened" &&
      inWindow(i.outcome.measuredAt)
    ) {
      regressions.push(i);
    }
  }

  // Date descending, id ascending as the tiebreak. Date strings compare
  // lexicographically — no Date construction needed.
  const byDateDesc = (aDate: string, bDate: string, aId: number, bId: number): number => {
    if (aDate !== bDate) return aDate < bDate ? 1 : -1;
    return aId - bId;
  };
  wins.sort((a, b) => byDateDesc(a.resolvedAt ?? "", b.resolvedAt ?? "", a.id, b.id));
  regressions.sort((a, b) =>
    byDateDesc(a.outcome?.measuredAt ?? "", b.outcome?.measuredAt ?? "", a.id, b.id));

  return {
    windowDays: days, from, to,
    firedCount, actedCount, wins, regressions, openNow,
    isEmpty:
      firedCount === 0 && actedCount === 0 && openNow === 0 &&
      wins.length === 0 && regressions.length === 0,
  };
}
