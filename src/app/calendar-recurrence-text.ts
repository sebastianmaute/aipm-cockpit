// src/app/calendar-recurrence-text.ts — one human line for a RecurrenceRule.
//
// ★★★ IT EXISTS FOR THE REVIEW CARD. `describeEntityCalls` renders a FieldDiff
// as before/after STRINGS, so without this a staged recurrence change reaches
// the card as a JSON blob — on the one surface whose whole job is letting a
// user refuse a write they understand.
//
// ★★ DOM-FREE AND i18n-FREE BY CONTRACT, like every engine under this app's
// pure-module convention. It is fed by a MODEL patch, so it must accept
// `unknown` and answer "" rather than throwing: the descriptor then renders its
// own empty state instead of the string "undefined".
//
// ★★★ PREVIEW⟺WRITE PARITY IS THE WHOLE POINT, so every branch below MIRRORS
// the matching check in `sanitizeRecurrence` (calendar-event.ts) rather than
// approximating it. `intInRange`/`weekdayOrUndefined` and
// `WEEKDAYS` are not exported from there (or would drag in that module's own
// "./sanitize" barrel import if taken as a VALUE import), so this is a
// deliberate hand-copy — kept honest by the differential tests below, which
// compare this module's output against the REAL, exported
// `sanitizeCalendarEvent` rather than against a second hand-copy that could
// drift the same way this one already did once.
//
// ★★ `startDate` IS OPTIONAL, and it is a real degrade, not a stopgap. It is
// now wired — but NOT where this paragraph predicted, and the difference is
// worth keeping. It said the review card would reach this through
// `forPreview(entity, field, value)` in `inline-ai-edit/plan.ts`, "once
// `forPreview`'s own signature forwards it". `forPreview` was the wrong hook:
// it runs AFTER the field's normalisation and exists only to project the RICH
// HTML fields, and it is handed a string. The right one already took a row —
// `INLINE_DESCRIPTORS.calendarEvent.fieldSanitizers.recurrence`, which
// `describeEntityCalls` calls with the MERGED row as its second argument (the
// model may be moving `startDate` in the same call, and `sanitizeRecurrence`
// reads the NEW start), and — since §605 — the STORED row as an optional third,
// for the dates an update carries (see `NOTHING_CARRIED`). The entry's type is
// `EntityDescriptor["fieldSanitizers"]`; read it there, not here.
// ★ The degrade still matters: pass the rule alone and the card silently loses
// the `until >= startDate` resolution and the byMonthDay fallback, with nothing
// failing — which is why the descriptor entry spells the row read out rather
// than defaulting.
//
// Without `startDate` — or for any input where the caller omits it — a
// byMonthDay fallback or an until/count precedence that the write path would
// resolve USING `startDate` is OMITTED rather than guessed: printing a day or
// a range terminator the write will not actually apply is a false claim about
// the write, and an incomplete-but-true card is the safe direction. See
// "omit, don't guess" at each call below.
//
// ★ KNOWN DELIBERATE GAP: staying i18n-free by this app's engine convention
// means "Every"/"until"/"times" are hardcoded English regardless of `Lang` —
// a DE user gets a half-German card until the wiring layer translates around
// this projection. That is a design call for wiring time, not for this
// module; tracked separately.

import { acceptsCarriedOrRealDate, toNumber } from "./sanitize-core";
import type { CarriedRecurrenceDates, RecurrenceRule } from "./calendar-event";

// Mirrors WEEKDAYS in calendar-event.ts. Duplicated rather than imported —
// importing it as a VALUE (unlike the type-only `RecurrenceRule` import
// above, which erases at compile time) would pull in that module's own
// "./sanitize" barrel import at runtime, exactly what this module's header
// says it avoids.
const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
type Weekday = (typeof WEEKDAYS)[number];

/** A create's carry-sets: nothing, so both dates are judged by the strict rule.
 *
 *  ★★ HOW THIS MODULE JUDGES A DATE. The writer's date readers are one
 *   predicate, `acceptsCarriedOrRealDate` (imported from the leaf
 *   `sanitize-core.ts`, no barrel, so the header rule holds): a real calendar
 *   date (`isRealCalendarDate`, any year), or one the UPDATE carries because it
 *   equals the stored one (§542). Both the `until` terminator and the start a
 *   byMonthDay fallback is taken from go through it, with the carried sets from
 *   `carriedRecurrenceDatesOf(stored)` — the writer's own derivation (§605).
 *   Before §542 this module mirrored a two-leg rule, regex + `Date.parse`, that
 *   ACCEPTED a day overflowing its month (`"2026-04-31"` parses, to May 1). */
