// Pure recurrence expansion engine for the Resource Calendar. Turns a stored
// CalendarEvent (a single date, optionally with a RecurrenceRule + a list of
// per-instance EventException overrides) into the concrete occurrences that
// fall within a caller-supplied window.
//
// Pure, i18n-free, CLOCK-FREE: the window is always passed in, never derived
// from `new Date()`/`Date.now()`. This is both a react-hooks purity
// requirement (this runs inside a `useMemo`) and a correctness one — the
// output must be a deterministic function of (event, windowStart, windowEnd).
// Never throws: a malformed event or window degrades to an empty result.

import { WEEKDAYS } from "./calendar-event";
import type { CalendarEvent, EventException, RecurrenceRule, Weekday } from "./calendar-event";
import { addDays, iso, parseUtc } from "./calendar-window";

export interface Occurrence {
  eventId: number;
  /** Date this occurrence renders on — the MOVED date, when an exception
   *  relocated it. */
  date: string;
  /** Wall-clock start — the moved time, when the move carried one; otherwise
   *  the event's own startTime. */
  time: string;
  durationMinutes: number;
  /** The date the RECURRENCE RULE produced, regardless of any move. This is
   *  the key exceptions are looked up by and the key the future Outlook sync
   *  baseline will use — it never changes when an occurrence is moved. */
  originalDate: string;
  isMoved: boolean;
}

export interface ExpansionResult {
  occurrences: Occurrence[];
  truncated: boolean;
}

/** Hard cap on occurrences a single expansion may return. A series that would
 *  produce more is TRUNCATED — the caller must check `truncated` rather than
 *  infer completeness from the array length; a truncated series must never
 *  look like one that genuinely ends. */
export const MAX_OCCURRENCES = 1000;

/** How far PAST the window we still generate rule dates, so an occurrence a
 *  user MOVED into the visible window is found even though its rule-produced
 *  (original) date falls outside it. A year comfortably covers any realistic
 *  move; it is not itself a completeness guarantee for occurrences that were
 *  never moved (those are governed by the window, not this buffer). */
const GENERATION_BUFFER_DAYS = 366;

/** Hard cap on total rule-candidate iterations actually handed to the
 *  processor — distinct from MAX_OCCURRENCES, which caps only what gets
 *  returned. Guards against a rule that mostly produces excluded/skipped
 *  candidates (e.g. many skip exceptions, or a window far from series start)
 *  looping for a long time before either the window bound or the output cap
 *  above is reached. */
const MAX_ITERATIONS = 20_000;

/** Mon=0 .. Sun=6, matching WEEKDAYS' own order. Exported so the meeting
 *  series editor (calendar-event-modal.tsx) can pre-select an event's own
 *  start weekday in the weekly checkbox row without duplicating this
 *  arithmetic — see the "implicit weekly default" note there. */
export function weekdayIndex(d: Date): number {
  return (d.getUTCDay() + 6) % 7;
}

function positiveInterval(n: number): number {
  const t = Math.trunc(n);
  return Number.isFinite(t) && t > 0 ? t : 1;
}

/** The date of the `ordinal`-th `day` weekday in the given UTC month
 *  (ordinal -1 = the LAST such weekday). Every month has one, so this never
 *  returns null — unlike byMonthDay, which can miss a short month. */
function nthWeekdayOfMonth(
  year: number, monthIndex0: number, day: Weekday, ordinal: 1 | 2 | 3 | 4 | -1,
): Date {
  const targetDow = WEEKDAYS.indexOf(day);
  if (ordinal === -1) {
    const last = new Date(Date.UTC(year, monthIndex0 + 1, 0));
    const back = (weekdayIndex(last) - targetDow + 7) % 7;
    return addDays(last, -back);
  }
  const first = new Date(Date.UTC(year, monthIndex0, 1));
  const forward = (targetDow - weekdayIndex(first) + 7) % 7;
  return addDays(first, forward + (ordinal - 1) * 7);
}

type MonthlyRule = Extract<RecurrenceRule, { freq: "monthly" }>;

/** The candidate date for one calendar month under a monthly rule, or null
 *  when byMonthDay names a day that month doesn't have (e.g. the 31st in
 *  April) — SKIPPED, never clamped to the month's last day; clamping would
 *  invent an occurrence on a date the user never chose.
 *
 *  A null candidate never reaches `sink` (see its per-month call site below),
 *  so — unlike a skip EXCEPTION (handled in `sink`, see its COUNT comment) —
 *  it never consumes a COUNT slot either. The two are easy to read as
 *  contradictory in isolation but model different RFC 5545 concepts: COUNT
 *  bounds what the rule's own generation algorithm produces (a month with no
 *  31st never produces a candidate, so nothing here to spend a slot on), while
 *  EXDATE/skip removes an occurrence the rule DID validly generate (so by the
 *  time a skip exception is checked, that slot is already spent). */
