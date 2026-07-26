import { describe, expect, it } from "vitest";
import {
  sanitizeCalendarEvent, encodeRecurrence, decodeRecurrence,
  encodeExceptions, decodeExceptions, encodeAttendees, decodeAttendees,
} from "./calendar-event";
import type { RecurrenceRule } from "./calendar-event";

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
      ...base, exceptions: [{ date: "2026-08-03", kind: "move", toDate: "garbage" }],
    })?.exceptions).toEqual([{ date: "2026-08-03", kind: "skip" }]);
  });

  it("dedupes exceptions by date, last wins, sorted ascending", () => {
    expect(sanitizeCalendarEvent({
      ...base,
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

  it("passes through localModifiedAt only when it is a string", () => {
    expect(sanitizeCalendarEvent({ ...base, localModifiedAt: "2026-07-26T10:00:00.000Z" })?.localModifiedAt)
      .toBe("2026-07-26T10:00:00.000Z");
    expect(sanitizeCalendarEvent({ ...base, localModifiedAt: 12345 })?.localModifiedAt).toBeUndefined();
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
