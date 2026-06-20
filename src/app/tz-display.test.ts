import { describe, expect, it } from "vitest";
import { formatDisplayTimestamp } from "./tz-display";

describe("formatDisplayTimestamp", () => {
  it("renders an instant in the given zone with a zone label", () => {
    const out = formatDisplayTimestamp("2026-06-20T22:00:00Z", "Asia/Kolkata", "en-GB");
    expect(out).toContain("03:30");          // 22:00Z + 5:30
    expect(out).toMatch(/GMT\+5:30|IST/);    // zone label present
  });
  it("renders UTC", () => {
    expect(formatDisplayTimestamp("2026-06-20T22:00:00Z", "UTC", "en-GB")).toContain("22:00");
  });
  it("returns the raw input on an unparseable date", () => {
    expect(formatDisplayTimestamp("not-a-date", "UTC", "en-GB")).toBe("not-a-date");
  });
  it("includes seconds only when withSeconds is set (activity log)", () => {
    const iso = "2026-06-20T22:00:45Z";
    expect(formatDisplayTimestamp(iso, "UTC", "en-GB")).not.toContain(":45");      // minute precision
    expect(formatDisplayTimestamp(iso, "UTC", "en-GB", { withSeconds: true })).toContain(":45"); // seconds
  });
});
