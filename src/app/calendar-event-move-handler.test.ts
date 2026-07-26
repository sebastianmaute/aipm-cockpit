import { describe, it, expect, vi } from "vitest";
import { buildMoveOccurrenceHandler } from "./calendar-event-move-handler";
import type { CalendarEvent } from "./calendar-event";
import type { Occurrence } from "./recurrence";

const recurring: CalendarEvent = {
  id: 1,
  title: "Standup",
  startDate: "2026-07-27",
  startTime: "09:00",
  durationMinutes: 15,
  recurrence: { freq: "daily", interval: 1 },
};

const single: CalendarEvent = {
  id: 2,
  title: "Kickoff",
  startDate: "2026-08-01",
  startTime: "10:00",
  durationMinutes: 60,
};

function occ(overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    eventId: 1,
    date: "2026-08-03",
    time: "09:00",
    durationMinutes: 15,
    originalDate: "2026-08-03",
    isMoved: false,
    ...overrides,
  };
}

describe("buildMoveOccurrenceHandler", () => {
  it("writes a move exception keyed by the ORIGINAL (rule-produced) date for a recurring series", () => {
    const onSaveEvent = vi.fn();
    const handler = buildMoveOccurrenceHandler([recurring], onSaveEvent);
    handler(occ(), "2026-08-05");
    expect(onSaveEvent).toHaveBeenCalledTimes(1);
    expect(onSaveEvent).toHaveBeenCalledWith({
      ...recurring,
      exceptions: [{ date: "2026-08-03", kind: "move", toDate: "2026-08-05" }],
    });
    // The rule itself is untouched — every OTHER occurrence keeps rendering.
    expect(onSaveEvent.mock.calls[0][0].startDate).toBe("2026-07-27");
  });

  it("rewrites startDate directly for a non-recurring event, minting no exception", () => {
    const onSaveEvent = vi.fn();
    const handler = buildMoveOccurrenceHandler([single], onSaveEvent);
    handler(occ({ eventId: 2, date: "2026-08-01", originalDate: "2026-08-01" }), "2026-08-04");
    expect(onSaveEvent).toHaveBeenCalledWith({ ...single, startDate: "2026-08-04" });
    expect(onSaveEvent.mock.calls[0][0].exceptions).toBeUndefined();
  });

  it("updates the SAME exception rather than stacking a second one when dragged again", () => {
    const onSaveEvent = vi.fn();
    const firstDrag = buildMoveOccurrenceHandler([recurring], onSaveEvent);
    firstDrag(occ(), "2026-08-05");
    const afterFirstDrag = onSaveEvent.mock.calls[0][0] as CalendarEvent;
    expect(afterFirstDrag.exceptions).toEqual([{ date: "2026-08-03", kind: "move", toDate: "2026-08-05" }]);

    // Re-drag the SAME occurrence — now rendered on its moved date, but
    // originalDate (what the caller must pass, per Occurrence's own
    // contract) is still the rule-produced "2026-08-03".
    const secondDrag = buildMoveOccurrenceHandler([afterFirstDrag], onSaveEvent);
    secondDrag(occ({ date: "2026-08-05", originalDate: "2026-08-03", isMoved: true }), "2026-08-06");

    expect(onSaveEvent).toHaveBeenCalledTimes(2);
    const afterSecondDrag = onSaveEvent.mock.calls[1][0] as CalendarEvent;
    // Exactly ONE exception, updated in place — not two contradictory ones.
    expect(afterSecondDrag.exceptions).toEqual([{ date: "2026-08-03", kind: "move", toDate: "2026-08-06" }]);
  });

  it("is a no-op when the dragged occurrence's event no longer exists", () => {
    const onSaveEvent = vi.fn();
    const handler = buildMoveOccurrenceHandler([], onSaveEvent);
    handler(occ({ eventId: 999 }), "2026-08-05");
    expect(onSaveEvent).not.toHaveBeenCalled();
  });
});
