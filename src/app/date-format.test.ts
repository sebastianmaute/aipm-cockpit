import { describe, it, expect } from "vitest";
import { localeFor, shortDateRange } from "./date-format";
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