const NOTHING_CARRIED: CarriedRecurrenceDates = {
  startDate: new Set(),
  "recurrence.until": new Set(),
};

const FREQ_UNIT: Readonly<Record<string, [string, string]>> = {
  daily: ["day", "days"],
  weekly: ["week", "weeks"],
  monthly: ["month", "months"],
};

function isRule(v: unknown): v is RecurrenceRule {
  if (typeof v !== "object" || v === null) return false;
  const freq = (v as { freq?: unknown }).freq;
  // ★★ `Object.hasOwn`, NEVER `in`. `in` walks the prototype chain, so
  // `{freq:"toString"}` passes an `in` check (`Object.prototype.toString`
  // exists) and `FREQ_UNIT[r.freq]` below then destructures a FUNCTION as
  // `[one, many]`, throwing `TypeError: ... is not iterable` — violating this
  // module's own header promise to answer "" rather than throw.
  return typeof freq === "string" && Object.hasOwn(FREQ_UNIT, freq);
}

function isWeekday(v: unknown): v is Weekday {
  return typeof v === "string" && (WEEKDAYS as readonly string[]).includes(v);
}

// Mirrors `intInRange(r.interval, 1, 52, 1)` in `sanitizeRecurrence` — the
// ONLY thing that decides what actually gets written. `toNumber` (imported
// from the leaf `sanitize-core.ts`, not re-derived) is the SAME coercion the
// sanitizer uses, so a model-emitted STRING interval ("3") is accepted here
// exactly as it is on the write path, not silently dropped to 1. `intInRange`
// itself is not exported, so the range/integer composition is still a
// hand-mirror.
function clampInterval(v: unknown): number {
  const n = toNumber(v);
  return Number.isInteger(n) && n >= 1 && n <= 52 ? n : 1;
}

// Mirrors the monthly branch's ordinal-weekday check: `day` and `ordinal`
// (coerced via `toNumber`, so a string ordinal is accepted the same way the
// sanitizer accepts one) must BOTH be individually valid, or the whole
// `byDay` shape is rejected — never partially honoured.
function validOrdinalDay(byDay: unknown): { ordinal: 1 | 2 | 3 | 4 | -1; day: Weekday } | undefined {
  if (typeof byDay !== "object" || byDay === null) return undefined;
  const { ordinal: ordinalRaw, day: dayRaw } = byDay as Record<string, unknown>;
  const day = isWeekday(dayRaw) ? dayRaw : undefined;
  const ordinalNum = toNumber(ordinalRaw);
  const ordinal = [1, 2, 3, 4, -1].includes(ordinalNum) ? (ordinalNum as 1 | 2 | 3 | 4 | -1) : undefined;
  return day && ordinal ? { ordinal, day } : undefined;
}

// Mirrors `WEEKDAYS.filter((d) => raw.some((x) => weekdayOrUndefined(x) === d))`:
// filters out anything that is not a real weekday, DEDUPES, and reorders into
// canonical MO..SU order regardless of the input array's own order — the
// write path does all three, so echoing the raw array's order or duplicates
// would describe a series the write does not produce.
function validWeekdays(raw: unknown): Weekday[] {
  if (!Array.isArray(raw)) return [];
  return WEEKDAYS.filter((d) => raw.some((x) => isWeekday(x) && x === d));
}

// "omit, don't guess" (see header). Without `startDate` there is no way to
// compute the write's day-of-month fallback, so this returns `undefined`
// rather than a guess.
function fallbackDayOfMonth(startDate: string | undefined, carriedStart: ReadonlySet<string>): number | undefined {
  // ★ The writer's predicate, not the bare regex: the write derives this
  //  fallback from a start that has ALREADY been through its date reader. On a
  //  CREATE a regex-shaped but invalid start ("2026-02-30") reaches the write as
  //  no event at all, so "omit, don't guess" is the honest answer there.
  // ★★★ ON AN UPDATE THE READER CARRIES A STORED INVALID START (§542), and the
  //  write takes the day from it (`Number(startDate.slice(8, 10))`, so 30).
  //  Omitting it there is NOT safe: the card is a before/after DIFF, the before
  //  side prints a stored in-range byMonthDay without needing the start, and an
  //  after side missing the day then shows "on day 30" removed from a rule the
  //  write leaves byte-identical (§605).
  return acceptsCarriedOrRealDate(startDate, carriedStart) ? Number(startDate.slice(8, 10)) : undefined;
}

