import { beforeEach, describe, expect, it } from "vitest";
import {
  sanitizeCalendarEvent, encodeRecurrence, decodeRecurrence,
  encodeExceptions, decodeExceptions, encodeAttendees, decodeAttendees,
  applyOccurrenceMove, acceptsEventDate,
  sanitizeLoadedCalendarEvent, sanitizeCalendarEventForUpdate,
} from "./calendar-event";
import type { CalendarEvent, RecurrenceRule } from "./calendar-event";
import { buildCalendarEventFromObj } from "./csv-codecs-core";
import { __resetNonCalendarDateReportsForTests } from "./sanitize-load-date";
import { clearDiagLog, readDiagLog } from "./diagnostics";
import { emptyWorkspace, jsonToWorkspace, workspaceToJson } from "./workspace";

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

// `acceptsEventDate` exists so the AI review card can ask THIS module's own
// question instead of a similar one. It is exported for
// `INLINE_DESCRIPTORS.calendarEvent.acceptsDate`; these cases pin it at the
// source, where the two legs that separate it from `sanitizeIsoDate` live.
describe("acceptsEventDate", () => {
  it("agrees with sanitizeCalendarEvent on the shapes that separate it from sanitizeIsoDate", () => {
    // The `Date.parse` leg `sanitizeIsoDate` lacks: an impossible calendar day.
    expect(acceptsEventDate("2026-01-32")).toBe(false);
    expect(sanitizeCalendarEvent({ ...base, startDate: "2026-01-32" })).toBeNull();

    // The absent year bound `sanitizeIsoDate` has: pre-1900 is STORED here.
    expect(acceptsEventDate("1899-12-31")).toBe(true);
    expect(sanitizeCalendarEvent({ ...base, startDate: "1899-12-31" })?.startDate).toBe("1899-12-31");
  });

  it("refuses a non-string and a non-ISO string", () => {
    expect(acceptsEventDate(20260101)).toBe(false);
    expect(acceptsEventDate("2026-1-1")).toBe(false);
    expect(acceptsEventDate(null)).toBe(false);
    expect(acceptsEventDate("2026-07-27")).toBe(true);
  });

  // §542: the preview asks the CREATE rule, so a day that overflows its own
  //  month is refused here exactly as the strict write refuses it.
  it("refuses a day that overflows its month, as the create rule does", () => {
    expect(acceptsEventDate("2026-02-30")).toBe(false);
    expect(acceptsEventDate("2028-02-29")).toBe(true);
  });
});

const ev = (over: Record<string, unknown> = {}) => ({
  id: 7, title: "Standup", startDate: "2026-03-02", startTime: "09:00", durationMinutes: 15, ...over,
});
const weekly = (until: string) => ({ freq: "weekly", interval: 1, until });
const kept = () => readDiagLog().filter((e) => e.code === "storage.nonCalendarDateKept").map((e) => e.fields);

