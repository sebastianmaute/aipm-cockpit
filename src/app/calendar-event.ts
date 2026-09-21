// CalendarEvent — a timed meeting on the resource calendar, optionally
// recurring. Pure, i18n-free, clock-free.
//
// The sanitizers NEVER throw: every load path (JSON import, CSV/MD decode,
// Turso row, IndexedDB) runs untrusted data through one and expects null for
// an unrecoverable record rather than an exception.
//
// ★★★ THREE PUBLIC FORMS, ONE PER PATH, differing ONLY in how they read a
//  date (§542): `sanitizeCalendarEvent` (CREATE: a real calendar date, any
//  year), `sanitizeLoadedCalendarEvent` (LOAD: exactly what loaded before
//  §542, a kept non-calendar value reported) and
//  `sanitizeCalendarEventForUpdate` (UPDATE: an untouched stored date carried
//  verbatim, a changed one judged as on create). See the reader block below.

import { sanitizeMultiline, sanitizeText, toNumber } from "./sanitize";
import { isRealCalendarDate } from "./sanitize-core";
import { calendarEventDateOnLoad } from "./sanitize-load-date";

export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type RecurrenceRule =
  | { freq: "daily"; interval: number; until?: string; count?: number }
  | { freq: "weekly"; interval: number; byDay?: Weekday[]; until?: string; count?: number }
  | { freq: "monthly"; interval: number; byMonthDay?: number;
      byDay?: { ordinal: 1 | 2 | 3 | 4 | -1; day: Weekday }; until?: string; count?: number };

export type EventException =
  | { date: string; kind: "skip" }
  | { date: string; kind: "move"; toDate: string; toTime?: string };

