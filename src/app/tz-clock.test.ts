import { describe, expect, it } from "vitest";
import { formatZoneClock } from "./tz-clock";

describe("formatZoneClock", () => {
  it("renders time + short date in the zone", () => {
    const out = formatZoneClock("2026-06-20T22:00:00Z", "Asia/Kolkata", "en-GB");
    expect(out).toContain("03:30"); // 22:00Z + 5:30
    expect(out).toContain("Jun");   // short month present
  });
  it("differs across the date line (date can roll over)", () => {
    const ist = formatZoneClock("2026-06-20T22:00:00Z", "Asia/Kolkata", "en-GB"); // 21 Jun
    const ny = formatZoneClock("2026-06-20T22:00:00Z", "America/New_York", "en-GB"); // 20 Jun
    expect(ist).not.toBe(ny);
    expect(ist).toContain("21");
    expect(ny).toContain("20");
  });
  it("falls back (no throw) on a bad iso", () => {
    expect(formatZoneClock("nope", "UTC", "en-GB")).toBe("nope");
  });
});
