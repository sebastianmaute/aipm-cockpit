// Builds the Resources → Calendar meetings-band occurrence-drag handler
// (R5 Task 17). Extracted so the wiring — resolve the dragged occurrence's
// event by id, commit via applyOccurrenceMove, save through the panel's
// event-save path — is unit-testable without rendering the panel: the band
// itself can't be exercised end to end yet, since resource-calendar.tsx only
// mounts it when `onEditEvent` is ALSO present, and that prop lands
// separately with the series editor modal.
import { applyOccurrenceMove } from "./calendar-event";
import type { CalendarEvent } from "./calendar-event";
import type { Occurrence } from "./recurrence";

export function buildMoveOccurrenceHandler(
  calendarEvents: readonly CalendarEvent[],
  onSaveEvent: (event: CalendarEvent) => void,
): (occurrence: Occurrence, toDate: string) => void {
  return (occurrence, toDate) => {
    const event = calendarEvents.find((e) => e.id === occurrence.eventId);
    if (!event) return; // stale id (e.g. event deleted mid-drag) — no-op, mirrors absence-move-handler.
    // originalDate, NOT occurrence.date: exceptions are keyed by the date
    // the RECURRENCE RULE produced. occurrence.date is the RENDERED date —
    // already moved for a previously-dragged occurrence — so keying off it
    // here would mint a second, contradictory exception on every re-drag
    // instead of updating the one exception that already represents this
    // occurrence.
    onSaveEvent(applyOccurrenceMove(event, occurrence.originalDate, toDate));
  };
}
