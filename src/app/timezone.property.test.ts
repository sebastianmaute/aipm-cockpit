import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { isValidTimeZone, resolveTimezone, todayInZone, formatInZone } from "./timezone";

// A pool of real IANA zones plus junk, so the arbitraries exercise both the
// valid-zone and the fallback paths.
const REAL_ZONES = ["UTC", "Europe/Berlin", "America/New_York", "Asia/Tokyo", "Australia/Sydney", "America/Sao_Paulo"];
const zoneOrJunkArb = fc.oneof(
  fc.constantFrom(...REAL_ZONES),
  fc.string(),
  fc.constant(undefined),
);

describe("timezone — properties", () => {
  test("isValidTimeZone never throws and agrees with Intl", () => {
    fc.assert(
      fc.property(fc.string(), (tz) => {
        expect(typeof isValidTimeZone(tz)).toBe("boolean");
      }),
    );
    for (const z of REAL_ZONES) expect(isValidTimeZone(z)).toBe(true);
  });

  test("resolveTimezone always returns a valid IANA zone for any inputs", () => {
    fc.assert(
      fc.property(zoneOrJunkArb, zoneOrJunkArb, (override, project) => {
        const out = resolveTimezone(override as string | undefined, project as string | undefined);
        expect(isValidTimeZone(out)).toBe(true);
      }),
    );
  });

  test("resolveTimezone prefers a valid override, then a valid project zone", () => {
    fc.assert(
      fc.property(fc.constantFrom(...REAL_ZONES), fc.constantFrom(...REAL_ZONES), (override, project) => {
        expect(resolveTimezone(override, project)).toBe(override);
        expect(resolveTimezone(undefined, project)).toBe(project);
        expect(resolveTimezone("Not/AZone", project)).toBe(project);
      }),
    );
  });

  test("todayInZone always yields a YYYY-MM-DD string (bad zone falls back to UTC)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(1970, 0, 2), max: Date.UTC(2100, 0, 1) }).map((ms) => new Date(ms)),
        zoneOrJunkArb,
        (now, tz) => {
        const out = todayInZone(now, (tz as string) ?? "");
        expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }),
    );
  });

  test("formatInZone returns the input verbatim for an unparseable instant", () => {
    fc.assert(
      fc.property(fc.constantFrom(...REAL_ZONES), (tz) => {
        expect(formatInZone("not-a-date", tz, { year: "numeric" }, "en-US")).toBe("not-a-date");
      }),
    );
  });
});
