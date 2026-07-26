import { describe, expect, it } from "vitest";
import {
  sanitizeCalendarEvent, encodeRecurrence, decodeRecurrence,
  encodeExceptions, decodeExceptions, encodeAttendees, decodeAttendees,
  applyOccurrenceMove,
} from "./calendar-event";
import type { CalendarEvent, RecurrenceRule } from "./calendar-event";

const base = { id: 1, title: "Standup", startDate: "2026-07-27", startTime: "09:00", durationMinutes: 15 };

describe("sanitizeCalendarEvent", () => {
  it("accepts a minimal valid event", () => {
    expect(sanitizeCalendarEvent(base)).toMatchObject({ id: 1, title: "Standup", startTime: "09:00", durationMinutes: 15 });
  });

  it("returns null without an id, a title or a start date", () => {
    expect(sanitizeCalendarEvent({ ...base, id: 0 })).toBeNull();
    expect(sanitizeCalendarEvent({ ...base, title: "   " })).toBeNull();
    expect(sanitizeCalendarEvent({ ...base, startDate: "nope" })).toBeNull();
    expect(sanitizeCalendarEvent(null)).toBeNull();
  });

  it("defaults a malformed time and duration instead of rejecting the event", () => {
    expect(sanitizeCalendarEvent({ ...base, startTime: "25:00" })?.startTime).toBe("09:00");
    expect(sanitizeCalendarEvent({ ...base, durationMinutes: 0 })?.durationMinutes).toBe(60);
    expect(sanitizeCalendarEvent({ ...base, durationMinutes: 99999 })?.durationMinutes).toBe(60);
  });

  it("keeps only one range terminator, preferring until", () => {
    const out = sanitizeCalendarEvent({
      ...base, recurrence: { freq: "weekly", interval: 1, until: "2026-12-31", count: 10 },
    });
    expect(out?.recurrence).toEqual({ freq: "weekly", interval: 1, until: "2026-12-31" });
  });

  it("drops an until that precedes the start", () => {
    const out = sanitizeCalendarEvent({
      ...base, recurrence: { freq: "daily", interval: 1, until: "2026-07-01" },
    });
    expect(out?.recurrence).toEqual({ freq: "daily", interval: 1 });
  });

  it("prefers byDay over byMonthDay for monthly and defaults the day-of-month otherwise", () => {
    expect(sanitizeCalendarEvent({
      ...base, recurrence: { freq: "monthly", interval: 1, byMonthDay: 5, byDay: { ordinal: 2, day: "TU" } },
    })?.recurrence).toEqual({ freq: "monthly", interval: 1, byDay: { ordinal: 2, day: "TU" } });

    expect(sanitizeCalendarEvent({
      ...base, recurrence: { freq: "monthly", interval: 1 },
    })?.recurrence).toEqual({ freq: "monthly", interval: 1, byMonthDay: 27 });
  });

  it("dedupes and orders weekly byDay, dropping an empty list", () => {
    expect(sanitizeCalendarEvent({
      ...base, recurrence: { freq: "weekly", interval: 1, byDay: ["FR", "MO", "MO", "BAD"] },
    })?.recurrence).toEqual({ freq: "weekly", interval: 1, byDay: ["MO", "FR"] });

    expect(sanitizeCalendarEvent({
      ...base, recurrence: { freq: "weekly", interval: 1, byDay: [] },
    })?.recurrence).toEqual({ freq: "weekly", interval: 1 });
  });

  it("clamps interval into range", () => {
    expect(sanitizeCalendarEvent({ ...base, recurrence: { freq: "daily", interval: 0 } })?.recurrence)
      .toEqual({ freq: "daily", interval: 1 });
  });

  it("keeps count when supplied alone (no until)", () => {
    expect(sanitizeCalendarEvent({
      ...base, recurrence: { freq: "daily", interval: 1, count: 5 },
    })?.recurrence).toEqual({ freq: "daily", interval: 1, count: 5 });
  });

  it("drops an out-of-range count, leaving no range terminator", () => {
    expect(sanitizeCalendarEvent({
      ...base, recurrence: { freq: "daily", interval: 1, count: 0 },
    })?.recurrence).toEqual({ freq: "daily", interval: 1 });
    expect(sanitizeCalendarEvent({
      ...base, recurrence: { freq: "daily", interval: 1, count: 501 },
    })?.recurrence).toEqual({ freq: "daily", interval: 1 });
  });

  it("degrades a move exception with an invalid target to a skip", () => {
    expect(sanitizeCalendarEvent({
      ...base, recurrence: { freq: "daily", interval: 1 },
      exceptions: [{ date: "2026-08-03", kind: "move", toDate: "garbage" }],
    })?.exceptions).toEqual([{ date: "2026-08-03", kind: "skip" }]);
  });

  it("dedupes exceptions by date, last wins, sorted ascending", () => {
    expect(sanitizeCalendarEvent({
      ...base,
      recurrence: { freq: "daily", interval: 1 },
      exceptions: [
        { date: "2026-09-01", kind: "skip" },
        { date: "2026-08-03", kind: "skip" },
        { date: "2026-09-01", kind: "move", toDate: "2026-09-02" },
      ],
    })?.exceptions).toEqual([
      { date: "2026-08-03", kind: "skip" },
      { date: "2026-09-01", kind: "move", toDate: "2026-09-02" },
    ]);
  });

  it("drops exceptions when there is no recurrence rule (a per-occurrence exception has no rule to except from)", () => {
    // Regression: converting a recurring series back to non-recurring left
    // its exceptions in place, and expandOccurrences with no rule renders
    // the single series-start date directly — a lingering `skip` on that
    // exact date then made the event render nowhere while it still appeared
    // in the series list.
    expect(sanitizeCalendarEvent({
      ...base,
      exceptions: [{ date: "2026-08-03", kind: "skip" }],
    })?.exceptions).toBeUndefined();
    // Also when recurrence is present but rejected by the sanitizer itself
    // (an unrecognized freq), not just when it was never set.
    expect(sanitizeCalendarEvent({
      ...base,
      recurrence: { freq: "yearly" },
      exceptions: [{ date: "2026-08-03", kind: "skip" }],
    })?.exceptions).toBeUndefined();
  });

  it("keeps dangling attendee ids rather than silently dropping them", () => {
    expect(sanitizeCalendarEvent({ ...base, attendeeResourceIds: [3, 3, -1, 9] })?.attendeeResourceIds)
      .toEqual([3, 9]);
  });

  it("treats sendInvitations as true only when it is literally true", () => {
    expect(sanitizeCalendarEvent({ ...base, sendInvitations: "yes" })?.sendInvitations).toBeUndefined();
    expect(sanitizeCalendarEvent({ ...base, sendInvitations: true })?.sendInvitations).toBe(true);
  });

  it("trims location, caps it, and omits it when blank", () => {
    expect(sanitizeCalendarEvent({ ...base, location: "  Room 4  " })?.location).toBe("Room 4");
    expect(sanitizeCalendarEvent({ ...base, location: "   " })?.location).toBeUndefined();
    expect(sanitizeCalendarEvent({ ...base, location: "x".repeat(300) })?.location).toHaveLength(200);
  });

  it("preserves notes whitespace (multiline, leading/trailing) while capping length", () => {
    expect(sanitizeCalendarEvent({ ...base, notes: "line one\nline two" })?.notes).toBe("line one\nline two");
    expect(sanitizeCalendarEvent({ ...base, notes: "  padded  " })?.notes).toBe("  padded  ");
    expect(sanitizeCalendarEvent({ ...base, notes: "x".repeat(2500) })?.notes).toHaveLength(2000);
    expect(sanitizeCalendarEvent({ ...base, notes: "" })?.notes).toBeUndefined();
  });

  it("passes through localModifiedAt only when it is a non-empty string", () => {
    expect(sanitizeCalendarEvent({ ...base, localModifiedAt: "2026-07-26T10:00:00.000Z" })?.localModifiedAt)
      .toBe("2026-07-26T10:00:00.000Z");
    expect(sanitizeCalendarEvent({ ...base, localModifiedAt: 12345 })?.localModifiedAt).toBeUndefined();
    // A raw "" (what every unset CSV/MD cell decodes to) must normalize to
    // absent, not survive as a literal empty string — every caller that hands
    // the sanitizer a raw row object relies on this, not just one codec.
    expect(sanitizeCalendarEvent({ ...base, localModifiedAt: "" })?.localModifiedAt).toBeUndefined();
  });

  it("trims and caps outlookEventId, omitting it when blank", () => {
    expect(sanitizeCalendarEvent({ ...base, outlookEventId: "  AAMk...  " })?.outlookEventId).toBe("AAMk...");
    expect(sanitizeCalendarEvent({ ...base, outlookEventId: "" })?.outlookEventId).toBeUndefined();
  });
});

