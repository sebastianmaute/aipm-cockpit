import { describe, expect, it } from "vitest";
import { todayInZone, isValidTimeZone, resolveTimezone, formatInZone, tzZones } from "./timezone";

describe("timezone", () => {
  it("todayInZone returns the local calendar date in the zone", () => {
    const now = new Date("2026-06-20T22:00:00Z");
    expect(todayInZone(now, "Pacific/Kiritimati")).toBe("2026-06-21"); // UTC+14 → next day
    expect(todayInZone(now, "Pacific/Pago_Pago")).toBe("2026-06-20");  // UTC-11 → same day
    expect(todayInZone(now, "UTC")).toBe("2026-06-20");
  });
  it("todayInZone is DST-correct", () => {
    expect(todayInZone(new Date("2026-03-08T06:30:00Z"), "America/New_York")).toBe("2026-03-08");
  });
  it("isValidTimeZone accepts IANA, rejects junk", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
  it("resolveTimezone: override > project > browser; skips invalid", () => {
    expect(resolveTimezone("Asia/Kolkata", "Europe/Berlin")).toBe("Asia/Kolkata");
    expect(resolveTimezone(undefined, "Europe/Berlin")).toBe("Europe/Berlin");
    expect(resolveTimezone("Bad/Zone", "Europe/Berlin")).toBe("Europe/Berlin");
    expect(isValidTimeZone(resolveTimezone(undefined, undefined))).toBe(true);
  });
  it("formatInZone renders an ISO instant in a zone", () => {
    const out = formatInZone("2026-06-20T22:00:00Z", "Asia/Kolkata", { hour: "2-digit", minute: "2-digit", hour12: false }, "en-GB");
    expect(out).toContain("03:30");
  });
  it("tzZones returns a non-empty list of valid zones (shared by the pickers)", () => {
    const zones = tzZones();
    expect(zones.length).toBeGreaterThan(0);
    expect(zones.every(isValidTimeZone)).toBe(true);
  });
});
