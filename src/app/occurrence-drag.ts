// Pure resolution of a meetings-band drag gesture (R5 Task 14/17 fix). Mirrors
// calendar-drag.ts's resolveCalendarDrag shape: the caller supplies exactly
// what was grabbed (by id AND rendered date, not id alone) and where it was
// dropped; this module decides what that means, or that it means nothing.
//
// Why id alone can't identify the grabbed occurrence: every occurrence of a
// recurring series shares the same eventId — a daily standup viewed over a
// week is one event id, seven Occurrence objects. Resolving a drop by id
// alone (`occurrences.find(o => o.eventId === id)`) returns whichever
// occurrence happens to be first in the list, not the one the user's pointer
// was actually over. `originDate` (the occurrence's RENDERED date at drag
// start) disambiguates.

import type { Occurrence } from "./recurrence";

export interface ResolveOccurrenceDragInput {
  /** Every occurrence currently in the band (all lanes, flattened) — the
   *  pool to resolve the grabbed one from. */
  occurrences: readonly Occurrence[];
  /** The dragged chip's event id. */
  eventId: number;
  /** The dragged chip's RENDERED date at the moment the drag started —
   *  together with eventId this uniquely identifies which occurrence of the
   *  series was grabbed. NOT the same as that occurrence's `originalDate`
   *  (the rule-produced date `applyOccurrenceMove` keys exceptions by) —
   *  callers read `originalDate` off the RESOLVED occurrence, never off this
   *  input. */
  originDate: string;
  /** The date the gesture dropped on. */
  dropDate: string;
}

export interface ResolveOccurrenceDragResult {
  /** The occurrence that was actually grabbed, resolved unambiguously. */
  occurrence: Occurrence;
  toDate: string;
}

/** Resolve a band drag, or `null` when it is a no-op (dropped back on its
 *  own date) or the input is unusable (the grabbed occurrence no longer
 *  exists — e.g. removed mid-drag). A `null` result must write nothing. */
export function resolveOccurrenceDrag(input: ResolveOccurrenceDragInput): ResolveOccurrenceDragResult | null {
  const { occurrences, eventId, originDate, dropDate } = input;
  if (originDate === dropDate) return null;
  const occurrence = occurrences.find((o) => o.eventId === eventId && o.date === originDate);
  if (!occurrence) return null;
  return { occurrence, toDate: dropDate };
}