describe("JSON-in-cell codecs", () => {
  it("round-trips a recurrence rule", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 2, byDay: ["MO", "WE"] };
    expect(decodeRecurrence(encodeRecurrence(rule))).toEqual(rule);
  });

  it("encodes an absent value to the empty string and back to undefined", () => {
    expect(encodeRecurrence(undefined)).toBe("");
    expect(decodeRecurrence("")).toBeUndefined();
    expect(encodeExceptions(undefined)).toBe("");
    expect(decodeExceptions("")).toBeUndefined();
  });

  it("returns undefined for malformed JSON rather than throwing", () => {
    expect(decodeRecurrence("{not json")).toBeUndefined();
    expect(decodeExceptions("[[[")).toBeUndefined();
  });

  it("round-trips an attendee id list", () => {
    expect(decodeAttendees(encodeAttendees([3, 9]))).toEqual([3, 9]);
  });

  it("encodes an absent attendee list to the empty string and back to undefined", () => {
    expect(encodeAttendees(undefined)).toBe("");
    expect(decodeAttendees("")).toBeUndefined();
  });

  it("filters a malformed attendee cell down to the valid positive integers", () => {
    expect(decodeAttendees("abc|def|-1|0|5")).toEqual([5]);
  });
});

describe("applyOccurrenceMove", () => {
  const recurring: CalendarEvent = {
    ...base,
    recurrence: { freq: "weekly", interval: 1, byDay: ["MO"] },
  };

  it("records a move exception on a recurring series, leaving startDate and recurrence untouched", () => {
    const out = applyOccurrenceMove(recurring, "2026-08-03", "2026-08-05");
    expect(out.startDate).toBe(recurring.startDate);
    expect(out.recurrence).toEqual(recurring.recurrence);
    expect(out.exceptions).toEqual([{ date: "2026-08-03", kind: "move", toDate: "2026-08-05" }]);
  });

  it("moving the same occurrence twice replaces the exception rather than appending a second one", () => {
    const oncemoved = applyOccurrenceMove(recurring, "2026-08-03", "2026-08-05");
    const twicemoved = applyOccurrenceMove(oncemoved, "2026-08-03", "2026-08-07");
    expect(twicemoved.exceptions).toEqual([{ date: "2026-08-03", kind: "move", toDate: "2026-08-07" }]);
  });

  it("a non-recurring event has startDate rewritten and gains NO exceptions", () => {
    const nonRecurring: CalendarEvent = { ...base }; // no recurrence
    const out = applyOccurrenceMove(nonRecurring, nonRecurring.startDate, "2026-08-05");
    expect(out.startDate).toBe("2026-08-05");
    expect(out.exceptions).toBeUndefined();
  });

  it("a no-op move (originalDate === toDate) returns the event unchanged, by reference", () => {
    const out = applyOccurrenceMove(recurring, "2026-08-03", "2026-08-03");
    expect(out).toBe(recurring);
  });

  it("keeps exceptions sorted ascending by date when the new one sorts before an existing one", () => {
    const withLaterException: CalendarEvent = {
      ...recurring,
      exceptions: [{ date: "2026-08-10", kind: "skip" }],
    };
    const out = applyOccurrenceMove(withLaterException, "2026-08-01", "2026-08-02");
    expect(out.exceptions).toEqual([
      { date: "2026-08-01", kind: "move", toDate: "2026-08-02" },
      { date: "2026-08-10", kind: "skip" },
    ]);
  });

  it("keyed by originalDate (the date the RULE produced), not the moved-to date — moving the already-relocated occurrence again still targets the original slot", () => {
    const oncemoved = applyOccurrenceMove(recurring, "2026-08-03", "2026-08-05");
    // A caller that (incorrectly) keyed off the rendered date would pass
    // "2026-08-05" here instead of the true originalDate "2026-08-03".
    const movedAgain = applyOccurrenceMove(oncemoved, "2026-08-03", "2026-08-09");
    expect(movedAgain.exceptions).toEqual([{ date: "2026-08-03", kind: "move", toDate: "2026-08-09" }]);
  });

  it("carries a prior exception's toTime forward into a re-move, instead of silently dropping it", () => {
    // Regression: this function builds { date, kind: "move", toDate } with
    // no toTime, so re-dragging an occurrence that also carried a moved
    // time (settable today via a hand-edited file, and by S7's Outlook
    // pull) reverted it to the event's own startTime.
    const withTimedMove: CalendarEvent = {
      ...recurring,
      exceptions: [{ date: "2026-08-03", kind: "move", toDate: "2026-08-05", toTime: "14:30" }],
    };
    const redragged = applyOccurrenceMove(withTimedMove, "2026-08-03", "2026-08-06");
    expect(redragged.exceptions).toEqual([
      { date: "2026-08-03", kind: "move", toDate: "2026-08-06", toTime: "14:30" },
    ]);
  });

  it("does not invent a toTime when the prior exception on that date had none (a plain skip, or no prior exception)", () => {
    const withSkip: CalendarEvent = {
      ...recurring,
      exceptions: [{ date: "2026-08-03", kind: "skip" }],
    };
    const out = applyOccurrenceMove(withSkip, "2026-08-03", "2026-08-06");
    expect(out.exceptions).toEqual([{ date: "2026-08-03", kind: "move", toDate: "2026-08-06" }]);

    const first = applyOccurrenceMove(recurring, "2026-08-03", "2026-08-05");
    expect(first.exceptions).toEqual([{ date: "2026-08-03", kind: "move", toDate: "2026-08-05" }]);
  });

  it("the result still satisfies sanitizeCalendarEvent unchanged (feeding it back through is a no-op)", () => {
    const withLaterException: CalendarEvent = {
      ...recurring,
      exceptions: [{ date: "2026-08-10", kind: "skip" }],
    };
    const moved = applyOccurrenceMove(withLaterException, "2026-08-01", "2026-08-02");
    expect(sanitizeCalendarEvent(moved)).toEqual(moved);

    const nonRecurring: CalendarEvent = { ...base };
    const movedNonRecurring = applyOccurrenceMove(nonRecurring, nonRecurring.startDate, "2026-08-05");
    expect(sanitizeCalendarEvent(movedNonRecurring)).toEqual(movedNonRecurring);
  });
});