describe("§542 date rules — create, load and update each have their own", () => {
  beforeEach(() => { __resetNonCalendarDateReportsForTests(); clearDiagLog(); });

  // (a) CREATE: a real calendar date, any year. (a1)–(a3) are RED against the
  //  pre-§542 rule, which accepted every one of these and rolled it over.
  it("(a1) refuses a calendar-invalid startDate", () => {
    expect(sanitizeCalendarEvent(ev({ startDate: "2026-02-30" }))).toBeNull();
  });
  it("(a2) omits a calendar-invalid until and keeps the rule", () => {
    const out = sanitizeCalendarEvent(ev({ recurrence: weekly("2026-04-31") }));
    expect(out?.recurrence).toBeDefined();
    expect(out?.recurrence?.until).toBeUndefined();
  });
  it("(a3) drops an exception with an invalid date, and degrades a move with an invalid toDate to a skip", () => {
    const out = sanitizeCalendarEvent(ev({
      recurrence: weekly("2026-06-30"),
      exceptions: [
        { date: "2026-02-30", kind: "skip" },
        { date: "2026-03-09", kind: "move", toDate: "2026-04-31" },
      ],
    }));
    expect(out?.exceptions).toEqual([{ date: "2026-03-09", kind: "skip" }]);
  });
  it("(a4) has no year bound: 2200 is accepted on create", () => {
    expect(sanitizeCalendarEvent(ev({ startDate: "2200-01-05" }))?.startDate).toBe("2200-01-05");
  });

  // (b) LOAD: everything that loaded before §542 still loads, unchanged.
  //  ★★ These are GREEN against the pre-§542 code too, and must be: they are the
  //  REGRESSION GUARD for the load funnels, not evidence of the fix. They go red
  //  only when a load site is left on the strict form, or when the load reader
  //  blanks instead of keeping (mutants 2c–2f).
  it("(b1) keeps a stored calendar-invalid startDate, and reports it", () => {
    const out = sanitizeLoadedCalendarEvent(ev({ startDate: "2026-02-30" }));
    expect(out?.startDate).toBe("2026-02-30");
    expect(kept()).toEqual([{ source: "workspace", entity: "calendarEvent", id: 7, field: "startDate" }]);
  });
  it("(b1b) reports nothing for a real date", () => {
    sanitizeLoadedCalendarEvent(ev());
    expect(kept()).toEqual([]); // absence: paired with (b1), which proves the probe can see one
  });
  it("(b2) keeps a stored calendar-invalid until, so the series stays BOUNDED", () => {
    const out = sanitizeLoadedCalendarEvent(ev({ recurrence: weekly("2026-04-31") }));
    expect(out?.recurrence?.until).toBe("2026-04-31");
  });
  it("(b3) keeps a stored event outside 1900–2100", () => {
    expect(sanitizeLoadedCalendarEvent(ev({ startDate: "2200-01-05" }))?.startDate).toBe("2200-01-05");
  });
  it("(b4) still drops what was always dropped: a month outside 01–12", () => {
    expect(sanitizeLoadedCalendarEvent(ev({ startDate: "2026-13-01" }))).toBeNull();
  });
  it("(b5) the CSV / Markdown / Turso funnel keeps it too", () => {
    const out = buildCalendarEventFromObj({
      id: "7", title: "Standup", startDate: "2026-02-30", startTime: "09:00", durationMinutes: "15",
      recurrence: JSON.stringify(weekly("2026-04-31")), exceptions: "", attendeeResourceIds: "",
    });
    expect(out?.startDate).toBe("2026-02-30");
    expect(out?.recurrence?.until).toBe("2026-04-31");
  });

  // (d) UPDATE: an untouched stored date is carried; a changed one must be real.
  const stored: CalendarEvent = {
    id: 7, title: "Standup", startDate: "2026-02-30", startTime: "09:00", durationMinutes: 15,
    recurrence: { freq: "weekly", interval: 1, until: "2026-04-31" },
  };
  it("(b6) the JSON funnel keeps it too", () => {
    const text = workspaceToJson({ ...emptyWorkspace(), calendarEvents: [stored] });
    expect(text).toContain("2026-02-30"); // presence: the fixture really reached the stored form
    const out = jsonToWorkspace(text);
    expect(out.calendarEvents?.[0]?.startDate).toBe("2026-02-30");
    expect(out.calendarEvents?.[0]?.recurrence?.until).toBe("2026-04-31");
  });
  it("(d1) saves a title-only edit of an event whose stored dates are calendar-invalid", () => {
    const out = sanitizeCalendarEventForUpdate({ ...stored, title: "Daily" }, stored);
    expect(out?.title).toBe("Daily");
    expect(out?.startDate).toBe("2026-02-30");
    expect(out?.recurrence?.until).toBe("2026-04-31");
  });
  it("(d2) refuses a CHANGE to another calendar-invalid date", () => {
    expect(sanitizeCalendarEventForUpdate({ ...stored, startDate: "2026-04-31" }, stored)).toBeNull();
  });
  it("(d3) accepts a change to a real date", () => {
    expect(sanitizeCalendarEventForUpdate({ ...stored, startDate: "2026-03-02" }, stored)?.startDate)
      .toBe("2026-03-02");
  });
});