export interface CalendarEvent {
  id: number;
  title: string;
  startDate: string;
  startTime: string;
  durationMinutes: number;
  location?: string;
  notes?: string;
  recurrence?: RecurrenceRule;
  exceptions?: EventException[];
  attendeeResourceIds?: number[];
  sendInvitations?: boolean;
  localModifiedAt?: string;
  outlookEventId?: string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const TITLE_MAX = 200;
const LOCATION_MAX = 200;
const NOTES_MAX = 2000;
const MAX_EXCEPTIONS = 500;
const MAX_ATTENDEES = 100;
const DEFAULT_TIME = "09:00";
const DEFAULT_DURATION = 60;
const DURATION_MIN = 5;
const DURATION_MAX = 1440;

// --- date readers: one per path (§542) -------------------------------------
//
// ★★★ BEFORE §542 ONE RULE SERVED EVERY PATH: the ISO shape plus
//  `Date.parse`. THAT `Date.parse` LEG IS A FIELD-RANGE CHECK, NOT A CALENDAR
//  CHECK, and three comments across this slice called it the latter before it
//  was measured. On an ISO date-ONLY string the spec's Date Time String Format
//  requires MM in 01–12 and DD in 01–31, so `"2026-13-01"` and `"2026-01-32"`
//  are NaN — but a day that overflows its own MONTH is accepted and silently
//  rolled over: `"2026-02-30"` parses (to Mar 2) and `"2026-04-31"` parses (to
//  May 1). The rule returned the INPUT, never the parsed date, so such a value
//  was stored verbatim as written and rendered on the wrong day.
//  ★★ THAT MATTERS TO ANYONE WRITING A TEST HERE: against that old rule a case
//   built on `2026-02-30` is VACUOUS, because it and a bare regex both accept
//   it. One was written that way in `calendar-recurrence-text.test.ts` and
//   survived the mutant meant to kill it. Reproduce:
//   `node -e "for (const d of ['2026-01-32','2026-02-30','2026-13-01']) console.log(d, Date.parse(d+'T00:00:00Z'))"`
//
// ★★★ WHY THREE READERS AND NOT ONE STRICTER ONE. `startDate` is REQUIRED, and
//  this module's body runs on every LOAD as well as every write, so tightening
//  the one rule in place would have made every stored event with a
//  month-overflow `startDate` vanish on its next load, and blanked a stored
//  `until` into an UNBOUNDED series. §539 shipped exactly that regression for
//  milestones and reversed it. So each path gets its own reader:
//   - CREATE (`readStrictEventDate`): a real calendar date (`isRealCalendarDate`),
//     ANY year — calendar events never had the 1900–2100 bound.
//   - LOAD (`readEventDateOnLoad`): `calendarEventDateOnLoad`, which keeps
//     exactly the old rule's values and REPORTS a kept non-calendar one. Kept,
//     not repaired: such a date still rolls over when rendered.
//   - UPDATE (`carryStoredEventDates`): a date equal to the STORED one for that
//     field is carried verbatim; any other is judged as on create.

/** Which date a reader judges — named so a load diagnostic and an update's carry-set say which. */
type EventDateField = "startDate" | "recurrence.until" | "exceptions.date" | "exceptions.toDate";
/** How `calendarEventWithDateReader` reads each date: the stored string, or undefined. */
type EventDateReader = (value: unknown, field: EventDateField, id: number) => string | undefined;

/** CREATE (§542): a real calendar date, any year. */
function strictEventDate(value: unknown): string | undefined {
  return typeof value === "string" && isRealCalendarDate(value) ? value : undefined;
}
function readStrictEventDate(value: unknown): string | undefined {
  return strictEventDate(value);
}
/** LOAD (§542): what loaded before, reported when it is not a real day. */
function readEventDateOnLoad(value: unknown, field: EventDateField, id: number): string | undefined {
  return calendarEventDateOnLoad(value, id, field);
}
/** UPDATE (§542): carry a date equal to the STORED one for that field verbatim; judge any
 *  other strictly. Same stance as `requiredIsoDateOnUpdate` for milestones — without it an AI
 *  edit of a title failed on a stored "2026-02-30" the edit never touched. */
function carryStoredEventDates(stored: CalendarEvent): EventDateReader {
  const carried: Record<EventDateField, ReadonlySet<string>> = {
    startDate: new Set([stored.startDate]),
    "recurrence.until": new Set(stored.recurrence?.until ? [stored.recurrence.until] : []),
    "exceptions.date": new Set((stored.exceptions ?? []).map((e) => e.date)),
    "exceptions.toDate": new Set(
      (stored.exceptions ?? []).flatMap((e) => (e.kind === "move" ? [e.toDate] : [])),
    ),
  };
  return function readForUpdate(value, field) {
    return typeof value === "string" && carried[field].has(value) ? value : strictEventDate(value);
  };
}

function intInRange(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = toNumber(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : fallback;
}

function weekdayOrUndefined(v: unknown): Weekday | undefined {
  return typeof v === "string" && (WEEKDAYS as readonly string[]).includes(v) ? (v as Weekday) : undefined;
}

function sanitizeRecurrence(
  raw: unknown, startDate: string, readDate: EventDateReader, id: number,
): RecurrenceRule | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const interval = intInRange(r.interval, 1, 52, 1);

  // At most ONE range terminator survives. Both present is ambiguous, and
  // `until` is the one a user can verify by reading it.
  const until = readDate(r.until, "recurrence.until", id);
  const validUntil = until && until >= startDate ? until : undefined;
  const count = validUntil ? undefined : (() => {
    const n = toNumber(r.count);
    return Number.isInteger(n) && n >= 1 && n <= 500 ? n : undefined;
  })();
  const range = { ...(validUntil ? { until: validUntil } : {}), ...(count ? { count } : {}) };

  if (r.freq === "daily") return { freq: "daily", interval, ...range };

  if (r.freq === "weekly") {
    const days = Array.isArray(r.byDay)
      ? WEEKDAYS.filter((d) => (r.byDay as unknown[]).some((x) => weekdayOrUndefined(x) === d))
      : [];
    return { freq: "weekly", interval, ...(days.length ? { byDay: [...days] } : {}), ...range };
  }

  if (r.freq === "monthly") {
    const nth = r.byDay && typeof r.byDay === "object" ? (r.byDay as Record<string, unknown>) : null;
    const day = nth ? weekdayOrUndefined(nth.day) : undefined;
    const ordinalRaw = nth ? toNumber(nth.ordinal) : NaN;
    const ordinal = [1, 2, 3, 4, -1].includes(ordinalRaw) ? (ordinalRaw as 1 | 2 | 3 | 4 | -1) : undefined;
    // byDay wins over byMonthDay: the two express different intents and keeping
    // both would leave the expansion engine choosing silently.
    if (day && ordinal) return { freq: "monthly", interval, byDay: { ordinal, day }, ...range };
    const fallbackDom = Number(startDate.slice(8, 10));
    return { freq: "monthly", interval, byMonthDay: intInRange(r.byMonthDay, 1, 31, fallbackDom), ...range };
  }

  return undefined;
}

function sanitizeExceptions(raw: unknown, readDate: EventDateReader, id: number): EventException[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const byDate = new Map<string, EventException>();
  for (const item of raw.slice(0, MAX_EXCEPTIONS)) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const date = readDate(e.date, "exceptions.date", id);
    if (!date) continue;
    if (e.kind === "move") {
      const toDate = readDate(e.toDate, "exceptions.toDate", id);
      // A move whose target is unusable degrades to a skip, never to nothing:
      // an occurrence the user moved must not reappear on its original date.
      if (!toDate) { byDate.set(date, { date, kind: "skip" }); continue; }
      const toTime = typeof e.toTime === "string" && HHMM.test(e.toTime) ? e.toTime : undefined;
      byDate.set(date, { date, kind: "move", toDate, ...(toTime ? { toTime } : {}) });
    } else {
      byDate.set(date, { date, kind: "skip" });
    }
  }
  if (byDate.size === 0) return undefined;
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function sanitizeAttendees(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<number>();
  for (const v of raw) {
    const n = toNumber(v);
    // Dangling ids (resource since deleted) are KEPT — same stance as every
    // other FK in the app; the UI renders them unresolved rather than lying
    // about who was invited.
    if (Number.isInteger(n) && n > 0) seen.add(n);
    if (seen.size >= MAX_ATTENDEES) break;
  }
  return seen.size ? [...seen] : undefined;
}

// --- per-field rules, shared with the AI review card -----------------------
//
// ★★★ THESE EXIST SO THE PREVIEW CANNOT RESTATE THEM. `INLINE_DESCRIPTORS`
// (inline-ai-edit/entity-descriptor.ts) renders a staged `update_calendar_event`
// by running each field through the APPLY path's own normalisation, and that
// map's contract is "call the real function, never a copy of its cap or its
// algorithm". The caps below are private to this module, so without a named
// export per field the descriptor would have to re-spell 200 / 2000 / [5,1440]
// / the HH:MM regex — four places to drift from one. `sanitizeCalendarEvent`
// calls exactly these, so there is one spelling of each.

export function sanitizeEventTitle(v: unknown): string {
  return sanitizeText(v, TITLE_MAX);
}

export function sanitizeEventLocation(v: unknown): string {
  return sanitizeText(v, LOCATION_MAX);
}

/** ★ `sanitizeMultiline`, so it clips WITHOUT trimming — unlike `title` and
 *  `location` beside it, and unlike `Absence.note`, which is the same SHAPE at
 *  a different cap (TEXTAREA_MAX). Read the field's own rule; the name does not
 *  tell you which family it is in. */
export function sanitizeEventNotes(v: unknown): string {
  return sanitizeMultiline(v, NOTES_MAX);
}

/** The stored `startTime` for any input — a value failing the HH:MM test is
 *  silently RESET to the 09:00 default rather than refused, so a preview that
 *  showed the model's spelling would promise a time the write does not keep. */
export function normalizeEventStartTime(v: unknown): string {
  return typeof v === "string" && HHMM.test(v) ? v : DEFAULT_TIME;
}

/** The durations the write stores VERBATIM.
 *
 *  ★★ AN ACCEPTANCE PREDICATE, NOT A CLAMP, and that is what the review card
 *   needs: `intInRange` silently substitutes the 60-minute default for anything
 *   out of range, so a card that previewed the model's `3` would show a change
 *   the write does not make. Composed from the REAL `intInRange` with a
 *   fallback that can never equal its input (`NaN === v` is false for every
 *   `v`), so the bounds have one spelling rather than two.
 *
 *  ★★★ IT MUST STAY A `function` DECLARATION — DO NOT TIDY IT INTO A `const`
 *   ARROW. `sanitize-records.ts` imports it to build `CALENDAR_EVENT_FIELD_
 *   GUARDS`, a module-level const, and this module imports the `./sanitize`
 *   barrel that re-exports that file: a CYCLE. A function declaration is
 *   hoisted, so its binding is initialised before either module body runs and
 *   the read resolves whichever side is evaluated first. A `const` arrow is not
 *   — it puts that read in the TDZ and throws at import time, in ONE evaluation
 *   order only. That is intermittent, load-order dependent, and invisible to
 *   both tsc and lint. The same applies to `isSendInvitationsFlag` if it is
 *   ever imported the same way. */
export function acceptsEventDuration(v: unknown): boolean {
  return intInRange(v, DURATION_MIN, DURATION_MAX, Number.NaN) === v;
}

/** Whether the CREATE rule (`sanitizeCalendarEvent`) would ACCEPT this value
 *  as `startDate`: a real calendar date, with NO year bound (§542).
 *
 *  ★★★ IT EXISTS BECAUSE THE PREVIEW'S DEFAULT DATE RULE AND THIS MODULE'S
 *   DISAGREE, and the disagreement was once a defect in each direction.
 *   `sanitizeIsoDate` (sanitize-core.ts) is regex + a calendar check (§539) +
 *   a 1900–2100 year bound; this module's create rule is the calendar check
 *   with NO year bound. So without this override `"1899-12-31"` previews as
 *   REJECTED and lands. `INLINE_DESCRIPTORS.calendarEvent.acceptsDate` points
 *   here so the card asks the writer's own question (§405), rather than a
 *   second spelling of a similar one. ★ The other direction (`"2026-01-32"`,
 *   then month overflow like `"2026-02-30"`, previewed as accepted and then
 *   refused by the write) was closed at the source by §539 and §542; the
 *   year bound is why this override remains.
 *
 *  ★★ THE CREATE RULE, NOT THE UPDATE ONE, and that is exact rather than
 *   approximate: the update form differs only by CARRYING a date equal to the
 *   stored one, and the card never judges a field whose value is unchanged.
 *
 *  ★★ THE YEAR BOUND STAYS OFF ON PURPOSE. Adding one here would close the
 *   gap by CHANGING WHAT IS STORED, and a stored meeting outside 1900–2100
 *   would then be refused on its next edit. Parity, not policy.
 *
 *  ★★★ A HOISTED `function` DECLARATION, for exactly the reason spelled out on
 *   `acceptsEventDuration` above: an importer building a module-level const off
 *   it across this module's `./sanitize` barrel cycle reads the binding before
 *   either body runs. Do not tidy it into a `const` arrow. */
export function acceptsEventDate(v: unknown): boolean {
  return strictEventDate(v) !== undefined;
}

/** The stored shape of `sendInvitations`: PRESENT-ONLY-WHEN-TRUE, exactly like
 *  `Resource.isExternal`. A row that does not invite carries no key at all, so
 *  a preview comparing `undefined` against an incoming `false` would render a
 *  spurious diff on the one field that mails people. */
export function isSendInvitationsFlag(v: unknown): boolean {
  return v === true;
}

/** CREATE. ONE argument, so safe point-free. */
export function sanitizeCalendarEvent(input: unknown): CalendarEvent | null {
  return calendarEventWithDateReader(input, readStrictEventDate);
}
/** LOAD funnels only (IndexedDB, JSON, and `buildCalendarEventFromObj` for CSV / Markdown / Turso). */
export function sanitizeLoadedCalendarEvent(input: unknown): CalendarEvent | null {
  return calendarEventWithDateReader(input, readEventDateOnLoad);
}
/** UPDATE of `stored`. ★ TWO arguments — never pass it point-free. */
export function sanitizeCalendarEventForUpdate(input: unknown, stored: CalendarEvent): CalendarEvent | null {
  return calendarEventWithDateReader(input, carryStoredEventDates(stored));
}

/** The one body behind all three public forms; only `readDate` differs. */
function calendarEventWithDateReader(input: unknown, readDate: EventDateReader): CalendarEvent | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;