// Mirrors `intInRange(r.byMonthDay, 1, 31, fallbackDom)`. In range: returned
// unchanged, no `startDate` needed. Out of range WITH a `startDate`: the same
// startDate-derived fallback the write applies. Out of range WITHOUT one:
// `undefined` (the day clause is omitted — see header).
function clampMonthDay(
  v: unknown, startDate: string | undefined, carriedStart: ReadonlySet<string>,
): number | undefined {
  const n = toNumber(v);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : fallbackDayOfMonth(startDate, carriedStart);
}

function validCount(v: unknown): number | undefined {
  const n = toNumber(v);
  return Number.isInteger(n) && n >= 1 && n <= 500 ? n : undefined;
}

// Mirrors the range-terminator block of `sanitizeRecurrence`: at most one of
// until/count survives, `until` requires BOTH a syntactically valid ISO date
// AND `until >= startDate`, and only a REJECTED `until` lets `count` through.
//
// The date-FORMAT check needs no `startDate` and always applies, so a
// syntactically bad `until` is known-rejected either way and always falls
// through to `count`. Only the RANGE half (`until >= startDate`) needs
// `startDate`. Without it, a syntactically valid `until` is ambiguous — it
// might survive the write, might not — and "omit, don't guess" means
// dropping the ENTIRE range clause rather than picking a side: printing
// `count` there could show a terminator the write silently discards in
// favour of `until`, and printing `until` could show one the write rejects
// in favour of `count`. Both are false-claim shapes the header forbids.
function rangeSuffix(
  r: { until?: unknown; count?: unknown },
  startDate: string | undefined,
  carriedUntil: ReadonlySet<string>,
): string {
  // ★★ The writer's own date rule, not the bare regex. `sanitizeRecurrence`
  //  runs its date reader here, so a regex-shaped but INVALID `until`
  //  ("2026-13-01", and since §542 "2026-04-31") is known-rejected by a create
  //  and must fall through to `count` — printing it named a terminator the
  //  write discards.
  // ★★★ UNLESS AN UPDATE CARRIES IT (§605). The update writer keeps an `until`
  //  equal to the stored one verbatim, calendar-invalid or not, and then drops
  //  a co-sent `count`. `acceptsCarriedOrRealDate` is the writer's predicate,
  //  not a copy of it; an empty `carriedUntil` (a create) makes it the strict rule.
  const until = acceptsCarriedOrRealDate(r.until, carriedUntil) ? r.until : undefined;
  if (until) {
    if (startDate === undefined) return "";
    if (until >= startDate) return ` until ${until}`;
  }
  const count = validCount(r.count);
  return count !== undefined ? `, ${count} times` : "";
}

/** `Every day` · `Every 2 weeks on MO, WE` · `Every month on the last FR`,
 *  with an optional ` until <date>` or `, N times` tail. "" for a non-rule.
 *  Pass `startDate` (the entity's own, ISO `YYYY-MM-DD`) to resolve the
 *  byMonthDay fallback and the until/count precedence exactly as the write
 *  path would; omit it and both degrade to "omit, don't guess" (see header).
 *  On an UPDATE, pass `carried` — `carriedRecurrenceDatesOf(stored)` — so a
 *  stored `until` the patch re-sends, and a stored start a byMonthDay fallback
 *  is taken from, are judged as the update writer judges them (§605); omit it
 *  for a create, which carries nothing. */
export function recurrenceText(rule: unknown, startDate?: string, carried?: CarriedRecurrenceDates): string {
  const carriedDates = carried ?? NOTHING_CARRIED;
  if (!isRule(rule)) return "";
  const r = rule as RecurrenceRule & {
    byDay?: unknown;
    byMonthDay?: unknown;
    until?: unknown;
    count?: unknown;
  };
  const interval = clampInterval(r.interval);
  const [one, many] = FREQ_UNIT[r.freq];
  let out = interval === 1 ? `Every ${one}` : `Every ${interval} ${many}`;

  if (r.freq === "weekly") {
    const days = validWeekdays(r.byDay);
    if (days.length > 0) out += ` on ${days.join(", ")}`;
  }

  // byDay wins over byMonthDay — mirrors `sanitizeRecurrence`'s own comment on
  // this exact precedence. A valid ordinal-weekday shape is checked FIRST and,
  // if present, byMonthDay is never even looked at, matching the write (which
  // discards it silently in that case).
  if (r.freq === "monthly") {
    const nth = validOrdinalDay(r.byDay);
    if (nth) {
      const which = nth.ordinal === -1 ? "last" : `${nth.ordinal}`;
      out += ` on the ${which} ${nth.day}`;
    } else {
      const day = clampMonthDay(r.byMonthDay, startDate, carriedDates.startDate);
      if (day !== undefined) out += ` on day ${day}`;
    }
  }

  return out + rangeSuffix(r, startDate, carriedDates["recurrence.until"]);
}