function monthlyCandidate(year: number, monthIndex0: number, rule: MonthlyRule): Date | null {
  if (rule.byDay) return nthWeekdayOfMonth(year, monthIndex0, rule.byDay.day, rule.byDay.ordinal);
  const dom = rule.byMonthDay ?? 1;
  const daysInMonth = new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
  return dom <= daysInMonth ? new Date(Date.UTC(year, monthIndex0, dom)) : null;
}

type Sink = (candidate: Date) => "continue" | "stop";

/** Daily stepping, or weekly-without-byDay (a 7×interval-day step lands on
 *  the series' own start weekday every time). */
function stepDaysLoop(seriesStart: Date, stepDays: number, genEnd: Date, sink: Sink): void {
  let current = seriesStart;
  while (current.getTime() <= genEnd.getTime()) {
    if (sink(current) === "stop") return;
    current = addDays(current, stepDays);
  }
}

/** Weekly with an explicit byDay set: walk week by week (Monday-start, to
 *  match WEEKDAYS), processing only weeks whose offset from the series' own
 *  week is a multiple of `interval` — reached by stepping the outer loop BY
 *  `interval` weeks directly (mirroring monthlyLoop's own `+= rule.interval`
 *  stepping), not by stepping by 1 and filtering. An interval-skipped week is
 *  therefore never visited at all, rather than visited-but-ignored: every
 *  outer pass reaches `sink` (for byDay's >=1 selected weekday), so this
 *  loop is bounded the same way stepDaysLoop and monthlyLoop already are —
 *  a step-by-1-and-filter design would let a large `interval` (clamped up to
 *  52) run far more outer passes than MAX_ITERATIONS implies before an old
 *  seriesStart + a narrow far-future window reaches genEnd, since a filtered
 *  week never reaches `sink` to count against that cap. Emits each selected
 *  weekday in ascending (Mon..Sun) order within a processed week. */
function weeklyByDayLoop(
  seriesStart: Date, interval: number, byDay: readonly Weekday[], genEnd: Date, sink: Sink,
): void {
  const startWeekMonday = addDays(seriesStart, -weekdayIndex(seriesStart));
  const sortedDays = WEEKDAYS.filter((d) => byDay.includes(d));
  let weekOffset = 0;
  for (;;) {
    const weekStart = addDays(startWeekMonday, weekOffset * 7);
    if (weekStart.getTime() > genEnd.getTime()) return;
    for (const d of sortedDays) {
      const candidate = addDays(weekStart, WEEKDAYS.indexOf(d));
      if (candidate.getTime() < seriesStart.getTime() || candidate.getTime() > genEnd.getTime()) continue;
      if (sink(candidate) === "stop") return;
    }
    weekOffset += interval;
  }
}

/** Monthly stepping: advance `interval` calendar months at a time from the
 *  series' own month, carrying year rollover. A month whose candidate is
 *  null (byMonthDay skip) or falls before the series start simply
 *  contributes nothing — the loop still advances.
 *
 *  ★★ `interval` MUST go through `positiveInterval` here, exactly like the
 *  daily/weekly branches already do in `expandOccurrences` — with a raw
 *  `interval: 0` (or `NaN`) the month index never advances, and if that
 *  fixed month also never yields a candidate (e.g. `byMonthDay: 31` while
 *  parked on February, or a NaN month index) `sink` is never reached — so
 *  NEITHER `MAX_ITERATIONS` (which only counts sink calls) NOR the
 *  `monthStart > genEnd` exit (which never becomes true for a month that
 *  never changes) can stop it. That is a synchronous infinite loop: it
 *  freezes the tab, and neither vitest's `testTimeout` nor any caller can
 *  interrupt it. `sanitizeCalendarEvent` clamps interval to [1,52] today, so
 *  this isn't reachable through the app yet — but this module's whole
 *  contract is "a malformed event degrades to an empty result, never
 *  throws/hangs", and a future non-sanitizer source (an Outlook-pulled
 *  recurrence pattern) won't route through that clamp.
 *
 *  The `steps` counter below is a SEPARATE, defense-in-depth bound: once
 *  `interval` is forced positive the month index strictly increases every
 *  pass, so the `monthStart > genEnd` check alone is already enough to
 *  terminate for any realistic input — but `genEnd` only bounds how far
 *  PAST the window this walks, not how far BEFORE it `seriesStart` may sit
 *  (nothing validates that field's year range), so a `byMonthDay` that is
 *  only occasionally satisfied (e.g. 31) combined with a `seriesStart`
 *  centuries in the past could in principle take more month-steps than a
 *  sane cap allows to reach `genEnd`. `markTruncated` is called in that
 *  case for the same reason `sink`'s own MAX_ITERATIONS check does — a
 *  cut-off result must never look like one that genuinely ran to
 *  completion (see the MAX_OCCURRENCES doc comment above). */
