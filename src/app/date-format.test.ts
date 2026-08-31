import { describe, it, expect } from "vitest";
import { localeFor, shortDateRange, shortDateRangeIso, formatExpiryDate, formatFetchedAt } from "./date-format";
import type { Absence } from "./types";
const abs = (startDate: string, endDate: string): Absence =>
  ({ id: 1, assignee: "X", startDate, endDate, type: "vacation" });

describe("localeFor", () => {
  it("maps de → de-DE, en-GB → en-GB, default → en-US", () => {
    expect(localeFor("de")).toBe("de-DE");
    expect(localeFor("en-GB")).toBe("en-GB");
    expect(localeFor("en-US")).toBe("en-US");
  });
});
describe("shortDateRange", () => {
  it("renders a single date when start === end", () => {
    expect(shortDateRange(abs("2026-06-10", "2026-06-10"), "en-US")).not.toContain("–");
  });
  it("renders a range with an en-dash when start !== end", () => {
    expect(shortDateRange(abs("2026-06-10", "2026-06-12"), "en-US")).toContain("–");
  });
  it("falls back to raw ISO strings on an unparseable date", () => {
    expect(shortDateRange(abs("not-a-date", "also-bad"), "en-US")).toBe("not-a-date–also-bad");
  });
});
describe("shortDateRangeIso", () => {
  it("renders a single UTC date when start === end (no en-dash)", () => {
    const s = shortDateRangeIso("2026-06-10", "2026-06-10", "en-US");
    expect(s).not.toContain("–");
    expect(s).toMatch(/Jun/);
  });
  it("renders an en-dashed range when start !== end", () => {
    expect(shortDateRangeIso("2026-06-10", "2026-06-16", "en-US")).toContain("–");
  });
  it("uses UTC so a date does not slip across the day boundary", () => {
    // timeZone: "UTC" means 2026-06-30 always formats as the 30th, never the 29th.
    expect(shortDateRangeIso("2026-06-30", "2026-06-30", "en-US")).toMatch(/30/);
  });
  it("falls back to raw ISO strings on unparseable input", () => {
    expect(shortDateRangeIso("x", "y", "en-US")).toBe("x–y");
  });
});

describe("formatExpiryDate", () => {
  it("formats an ISO date for the locale", () => {
    const s = formatExpiryDate("2026-08-15", "en-US");
    expect(s).toMatch(/Aug/);
    expect(s).toMatch(/2026/);
  });
  it("returns the input unchanged when unparseable", () => {
    expect(formatExpiryDate("not-a-date", "en-US")).toBe("not-a-date");
  });
});

describe("formatFetchedAt", () => {
  // ★ Distinct from `formatExpiryDate`: that one takes a DATE-ONLY string and appends
  //   `T12:00:00`, which turns a value that already carries a time into an Invalid Date.
  //   That is why the two cannot share an implementation.
  it("formats a full ISO timestamp, keeping the time", () => {
    const out = formatFetchedAt("2026-06-23T10:00:00Z", "en-US");
    expect(out).not.toBe("2026-06-23T10:00:00Z");
    expect(out).toMatch(/2026/);
    // The time is the point — this exists to answer "how stale is this?", and on the
    // day of a fetch a date alone answers nothing.
    expect(out).toMatch(/\d{1,2}:\d{2}/);
  });

  // ★ The §122 cue renders this straight into the page, so an unparseable stored
  //   timestamp must degrade to something visible rather than "Invalid Date".
  it("returns the input unchanged when unparseable", () => {
    expect(formatFetchedAt("not-a-date", "en-US")).toBe("not-a-date");
    expect(formatFetchedAt("", "de")).toBe("");
  });
});
