import { describe, expect, it } from "vitest";
import {
  todayInZone,
  isValidTimeZone,
  resolveTimezone,
  formatInZone,
  tzZones,
  dayInZone,
  isoInZone,
} from "./timezone";

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

  // ★★ Every fixture below STRADDLES a day boundary on purpose. A mid-day
  //    instant renders the same calendar date in UTC and in the target zone, so
  //    it passes identically against a `iso.slice(0, 10)` implementation — i.e.
  //    it cannot fail, and cannot pin anything these helpers exist for.
  describe("dayInZone", () => {
    it("files a late-evening UTC instant under the NEXT day east of Greenwich", () => {
      // 00:30 on the 17th in Berlin (UTC+2 in August).
      expect(dayInZone("2026-08-16T22:30:00.000Z", "Europe/Berlin")).toBe("2026-08-17");
      expect(dayInZone("2026-08-16T22:30:00.000Z", "UTC")).toBe("2026-08-16");
    });

    it("files an early-morning UTC instant under the PREVIOUS day west of Greenwich", () => {
      // 18:00 on the 16th in Los Angeles (UTC−7 in August).
      expect(dayInZone("2026-08-17T01:00:00.000Z", "America/Los_Angeles")).toBe("2026-08-16");
      expect(dayInZone("2026-08-17T01:00:00.000Z", "UTC")).toBe("2026-08-17");
    });

    it("returns null for an unparseable instant rather than a bogus date", () => {
      expect(dayInZone("not-a-date", "Europe/Berlin")).toBeNull();
      expect(dayInZone("", "UTC")).toBeNull();
    });

    it("falls back to UTC on a rejected zone, like every other helper here", () => {
      expect(dayInZone("2026-08-16T22:30:00.000Z", "Not/AZone")).toBe("2026-08-16");
    });
  });

  describe("isoInZone", () => {
    it("re-expresses the instant with the zone's offset and wall clock", () => {
      expect(isoInZone("2026-08-16T22:30:00.000Z", "Europe/Berlin")).toBe(
        "2026-08-17T00:30:00+02:00",
      );
      expect(isoInZone("2026-08-17T01:00:00.000Z", "America/Los_Angeles")).toBe(
        "2026-08-16T18:00:00-07:00",
      );
    });

    // ★★ THE DST CASE, and the reason a hardcoded per-zone offset is wrong:
    //    Europe/Berlin is +01:00 in January and +02:00 in July, so the offset
    //    has to be resolved AT the instant, not looked up for the zone.
    it("resolves the offset at the instant, so DST is honoured", () => {
      expect(isoInZone("2026-01-15T12:00:00.000Z", "Europe/Berlin")).toBe(
        "2026-01-15T13:00:00+01:00",
      );
      expect(isoInZone("2026-07-15T12:00:00.000Z", "Europe/Berlin")).toBe(
        "2026-07-15T14:00:00+02:00",
      );
    });

    it("handles a half-hour offset", () => {
      expect(isoInZone("2026-08-16T18:30:00.000Z", "Asia/Kolkata")).toBe(
        "2026-08-17T00:00:00+05:30",
      );
    });

    // ★ `+00:00`, not `Z`: one code path, and the frame is stated explicitly in
    //   every zone rather than only in the ones that are not UTC.
    it("spells a zero offset as +00:00", () => {
      expect(isoInZone("2026-08-16T22:30:00.000Z", "UTC")).toBe("2026-08-16T22:30:00+00:00");
    });

    it("returns an unparseable instant verbatim, mirroring formatInZone", () => {
      expect(isoInZone("not-a-date", "Europe/Berlin")).toBe("not-a-date");
    });

    it("falls back to UTC on a rejected zone", () => {
      expect(isoInZone("2026-08-16T22:30:00.000Z", "Not/AZone")).toBe(
        "2026-08-16T22:30:00+00:00",
      );
    });
  });
});
