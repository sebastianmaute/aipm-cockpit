import { describe, expect, it } from "vitest";
import { expandOccurrences, MAX_OCCURRENCES, nearestOccurrence } from "./recurrence";
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

  it("does not let a skipped byMonthDay month consume a count slot", () => {
    // Feb and Apr have no 31st. With count:2, the two counted occurrences must
    // be Jan31 and Mar31 — Feb/Apr contribute nothing and must not eat a slot
    // that a later valid month would otherwise fill.
    const e = { ...base, startDate: "2026-01-31",
      recurrence: { freq: "monthly" as const, interval: 1, byMonthDay: 31, count: 2 } };
    expect(dates(e, "2026-01-01", "2026-12-31")).toEqual(["2026-01-31", "2026-03-31"]);
  });

  it("expands monthly nth-weekday with interval > 1, skipping intermediate months", () => {
    // 1st Monday of each month, every OTHER month, starting January 2026:
    // Jan 5, Mar 2, May 4 — 2026-02-02 and 2026-04-06 are also 1st Mondays but
    // must be skipped because the interval steps past those months entirely.
    const e = { ...base, startDate: "2026-01-05",
      recurrence: { freq: "monthly" as const, interval: 2, byDay: { ordinal: 1 as const, day: "MO" as const } } };
    expect(dates(e, "2026-01-01", "2026-06-30")).toEqual(["2026-01-05", "2026-03-02", "2026-05-04"]);
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

  it("truncates via the iteration cap — not the output cap — when a series is old and the window is far away and narrow", () => {
    // seriesStart 1970-01-01 to genEnd (windowEnd + the 366-day move buffer) is
    // 20,821 days — past MAX_ITERATIONS (20,000) — while the window itself
    // only opens at day 20,454. The daily walk exhausts its iteration budget
    // roughly 454 days BEFORE it ever reaches the window, so `occurrences` is
    // EMPTY even though `truncated` is true: proof the flag can't be inferred
    // from an empty/short array, and that this cap (distinct from
    // MAX_OCCURRENCES, which never engages here since nothing gets pushed) is
    // real and reachable, not dead code.
    const e = { ...base, startDate: "1970-01-01", recurrence: { freq: "daily" as const, interval: 1 } };
    const out = expandOccurrences(e, "2026-01-01", "2026-01-02");
    expect(out.truncated).toBe(true);
    expect(out.occurrences).toEqual([]);
  });

  it("does not hang on a monthly interval of 0 parked on a month with no candidate (regression: this used to freeze the loop forever)", () => {
    // Feb has no 31st, and interval:0 previously meant the month index never
    // advanced past Feb — so `sink` was never reached and neither exit
    // condition in monthlyLoop could fire. With the fix, a non-positive
    // interval is treated as 1: the walk advances past Feb and picks up
    // every month that DOES have a 31st.
    const e = { ...base, startDate: "2026-02-01",
      recurrence: { freq: "monthly" as const, interval: 0, byMonthDay: 31 } };
    expect(dates(e, "2026-01-01", "2026-12-31")).toEqual([
      "2026-03-31", "2026-05-31", "2026-07-31", "2026-08-31", "2026-10-31", "2026-12-31",
    ]);
  });

  it("treats a NaN monthly interval the same as 1", () => {
    const e = { ...base, startDate: "2026-01-01",
      recurrence: { freq: "monthly" as const, interval: NaN, byMonthDay: 15 } };
    expect(dates(e, "2026-01-01", "2026-04-30")).toEqual([
      "2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15",
    ]);
  });

  it("returns empty and non-truncated (not hung, not falsely truncated) for a byMonthDay no month can ever satisfy", () => {
    // 45 is outside 1-31 — monthlyCandidate returns null every month, forever.
    // There is genuinely nothing this rule ever produces, so the natural
    // monthStart > genEnd exit is reached quickly and truncated stays false —
    // an out-of-range byMonthDay is not the same failure as a non-advancing
    // month, and must not be reported as one.
    const e = { ...base, startDate: "2026-01-01",
      recurrence: { freq: "monthly" as const, interval: 1, byMonthDay: 45 } };
    const out = expandOccurrences(e, "2026-01-01", "2026-12-31");
    expect(out).toEqual({ occurrences: [], truncated: false });
  });

  it("truncates (and says so) via the outer month-step cap when seriesStart is centuries before a narrow, far-future window", () => {
    // genEnd only bounds how far PAST the window generation goes, not how
    // far BEFORE it seriesStart may sit — nothing validates that field's
    // year range. byMonthDay:31 only has a candidate in 7 of 12 months, so
    // walking from year 1 toward a 2026 window takes far more month-steps
    // than the defense-in-depth cap allows before genEnd is ever reached.
    // The result must say truncated, not just come back empty.
    const e = { ...base, startDate: "0001-01-01",
      recurrence: { freq: "monthly" as const, interval: 1, byMonthDay: 31 } };
    const out = expandOccurrences(e, "2026-01-01", "2026-01-02");
    expect(out.truncated).toBe(true);
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

describe("nearestOccurrence", () => {
  it("returns the single date for a non-recurring event at-or-after windowStart, not truncated", () => {
    const { occurrence, truncated } = nearestOccurrence(base, "2026-07-01");
    expect(occurrence?.date).toBe("2026-07-27");
    expect(truncated).toBe(false);
  });

  it("returns no occurrence, and NOT truncated, for a non-recurring event whose date is before windowStart", () => {
    // A confirmed "none" must read differently from a search that gave up —
    // this case is a definite answer, not a truncation.
    const { occurrence, truncated } = nearestOccurrence(base, "2026-08-01");
    expect(occurrence).toBeUndefined();
    expect(truncated).toBe(false);
  });

  it("advances past a skip on the nearest rule date to the true next occurrence", () => {
    const e = { ...base, recurrence: { freq: "weekly" as const, interval: 1 },
      exceptions: [{ date: "2026-07-27", kind: "skip" as const }] };
    expect(nearestOccurrence(e, "2026-07-27").occurrence?.date).toBe("2026-08-03");
  });

  it("returns the moved date/time when the nearest rule date was rescheduled", () => {
    const e = { ...base, recurrence: { freq: "weekly" as const, interval: 1 },
      exceptions: [{ date: "2026-07-27", kind: "move" as const, toDate: "2026-07-29", toTime: "14:00" }] };
    const { occurrence } = nearestOccurrence(e, "2026-07-27");
    expect(occurrence?.date).toBe("2026-07-29");
    expect(occurrence?.time).toBe("14:00");
  });

  it("returns no occurrence, and NOT truncated, for a malformed windowStart", () => {
    const { occurrence, truncated } = nearestOccurrence(base, "garbage");
    expect(occurrence).toBeUndefined();
    expect(truncated).toBe(false);
  });

  it("reports truncated (not just an empty result) when a very-old series exhausts the iteration cap before reaching windowStart", () => {
    // Mirrors expandOccurrences' own "old series, narrow far-future window"
    // truncation test — nearestOccurrence must forward the SAME signal, not
    // collapse it into an indistinguishable empty result.
    const e = { ...base, startDate: "1970-01-01", recurrence: { freq: "daily" as const, interval: 1 } };
    const { occurrence, truncated } = nearestOccurrence(e, "2026-01-01");
    expect(occurrence).toBeUndefined();
    expect(truncated).toBe(true);
  });
});
