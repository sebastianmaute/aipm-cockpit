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
});