  const id = toNumber(raw.id);
  if (!Number.isFinite(id) || id <= 0) return null;

  const title = sanitizeEventTitle(raw.title);
  if (!title) return null;

  const startDate = readDate(raw.startDate, "startDate", id);
  if (!startDate) return null;

  const startTime = normalizeEventStartTime(raw.startTime);

  const recurrence = sanitizeRecurrence(raw.recurrence, startDate, readDate, id);
  return {
    id,
    title,
    startDate,
    startTime,
    durationMinutes: intInRange(raw.durationMinutes, DURATION_MIN, DURATION_MAX, DEFAULT_DURATION),
    location: sanitizeEventLocation(raw.location) || undefined,
    notes: sanitizeEventNotes(raw.notes) || undefined,
    recurrence,
    // A per-occurrence exception has no meaning without a rule to except
    // from — without a recurrence, `expandOccurrences` renders the single
    // series-start date directly (see its `if (!rule) sink(seriesStart)`
    // branch), and a lingering `skip`/`move` exception on that exact date
    // would silently make the event render NOWHERE while it still appears
    // in the series list. Dropping exceptions here (the single validator
    // every load path — form submit, JSON/CSV/MD/Turso decode, AI tools —
    // routes through) closes that for every source at once, not just the
    // editor's own submit path.
    exceptions: recurrence ? sanitizeExceptions(raw.exceptions, readDate, id) : undefined,
    attendeeResourceIds: sanitizeAttendees(raw.attendeeResourceIds),
    sendInvitations: isSendInvitationsFlag(raw.sendInvitations) ? true : undefined,
    localModifiedAt: sanitizeText(raw.localModifiedAt, 1024) || undefined,
    outlookEventId: sanitizeText(raw.outlookEventId, 1024) || undefined,
  };
}

