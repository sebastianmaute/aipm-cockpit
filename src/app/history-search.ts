// PURE ENGINE over the activity log: filter → sort → cap.
//
// ★★ i18n-FREE BY CONTRACT — but NOT render-free: it takes raw entries and
//    calls `renderActivityEntry` itself, because the substring search has to
//    run over the rendered `summary` + `detail`. What it must never do is
//    import `t`; all translation happens inside the render layer it calls.
//    Do NOT "restore the split" by making the caller pass rendered lines —
//    the engine would then be unable to filter on message text at all.
//
// ★ No clock. `since`/`until` are absolute ISO dates supplied by the caller;
//   converting "last week" into a date is the model's job. Comparison is a
//   date-part prefix compare, so both bounds are inclusive of their whole day.
import type { ActivityEntry } from "./activity-log";
import { type RenderedActivity, renderActivityEntry } from "./activity-prompt";

export const DEFAULT_HISTORY_LIMIT = 50;
export const MAX_HISTORY_LIMIT = 200;

export interface HistoryQuery {
  query?: string;
  /** Inclusive lower bound, `YYYY-MM-DD`. */
  since?: string;
  /** Inclusive upper bound, `YYYY-MM-DD`. */
  until?: string;
  /** ★ `string`, not `ActivityKind`: the caller is a model and may send any
   *  string. An unknown kind simply matches nothing — never a type error. */
  kinds?: readonly string[];
  limit?: number;
}

export interface HistoryResult {
  events: RenderedActivity[];
  /**
   * ★★ "More matched than you are seeing" — NOT "a limit was applied". The
   * model reasons about this field to decide whether it may claim a complete
   * answer, so a cap that happened to cut nothing must report false.
   */
  truncated: boolean;
}

/**
 * Absent / non-numeric / non-finite → the default; anything above the hard
 * maximum is clamped down to it. Fractional limits FLOOR, so `2.9` caps at 2.
 *
 * ★★★ THE FLOOR HAPPENS BEFORE THE NON-POSITIVE TEST, NOT AFTER, and the order
 * is the whole point. `limit` is model-supplied untrusted input, so `0.5` is
 * reachable — and testing `raw <= 0` first lets it through, after which the
 * floor yields a cap of ZERO. The result is `{ events: [], truncated: true }`:
 * no rows, while asserting that rows were withheld. That is the one output
 * combination that actively misleads the caller, since `truncated` is the field
 * the model reads to decide whether it may claim a complete answer.
 *
 * ★ Falling back to the DEFAULT rather than clamping up to 1: a limit that
 * floors to nothing is a nonsense request, and every other nonsense value here
 * (absent, NaN, -1, 0) already answers with the default. Returning a
 * single-event page instead would make `0.5` the only input whose garbage-ness
 * is silently reinterpreted as a real, very specific instruction.
 *
 * ★ `Infinity` therefore yields the DEFAULT, not MAX_HISTORY_LIMIT — it fails
 * the finite test before it can reach the clamp. Defensible (it is not a
 * number the caller meant) and pinned by a test so it cannot change silently.
 */
function resolveLimit(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_HISTORY_LIMIT;
  const whole = Math.floor(raw);
  if (whole <= 0) return DEFAULT_HISTORY_LIMIT;
  return Math.min(whole, MAX_HISTORY_LIMIT);
}

export function searchHistory(
  entries: readonly ActivityEntry[],
  q: HistoryQuery,
): HistoryResult {
  const kinds = q.kinds && q.kinds.length > 0 ? new Set(q.kinds) : null;
  const needle = q.query?.trim().toLowerCase();

  const matched: RenderedActivity[] = [];
  for (const entry of entries) {
    if (kinds && !kinds.has(entry.kind)) continue;
    const day = entry.timestamp.slice(0, 10);
    if (q.since && day < q.since) continue;
    if (q.until && day > q.until) continue;

    // ★ Render AFTER the cheap structural filters — rendering interpolates a
    //   string per entry, and the log is capped at ACTIVITY_MAX_ENTRIES (500).
    const rendered = renderActivityEntry(entry);
    if (needle) {
      const hay = `${rendered.summary} ${rendered.detail ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) continue;
    }
    matched.push(rendered);
  }

  // ★ Sort BEFORE the cap, so the cap keeps the NEWEST matches. Lexicographic
  //   compare on the ISO timestamp, which is what `mergeActivityLogs` uses.
  matched.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const limit = resolveLimit(q.limit);
  return { events: matched.slice(0, limit), truncated: matched.length > limit };
}
