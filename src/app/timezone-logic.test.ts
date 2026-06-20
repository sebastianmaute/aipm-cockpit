import { describe, it, expect } from "vitest";
import { todayInZone, resolveTimezone } from "./timezone";
describe("effective today contract", () => {
  it("uses the override zone for the date boundary", () => {
    const now = new Date("2026-06-20T22:00:00Z");
    expect(todayInZone(now, resolveTimezone("Pacific/Kiritimati", undefined))).toBe("2026-06-21");
  });
  it("falls back project -> browser when no override", () => {
    const now = new Date("2026-06-20T22:00:00Z");
    expect(todayInZone(now, resolveTimezone(undefined, "Pacific/Kiritimati"))).toBe("2026-06-21");
  });
});
