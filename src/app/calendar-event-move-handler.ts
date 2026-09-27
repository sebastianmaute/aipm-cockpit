// Builds the Resources → Calendar meetings-band occurrence-drag handler
// (R5 Task 17). Extracted so the wiring — resolve the dragged occurrence's
// event by id, commit via applyOccurrenceMove, save through the panel's
// event-save path — is unit-testable without rendering the panel. When this
// was extracted the band could not be exercised end to end: resource-calendar.tsx
// mounts it only when `onEditEvent` is present, and that prop had not landed.
// It has since, so there are now TWO gates: resources-panel.tsx passes
// `onEditEvent` when not a popout and the caller supplied onEditCalendarEvent
// (the band MOUNTS), but `onMoveOccurrence` is undefined in a popout OR when no
// onSaveCalendarEvent is supplied. A band mounted without a save handler renders
// with its drag UNARMED, not broken (open-followups §457).
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
