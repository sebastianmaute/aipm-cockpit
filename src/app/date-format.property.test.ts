import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { localeFor, formatExpiryDate, shortDateRange } from "./date-format";
import type { Lang } from "./i18n";
import type { Absence } from "./types";

const langArb = fc.constantFrom<Lang>("en-US", "en-GB", "de");

const isoDateArb = fc
  .date({ min: new Date("2020-01-01"), max: new Date("2030-12-31"), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

describe("date-format — properties", () => {
  test("localeFor returns one of the three known BCP-47 locales", () => {
    fc.assert(
      fc.property(langArb, (lang) => {
        expect(["en-US", "en-GB", "de-DE"]).toContain(localeFor(lang));
      }),
    );
  });

  test("formatExpiryDate returns the input verbatim for unparseable strings", () => {
    // Non-date junk → returned as-is (the `new Date(...T12:00:00)` is NaN).
    fc.assert(
      fc.property(
        fc.string().filter((s) => Number.isNaN(new Date(`${s}T12:00:00`).valueOf())),
        langArb,
        (junk, lang) => {
          expect(formatExpiryDate(junk, lang)).toBe(junk);
        },
      ),
    );
  });

  test("formatExpiryDate never throws and always returns a non-empty string for valid dates", () => {
    fc.assert(
      fc.property(isoDateArb, langArb, (iso, lang) => {
        const out = formatExpiryDate(iso, lang);
        expect(typeof out).toBe("string");
        expect(out.length).toBeGreaterThan(0);
      }),
    );
  });

  test("shortDateRange never throws for any date pair", () => {
    const absenceArb: fc.Arbitrary<Absence> = fc
      .record({ a: isoDateArb, b: isoDateArb })
      .map(({ a, b }) => {
        const [startDate, endDate] = a <= b ? [a, b] : [b, a];
        return { id: 1, assignee: "x", startDate, endDate, type: "other" as const };
      });
    fc.assert(
      fc.property(absenceArb, langArb, (absence, lang) => {
        expect(typeof shortDateRange(absence, lang)).toBe("string");
      }),
    );
  });
});
