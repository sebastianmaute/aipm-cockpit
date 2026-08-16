// PURE ENGINE over the activity log: filter → sort → cap.
//
// ★★ i18n-FREE BY CONTRACT. It receives already-rendered lines from
//    `activity-prompt.ts` (the render layer) and must never import `t` itself.
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

/** Absent / non-finite / non-positive → the default; anything larger than the
 *  hard maximum is clamped. Fractional limits floor, so `2.9` caps at 2. */
function resolveLimit(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return DEFAULT_HISTORY_LIMIT;
  return Math.min(Math.floor(raw), MAX_HISTORY_LIMIT);
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