function monthlyLoop(
  rule: MonthlyRule, seriesStart: Date, genEnd: Date, sink: Sink, markTruncated: () => void,
): void {
  const interval = positiveInterval(rule.interval);
  let year = seriesStart.getUTCFullYear();
  let monthIndex0 = seriesStart.getUTCMonth();
  let steps = 0;
  for (;;) {
    if (steps++ > MAX_ITERATIONS) { markTruncated(); return; }
    const monthStart = new Date(Date.UTC(year, monthIndex0, 1));
    if (monthStart.getTime() > genEnd.getTime()) return;
    const candidate = monthlyCandidate(year, monthIndex0, rule);
    if (candidate && candidate.getTime() >= seriesStart.getTime() && candidate.getTime() <= genEnd.getTime()) {
      if (sink(candidate) === "stop") return;
    }
    monthIndex0 += interval;
    year += Math.floor(monthIndex0 / 12);
    monthIndex0 = ((monthIndex0 % 12) + 12) % 12;
  }
}

function buildOccurrence(event: CalendarEvent, ruleDateIso: string, exception: EventException | undefined): Occurrence {
  if (exception?.kind === "move") {
    return {
      eventId: event.id,
      date: exception.toDate,
      time: exception.toTime ?? event.startTime,
      durationMinutes: event.durationMinutes,
      originalDate: ruleDateIso,
      isMoved: true,
    };
  }
  return {
    eventId: event.id,
    date: ruleDateIso,
    time: event.startTime,
    durationMinutes: event.durationMinutes,
    originalDate: ruleDateIso,
    isMoved: false,
  };
}

export function expandOccurrences(event: CalendarEvent, windowStart: string, windowEnd: string): ExpansionResult {
  const wStart = parseUtc(windowStart);
  const wEnd = parseUtc(windowEnd);
  if (!wStart || !wEnd || wStart.getTime() > wEnd.getTime()) return { occurrences: [], truncated: false };

  const seriesStart = parseUtc(event.startDate);
  if (!seriesStart) return { occurrences: [], truncated: false };

  const exceptionsByDate = new Map((event.exceptions ?? []).map((e) => [e.date, e] as const));
  const wStartMs = wStart.getTime();
  const wEndMs = wEnd.getTime();
  const rule = event.recurrence;

  const occurrences: Occurrence[] = [];
  let truncated = false;
  let generatedCount = 0;
  let totalProcessed = 0;

  const sink: Sink = (candidate) => {
    totalProcessed += 1;
    if (totalProcessed > MAX_ITERATIONS) {
      // A stop AFTER we walked past wEnd is inside the trailing buffer walk,
      // whose only purpose is finding occurrences MOVED back into the window —
      // an unmoved candidate out there is excluded by the window test below
      // regardless. So it is real truncation only when this event actually
      // carries a move exception; otherwise the window is fully covered and
      // reporting truncation would make the band's banner state something
      // false. Narrows the flag only — never newly sets it.
      //
      // Derived HERE rather than up-front: this branch needs tens of thousands
      // of candidates to reach, so it is effectively never taken, and
      // expandOccurrences runs per-event on every calendar render.
      const hasMoveException = (event.exceptions ?? []).some((e) => e.kind === "move");
      if (candidate.getTime() <= wEndMs || hasMoveException) truncated = true;
      return "stop";
    }

    // COUNT limits the RULE's own generation, evaluated before exceptions —
    // a skip/move exception does not free up another slot (mirrors iCalendar
    // COUNT vs EXDATE semantics; see monthlyCandidate's doc comment for how
    // this relates to a byMonthDay month producing no candidate at all).
    if (rule?.count !== undefined && generatedCount >= rule.count) return "stop";
    generatedCount += 1;

    const dateIso = iso(candidate);
    const exception = exceptionsByDate.get(dateIso);
    if (exception?.kind === "skip") return "continue";

    const occ = buildOccurrence(event, dateIso, exception);
    // A moved occurrence renders wherever the user put it, even outside the
    // window; an unmoved one is still governed by the window.
    const included = occ.isMoved || (candidate.getTime() >= wStartMs && candidate.getTime() <= wEndMs);
    if (included) {
      if (occurrences.length >= MAX_OCCURRENCES) { truncated = true; return "stop"; }
      occurrences.push(occ);
    }
    return "continue";
  };

  if (!rule) {
    sink(seriesStart);
  } else {
    const untilDate = rule.until ? parseUtc(rule.until) : null;
    const bufferEnd = addDays(wEnd, GENERATION_BUFFER_DAYS);
    const genEnd = untilDate && untilDate.getTime() < bufferEnd.getTime() ? untilDate : bufferEnd;
    const interval = positiveInterval(rule.interval);

    if (rule.freq === "daily") {
      stepDaysLoop(seriesStart, interval, genEnd, sink);
    } else if (rule.freq === "weekly") {
      if (rule.byDay?.length) {
        weeklyByDayLoop(seriesStart, interval, rule.byDay, genEnd, sink);
      } else {
        stepDaysLoop(seriesStart, interval * 7, genEnd, sink);
      }
    } else {
      monthlyLoop(rule, seriesStart, genEnd, sink, () => { truncated = true; });
    }
  }

  occurrences.sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : (a.date < b.date ? -1 : 1)));
  return { occurrences, truncated };
}

