import { describe, expect, it } from "vitest";
import { expandOccurrences, MAX_OCCURRENCES } from "./recurrence";
import type { CalendarEvent } from "./calendar-event";

const base: CalendarEvent = {
  id: 1, title: "Standup", startDate: "2026-07-27", startTime: "09:00", durationMinutes: 15,
};
const dates = (e: CalendarEvent, a: string, b: string) =>
  expandOccurrences(e, a, b).occurrences.map((o) => o.date);

describe("expandOccurrences", () => {
  it("returns the single date for a non-recurring event inside the window", () => {
    expect(dates(base, "2026-07-01", "2026-08-31")).toEqual(["2026-07-27"]);
  });

  it("returns nothing for a non-recurring event outside the window", () => {
    expect(dates(base, "2026-09-01", "2026-09-30")).toEqual([]);
  });

  it("expands daily with an interval", () => {
    const e = { ...base, recurrence: { freq: "daily" as const, interval: 3 } };
    expect(dates(e, "2026-07-27", "2026-08-05")).toEqual(["2026-07-27", "2026-07-30", "2026-08-02", "2026-08-05"]);
  });

  it("expands weekly on the start weekday when byDay is absent", () => {
    const e = { ...base, recurrence: { freq: "weekly" as const, interval: 1 } };
    expect(dates(e, "2026-07-27", "2026-08-17")).toEqual(["2026-07-27", "2026-08-03", "2026-08-10", "2026-08-17"]);
  });

  it("expands weekly byDay honouring the interval between weeks", () => {
    const e = { ...base, recurrence: { freq: "weekly" as const, interval: 2, byDay: ["MO" as const, "WE" as const] } };
    expect(dates(e, "2026-07-27", "2026-08-13")).toEqual(["2026-07-27", "2026-07-29", "2026-08-10", "2026-08-12"]);
  });

  it("expands monthly by day-of-month and SKIPS months that lack the day", () => {
    const e = { ...base, startDate: "2026-01-31",
      recurrence: { freq: "monthly" as const, interval: 1, byMonthDay: 31 } };
    // February and April have no 31st — skipped, never clamped to the 28th/30th.
    expect(dates(e, "2026-01-01", "2026-05-31")).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
  });

  it("expands monthly by nth weekday", () => {
    const e = { ...base, startDate: "2026-01-13",
      recurrence: { freq: "monthly" as const, interval: 1, byDay: { ordinal: 2 as const, day: "TU" as const } } };
    expect(dates(e, "2026-01-01", "2026-03-31")).toEqual(["2026-01-13", "2026-02-10", "2026-03-10"]);
  });

  it("expands monthly by LAST weekday", () => {
    const e = { ...base, startDate: "2026-01-27",
      recurrence: { freq: "monthly" as const, interval: 1, byDay: { ordinal: -1 as const, day: "TU" as const } } };
    expect(dates(e, "2026-01-01", "2026-03-31")).toEqual(["2026-01-27", "2026-02-24", "2026-03-31"]);
  });

  it("distinguishes a 4th weekday from the last one in a 5-weekday month", () => {
    const fourth = { ...base, startDate: "2026-01-01",
      recurrence: { freq: "monthly" as const, interval: 1, byDay: { ordinal: 4 as const, day: "FR" as const } } };
    // January 2026 has five Fridays: 2,9,16,23,30. 4th = 23rd, last = 30th.
    expect(dates(fourth, "2026-01-01", "2026-01-31")).toEqual(["2026-01-23"]);
  });

  it("stops at until, inclusive", () => {
    const e = { ...base, recurrence: { freq: "weekly" as const, interval: 1, until: "2026-08-10" } };
    expect(dates(e, "2026-07-01", "2026-12-31")).toEqual(["2026-07-27", "2026-08-03", "2026-08-10"]);
  });

  it("stops after count occurrences even when the window is wider", () => {
    const e = { ...base, recurrence: { freq: "weekly" as const, interval: 1, count: 2 } };
    expect(dates(e, "2026-07-01", "2026-12-31")).toEqual(["2026-07-27", "2026-08-03"]);
  });

  it("counts occurrences from the series start, not from the window start", () => {
    const e = { ...base, recurrence: { freq: "weekly" as const, interval: 1, count: 3 } };
    // The series ends 2026-08-10; a window opening after that yields nothing.
    expect(dates(e, "2026-08-17", "2026-12-31")).toEqual([]);
  });

  it("removes a skipped occurrence", () => {
    const e = { ...base, recurrence: { freq: "weekly" as const, interval: 1 },
      exceptions: [{ date: "2026-08-03", kind: "skip" as const }] };
    expect(dates(e, "2026-07-27", "2026-08-10")).toEqual(["2026-07-27", "2026-08-10"]);
  });

  it("relocates a moved occurrence and remembers its original date", () => {
    const e = { ...base, recurrence: { freq: "weekly" as const, interval: 1 },
      exceptions: [{ date: "2026-08-03", kind: "move" as const, toDate: "2026-08-05", toTime: "16:00" }] };
    const out = expandOccurrences(e, "2026-07-27", "2026-08-10").occurrences;
    const moved = out.find((o) => o.originalDate === "2026-08-03");
    expect(moved).toMatchObject({ date: "2026-08-05", time: "16:00", isMoved: true });
  });

  it("renders an occurrence moved OUTSIDE the window, because the user put it there", () => {
    const e = { ...base, recurrence: { freq: "weekly" as const, interval: 1 },
      exceptions: [{ date: "2026-08-03", kind: "move" as const, toDate: "2026-09-20" }] };
    const out = expandOccurrences(e, "2026-07-27", "2026-08-10").occurrences;
    expect(out.some((o) => o.date === "2026-09-20")).toBe(true);
  });

  it("renders an occurrence moved INTO the window from a rule date outside it", () => {
    // 2026-10-05 is a Monday well past the window — the series would produce it,
    // but it never displays there unmoved. This is the direction that actually
    // needs the isMoved bypass: checking window inclusion against the RULE date
    // (as opposed to unconditionally including a move) would wrongly drop it,
    // yet the "moved OUTSIDE the window" case above can't catch that mistake
    // because its own original date already sits inside the window.
    const e = { ...base, recurrence: { freq: "weekly" as const, interval: 1 },
      exceptions: [{ date: "2026-10-05", kind: "move" as const, toDate: "2026-08-01" }] };
    const out = expandOccurrences(e, "2026-07-27", "2026-08-10").occurrences;
    expect(out).toContainEqual(expect.objectContaining({ date: "2026-08-01", originalDate: "2026-10-05", isMoved: true }));
  });

  it("sorts by displayed date, not by generation order, when a move reorders occurrences", () => {
    // Moving 2026-08-17 to 2026-08-01 places it BEFORE 2026-08-03/08-10 in the
    // output despite being generated after them.
    const e = { ...base, recurrence: { freq: "weekly" as const, interval: 1 },
      exceptions: [{ date: "2026-08-17", kind: "move" as const, toDate: "2026-08-01" }] };
    expect(dates(e, "2026-07-27", "2026-08-17"))
      .toEqual(["2026-07-27", "2026-08-01", "2026-08-03", "2026-08-10"]);
  });

  it("counts a skipped occurrence against count (COUNT is evaluated on the rule's own series, before exceptions)", () => {
    // Slot 1 of 2 is consumed by 2026-07-27 even though it's skipped — the
    // skip does not buy back a slot for a later occurrence to fill instead.
    const e = { ...base, recurrence: { freq: "weekly" as const, interval: 1, count: 2 },
      exceptions: [{ date: "2026-07-27", kind: "skip" as const }] };
    expect(dates(e, "2026-07-01", "2026-12-31")).toEqual(["2026-08-03"]);
  });

  it("reports truncation instead of silently rendering a partial series", () => {
    const e = { ...base, startDate: "2020-01-01", recurrence: { freq: "daily" as const, interval: 1 } };
    const out = expandOccurrences(e, "2020-01-01", "2030-01-01");
    expect(out.truncated).toBe(true);
    expect(out.occurrences).toHaveLength(MAX_OCCURRENCES);
  });

  it("returns an empty, non-throwing result for a malformed window", () => {
    expect(expandOccurrences(base, "garbage", "2026-08-01")).toEqual({ occurrences: [], truncated: false });
    expect(expandOccurrences(base, "2026-08-01", "2026-07-01")).toEqual({ occurrences: [], truncated: false });
  });

  it("does not leak a moved occurrence through an inverted (start > end) window", () => {
    const e = { ...base, recurrence: { freq: "weekly" as const, interval: 1 },
      exceptions: [{ date: "2026-08-03", kind: "move" as const, toDate: "2026-08-05" }] };
    expect(expandOccurrences(e, "2026-08-01", "2026-07-01")).toEqual({ occurrences: [], truncated: false });
  });
});
