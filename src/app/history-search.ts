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
//   converting "last week" into a date is the model's job. Both bounds are
//   inclusive of their whole day.
//
// ★★★ THE DAY BOUNDS ARE THE PROJECT'S DAYS, NOT UTC'S — and a timezone is
//   DATA here, not a clock: the engine converts a caller-supplied instant into
//   a caller-supplied zone and still never reads the current time. It used to
//   compare `entry.timestamp.slice(0, 10)`, the UTC date, while BOTH of the
//   other surfaces the same instant appears on are project-zone: the model is
//   told `Today is <todayInZone(now, effectiveTz)>` and the Activity panel
//   renders each row with `formatDisplayTimestamp`. In Berlin (UTC+2) an edit
//   made at 00:30 local is stamped 22:30Z the previous day, so the panel filed
//   it under the 17th and "what changed today" on the 17th missed it; in US
//   Pacific (UTC−7) everything after 17:00 local fell into TOMORROW and
//   vanished from the same question — silently, with `truncated: false`.
import type { ActivityEntry } from "./activity-log";
import { type RenderedActivity, renderActivityEntry } from "./activity-prompt";
import { dayInZone, isoInZone } from "./timezone";

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
  /** ★ `at` is NOT `renderActivityEntry`'s verbatim UTC stamp — this engine
   *  rewrites it into the project zone's offset-bearing form. Filtering on
   *  local days while handing the model a UTC clock is a half-fix: it would
   *  quote "22:30 on the 16th" to a Berlin user whose panel says "00:30 on the
   *  17th". Same instant either way, but only one of them agrees with the
   *  screen the user is looking at. */
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

/**
 * ★★ `tz` is a THIRD PARAMETER, deliberately not a `HistoryQuery` field.
 * `HistoryQuery` is the model's filter object, parsed straight out of a tool
 * call; the timezone is project configuration the model neither supplies nor
 * should be able to override — a model that could pass its own zone could
 * shift every day boundary out from under the `Today is …` date it was given.
 */
export function searchHistory(
  entries: readonly ActivityEntry[],
  q: HistoryQuery,
  tz: string,
): HistoryResult {
  const kinds = q.kinds && q.kinds.length > 0 ? new Set(q.kinds) : null;
  const needle = q.query?.trim().toLowerCase();
  const bounded = !!(q.since || q.until);

  const matched: RenderedActivity[] = [];
  for (const entry of entries) {
    if (kinds && !kinds.has(entry.kind)) continue;
    if (bounded) {
      // ★ Only converted when a bound was asked for — an Intl format per entry
      //   over a 500-entry log is not worth paying for an unbounded search.
      //   ★★ An unparseable timestamp has NO day, so it cannot satisfy a bound
      //   and is dropped rather than compared as a raw string: `"whenever"`
      //   sorts above every `2026-…` date, so the old prefix compare silently
      //   admitted it to any `since` range.
      const day = dayInZone(entry.timestamp, tz);
      if (day === null) continue;
      if (q.since && day < q.since) continue;
      if (q.until && day > q.until) continue;
    }

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
  // ★★★ AND IT MUST RUN ON THE RAW UTC STAMP, WHICH IS WHY THE ZONE CONVERSION
  //   BELOW COMES AFTER THE SLICE. Lexicographic compare only tracks real time
  //   while every string shares one offset, and a DST transition breaks exactly
  //   that: Berlin's 2026-10-25 renders 00:30Z as `02:30:00+02:00` and the
  //   LATER 01:30Z as `02:30:00+01:00`, which sorts the older one first.
  matched.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const limit = resolveLimit(q.limit);
  // ★ Converting only the surviving page keeps the cost off the entries the cap
  //   is about to discard.
  const page = matched.slice(0, limit).map((e) => ({ ...e, at: isoInZone(e.at, tz) }));
  return { events: page, truncated: matched.length > limit };
}

export const RECAP_WINDOW_DAYS = 7;

export interface ActivitySummary {
  total: number;
  byActor: { user: number; ai: number; integration: number; unknown: number };
  /** The newest matching entry's RAW UTC timestamp. ★ Never the offset-bearing
   *  form — the renderer converts. Comparing offset strings across a DST
   *  transition orders them wrongly, which is the trap `searchHistory`
   *  documents at length. */
  latestAt: string;
  /** The window this summary actually counted, in days.
   *  ★★ CARRIED, NOT RE-DERIVED BY THE RENDERER. `days` below is overridable,
   *  so a renderer importing `RECAP_WINDOW_DAYS` would tell the model "in the
   *  last 7 days" about a 30-day count the moment any caller passed something
   *  else. One value, one source — the drift is impossible rather than merely
   *  unlikely (no caller passes a non-default window today). */
  days: number;
}

/**
 * Counts activity in the trailing `days`-day window ending on `today`,
 * inclusive of today, split by actor.
 *
 * ★ NO CLOCK. `today` and `tz` are parameters, matching `searchHistory` — so
 *   this is immune to the calendar-rollover class that detonates date-dependent
 *   tests on the morning the fixture date arrives (open-followups §149).
 *
 * ★ Returns null rather than a zeroed summary when nothing matched, so the
 *   caller omits the prompt block entirely and a quiet project costs nothing.
 */
export function summarizeRecentActivity(
  entries: readonly ActivityEntry[],
  today: string,
  tz: string,
  days: number = RECAP_WINDOW_DAYS,
): ActivitySummary | null {
  // ★ `days - 1`: the window INCLUDES today, so 7 days is today plus 6 prior.
  const start = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const since = start.toISOString().slice(0, 10);

  const byActor = { user: 0, ai: 0, integration: 0, unknown: 0 };
  let total = 0;
  let latestAt = "";

  for (const entry of entries) {
    // ★★ The entry's day IN THE PROJECT ZONE, not UTC's. In Berlin an edit at
    //    00:30 local is stamped 22:30Z the previous day; filing it under UTC's
    //    day disagrees with both the Activity panel and the `Today is …` date
    //    the model is given.
    const day = dayInZone(entry.timestamp, tz);
    if (day === null || day < since || day > today) continue;
    total += 1;
    // ★ Own-property guard, never a bare index: the sanitizer KEEPS an
    //   unknown-but-string actor, so `actor: "toString"` reaches here and a
    //   bare `byActor[actor]` would resolve a Function.prototype method.
    const actor = entry.actor;
    if (actor !== undefined && Object.prototype.hasOwnProperty.call(byActor, actor)) {
      byActor[actor as keyof typeof byActor] += 1;
    } else {
      byActor.unknown += 1;
    }
    // ★ Seeded `""`, which every real `toISOString()` stamp sorts above — so a
    //   positive `total` can never carry an empty `latestAt`.
    if (entry.timestamp > latestAt) latestAt = entry.timestamp;
  }

  return total === 0 ? null : { total, byActor, latestAt, days };
}