/** How far past a search window's start to look for an occurrence, shared by
 *  every "what's the nearest occurrence" caller (the document export's
 *  first-occurrence column, the all-series list's next-occurrence column).
 *  RecurrenceRule.interval clamps to [1,52] months (calendar-event.ts), so a
 *  "yearly-ish" monthly rule combined with a handful of early skip exceptions
 *  can genuinely push the nearest occurrence years out — this needs to be
 *  years, not months, to resolve that realistic case rather than silently
 *  falling back. Bounded (not unbounded) so a genuinely pathological series
 *  (e.g. hundreds of skips on a multi-year interval) still falls back rather
 *  than searching indefinitely. */
export const NEAREST_OCCURRENCE_LOOKAHEAD_DAYS = 3660; // ~10 years

export interface NearestOccurrenceResult {
  occurrence: Occurrence | undefined;
  /** True when `expandOccurrences` gave up before covering the FULL
   *  lookahead window — via EITHER of its two independent caps:
   *  `MAX_OCCURRENCES` (1000 pushed results — the one that actually fires
   *  in practice: any daily/weekly-ish series with `windowStart` at its own
   *  `startDate` trivially produces >1000 occurrences across an ~11-year
   *  lookahead, so `truncated` is routinely true for ORDINARY series, not
   *  just old ones) or `MAX_ITERATIONS` (20,000 candidates evaluated —
   *  reachable for a series whose `startDate` is far in the past, since
   *  generation always starts there).
   *
   *  ★★ `truncated` alone does NOT mean "couldn't determine the nearest
   *  occurrence" — when `MAX_OCCURRENCES` is what fired, `occurrence`
   *  (element 0 of an already-sorted list) is untouched and fully correct;
   *  only the TAIL of the list was dropped. The genuinely uncertain state is
   *  `occurrence === undefined && truncated` — THAT combination means "the
   *  search gave up before confirming there is truly none", not "confirmed
   *  no occurrence exists". A caller must check for that combination
   *  specifically; checking `truncated` in isolation will flag the common
   *  case, not the rare one. */
  truncated: boolean;
}

/** The occurrence an event would show FIRST at-or-after `windowStart` (within
 *  the bounded lookahead above). A thin convenience wrapper over
 *  `expandOccurrences` for callers that only need "what's the nearest
 *  occurrence" and not the full expansion — the export builder passes the
 *  event's own `startDate` ("first occurrence ever"); the all-series list
 *  passes "today" ("next occurrence from now"). Both share these exact
 *  mechanics; only the window start and what to show when nothing resolves
 *  differ, so those stay the caller's job — including how (or whether) to
 *  distinguish a truncated search from a genuinely empty one; see
 *  `NearestOccurrenceResult.truncated`. */
export function nearestOccurrence(event: CalendarEvent, windowStart: string): NearestOccurrenceResult {
  const start = parseUtc(windowStart);
  if (!start) return { occurrence: undefined, truncated: false };
  const windowEnd = iso(addDays(start, NEAREST_OCCURRENCE_LOOKAHEAD_DAYS));
  const { occurrences, truncated } = expandOccurrences(event, windowStart, windowEnd);
  return { occurrence: occurrences[0], truncated };
}
