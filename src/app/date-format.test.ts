import { describe, it, expect } from "vitest";
import { localeFor, shortDateRange, formatExpiryDate } from "./date-format";
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