// --- JSON-in-cell codecs -----------------------------------------------
// An absent value encodes to "" and decodes back to undefined, so a plain
// non-recurring event carries no JSON in its row.
//
// ★ UNLIKE note-log's decoders, these deliberately do NOT self-validate:
// sanitizeRecurrence needs `startDate` for cross-field checks (until >= start)
// that a decoder has no access to. A decoded cell is therefore UNTRUSTED —
// whoever assembles a CalendarEvent from decoded cells MUST run the whole
// object back through a sanitizer before using it — on a LOAD path the load
// form, `sanitizeLoadedCalendarEvent` (as `buildCalendarEventFromObj` does).

export function encodeRecurrence(rule: RecurrenceRule | undefined): string {
  return rule ? JSON.stringify(rule) : "";
}

export function decodeRecurrence(cell: string): RecurrenceRule | undefined {
  if (!cell.trim()) return undefined;
  try {
    const parsed = JSON.parse(cell) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as RecurrenceRule) : undefined;
  } catch { return undefined; }
}

export function encodeExceptions(list: readonly EventException[] | undefined): string {
  return list && list.length ? JSON.stringify(list) : "";
}

export function decodeExceptions(cell: string): EventException[] | undefined {
  if (!cell.trim()) return undefined;
  try {
    const parsed = JSON.parse(cell) as unknown;
    return Array.isArray(parsed) ? (parsed as EventException[]) : undefined;
  } catch { return undefined; }
}

