// Pure resolution of a meetings-band drag gesture (R5 Task 14/17 fix, closed
// further after a second review round). Mirrors calendar-drag.ts's
// resolveCalendarDrag shape: the caller supplies exactly what was grabbed and
// where it was dropped; this module decides what that means, or that it
// means nothing.
//
// Why id alone can't identify the grabbed occurrence: every occurrence of a
// recurring series shares the same eventId — a daily standup viewed over a
// week is one event id, seven Occurrence objects. Resolving a drop by id
// alone (`occurrences.find(o => o.eventId === id)`) returns whichever
// occurrence happens to be first in the list, not the one the user's pointer
// was actually over.
//
// ★★ Why the RENDERED date isn't enough either (the fix's first pass got
// this far and no further): a `move` exception can relocate one occurrence
// onto a date another occurrence of the SAME series already occupies —
// nothing in sanitizeExceptions forbids a `toDate` landing on a sibling's own
// rule-produced date. When that happens, two occurrences share BOTH eventId
// AND rendered `date`, so matching on `(eventId, date)` is ambiguous again,
// just with a much narrower blast radius than matching on id alone.
//
// The fix: match on `(eventId, originalDate)`. `Occurrence.originalDate` is
// the date the RECURRENCE RULE produced — unique per occurrence within a
// series by construction (the rule generates at most one candidate per
// occurrence slot), and it never changes when an occurrence is moved. It is
// also exactly the key `applyOccurrenceMove` uses for exceptions, so this
// module's identity and that function's identity are the same concept.
//
// `originDate` (the grabbed chip's RENDERED date) is kept for a DIFFERENT
// job: the no-op check. Dropping a chip back where it visually sits must be
// a no-op, and "where it visually sits" is the rendered date, not the rule
// date — a moved occurrence's rendered date and originalDate legitimately
// differ, and comparing the WRONG one against dropDate would either miss a
// genuine no-op or treat a genuine move as one. The two fields answer two
// different questions and must not be conflated.

import type { Occurrence } from "./recurrence";

export interface ResolveOccurrenceDragInput {
  /** Every occurrence currently in the band (all lanes, flattened) — the
   *  pool to resolve the grabbed one from. */
  occurrences: readonly Occurrence[];
  /** The dragged chip's event id. */
  eventId: number;
  /** The dragged chip's RENDERED date at the moment the drag started. Used
   *  ONLY for the no-op check below — NEVER for matching which occurrence
   *  was grabbed. A moved occurrence's rendered date can coincide with an
   *  unrelated sibling occurrence's own natural date, so rendered date alone
   *  cannot disambiguate within a series (see the module doc comment). */
  originDate: string;
  /** The grabbed occurrence's `originalDate` (the rule-produced date) — used
   *  ONLY for matching, never for the no-op check. Unique per occurrence
   *  within a series by construction, so `(eventId, originalDate)` is a
   *  genuine identity for a chip where `(eventId, date)` is not. */
  originalDate: string;
  /** The date the gesture dropped on. */
  dropDate: string;
}

export interface ResolveOccurrenceDragResult {
  /** The occurrence identified by `(eventId, originalDate)` — unique per
   *  series by construction, so this is genuinely the occurrence that was
   *  grabbed, not merely the first same-eventId (or same-rendered-date)
   *  match a less specific key could return instead. */
  occurrence: Occurrence;
  toDate: string;
}

/** Resolve a band drag, or `null` when it is a no-op (dropped back on the
 *  RENDERED date it started from) or the input is unusable (the grabbed
 *  occurrence no longer exists — e.g. removed mid-drag). A `null` result
 *  must write nothing. */
export function resolveOccurrenceDrag(input: ResolveOccurrenceDragInput): ResolveOccurrenceDragResult | null {
  const { occurrences, eventId, originDate, originalDate, dropDate } = input;
  if (originDate === dropDate) return null;
  const occurrence = occurrences.find((o) => o.eventId === eventId && o.originalDate === originalDate);
  if (!occurrence) return null;
  return { occurrence, toDate: dropDate };
}
