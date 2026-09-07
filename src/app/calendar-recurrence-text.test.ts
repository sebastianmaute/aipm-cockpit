import { describe, it, expect } from "vitest";
import { recurrenceText } from "./calendar-recurrence-text";

describe("recurrenceText", () => {
  it("describes a plain daily rule", () => {
    expect(recurrenceText({ freq: "daily", interval: 1 })).toBe("Every day");
  });

  it("uses the interval when it is not 1", () => {
    expect(recurrenceText({ freq: "daily", interval: 3 })).toBe("Every 3 days");
  });

  it("names the weekdays of a weekly rule", () => {
    expect(recurrenceText({ freq: "weekly", interval: 1, byDay: ["MO", "WE"] })).toBe(
      "Every week on MO, WE",
    );
  });

  it("describes a monthly rule by day of month", () => {
    expect(recurrenceText({ freq: "monthly", interval: 2, byMonthDay: 15 })).toBe(
      "Every 2 months on day 15",
    );
  });

  it("describes a monthly rule by ordinal weekday", () => {
    expect(
      recurrenceText({ freq: "monthly", interval: 1, byDay: { ordinal: -1, day: "FR" } }),
    ).toBe("Every month on the last FR");
  });

  it("appends an until date", () => {
    expect(recurrenceText({ freq: "daily", interval: 1, until: "2026-12-01" })).toBe(
      "Every day until 2026-12-01",
    );
  });

  it("appends an occurrence count", () => {
    expect(recurrenceText({ freq: "daily", interval: 1, count: 10 })).toBe(
      "Every day, 10 times",
    );
  });

  // ★★ THE NEGATIVE CONTROL. This function is fed by a MODEL patch, so it will
  // meet shapes the type says are impossible. Returning "" for those is what
  // lets the descriptor fall back to its own empty rendering instead of
  // printing "undefined" onto the review card.
  it("returns an empty string for anything that is not a rule", () => {
    expect(recurrenceText(null)).toBe("");
    expect(recurrenceText(undefined)).toBe("");
    expect(recurrenceText({ freq: "hourly", interval: 1 } as never)).toBe("");
    expect(recurrenceText({ interval: 2 } as never)).toBe("");
  });

  // ★★★ PREVIEW⟺WRITE PARITY. `sanitizeRecurrence` (calendar-event.ts) runs
  // `interval` through `intInRange(r.interval, 1, 52, 1)`: only an integer in
  // 1..52 survives, everything else is clamped to 1. A model patch is
  // pre-sanitize, so this projection must clamp identically or the review
  // card can show a value the write will not actually store.
  it("clamps a non-integer interval to 1, same as the write path", () => {
    expect(recurrenceText({ freq: "daily", interval: 0.5 })).toBe("Every day");
  });

  it("clamps an interval over 52 to 1, same as the write path", () => {
    expect(recurrenceText({ freq: "daily", interval: 60 })).toBe("Every day");
  });

  it("clamps a fractional interval over 1 to 1, same as the write path", () => {
    expect(recurrenceText({ freq: "daily", interval: 2.5 })).toBe("Every day");
  });

  it("accepts 52 as the top of the valid interval range", () => {
    expect(recurrenceText({ freq: "weekly", interval: 52 })).toBe("Every 52 weeks");
  });

  it("clamps 53 (one past the valid range) to 1", () => {
    expect(recurrenceText({ freq: "weekly", interval: 53 })).toBe("Every week");
  });

  // ★★★ OMIT, DON'T GUESS. Out of range, the write stores a day derived from
  // the event's startDate (`intInRange(r.byMonthDay, 1, 31, fallbackDom)` in
  // calendar-event.ts's sanitizeRecurrence) — a value this module has no way
  // to see (`forPreview` hands a field projection only the value, never the
  // entity). Printing a guessed day would be a false claim about the write;
  // omitting the clause is a true but incomplete one, and that is the safe
  // direction. The "recurrence" field itself still shows on the card either
  // way — only the day-of-month clause is dropped.
  it("omits the day clause for a byMonthDay over the valid range", () => {
    expect(recurrenceText({ freq: "monthly", interval: 1, byMonthDay: 99 })).toBe("Every month");
  });

  it("omits the day clause for a byMonthDay of 0", () => {
    expect(recurrenceText({ freq: "monthly", interval: 1, byMonthDay: 0 })).toBe("Every month");
  });

  it("omits the day clause for a non-integer byMonthDay", () => {
    expect(recurrenceText({ freq: "monthly", interval: 1, byMonthDay: 15.5 })).toBe("Every month");
  });
});