export function encodeAttendees(ids: readonly number[] | undefined): string {
  return ids && ids.length ? ids.join("|") : "";
}

export function decodeAttendees(cell: string): number[] | undefined {
  if (!cell.trim()) return undefined;
  // The `Number.isInteger(n) && n > 0` filter is incidental to PARSING a
  // delimited string cell (a split token is unavoidably `unknown` numeric
  // input), not a second validation layer — it does not contradict the
  // decoded-output-is-untrusted note above. sanitizeAttendees still re-checks
  // ids against the live workspace when the assembled event is sanitized.
  const out = cell.split("|").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  return out.length ? out : undefined;
}

// --- Occurrence drag (band) ---------------------------------------------

/**
 * Applies a user drag of ONE occurrence to a new date. A RECURRING series
 * records a `move` exception, so the rule keeps producing every other
 * occurrence unchanged and only this one relocates. A NON-RECURRING event
 * has its `startDate` rewritten directly instead — an exception on a
 * one-occurrence event would be a second source of truth for the same date
 * (the exception and `startDate` could then disagree about when the meeting
 * is), so recurrence-less events skip the exception path entirely.
 *
 * ★★ `originalDate` MUST be the date the recurrence RULE produced for this
 * occurrence (`Occurrence.originalDate`), never whatever date is currently
 * RENDERED for it. Moving an already-moved occurrence again passes the SAME
 * `originalDate` both times, which is what lets this REPLACE the existing
 * exception instead of minting a second, contradictory one for the same
 * slot — key off the rendered date instead and the series quietly
 * accumulates two exceptions that both claim to explain the same occurrence.
 *
 * A no-op move (`originalDate === toDate`) returns `event` BY REFERENCE
 * unchanged, so a caller can cheaply detect "nothing happened" with `===`.
 *
 * Exceptions come out sorted ascending by date — the same invariant
 * `sanitizeExceptions` enforces — so re-sanitizing the result is a no-op.
 *
 * ★ A prior `move` exception on this `originalDate` may already carry a
 * `toTime` (from a source this function has no `toTime` parameter to
 * override yet, e.g. a future Outlook pull) — that time is CARRIED FORWARD
 * into the replacement exception rather than dropped. Without this, a
 * date-only re-drag of an occurrence that also carried a moved time would
 * silently revert it to the event's own `startTime`.
 */
export function applyOccurrenceMove(
  event: CalendarEvent,
  originalDate: string,
  toDate: string,
): CalendarEvent {
  if (originalDate === toDate) return event;

  if (!event.recurrence) {
    return { ...event, startDate: toDate };
  }

  const prior = (event.exceptions ?? []).find((e) => e.date === originalDate);
  const priorToTime = prior?.kind === "move" ? prior.toTime : undefined;
  const moved: EventException = {
    date: originalDate, kind: "move", toDate, ...(priorToTime ? { toTime: priorToTime } : {}),
  };
  const exceptions = [...(event.exceptions ?? []).filter((e) => e.date !== originalDate), moved]
    .sort((a, b) => a.date.localeCompare(b.date));
  return { ...event, exceptions };
}
