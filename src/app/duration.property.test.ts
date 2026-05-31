import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { parseDuration, formatDuration } from "./duration";

describe("duration — properties", () => {
  test("format∘parse round-trips for any positive integer minute count", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000_000 }), (minutes) => {
        // formatDuration decomposes on exact divisors (w=2400, d=480, h=60, m=1),
        // so re-parsing the rendered string must recover the exact total.
        expect(parseDuration(formatDuration(minutes))).toBe(minutes);
      }),
    );
  });

  test("formatDuration is empty for zero or negative minutes", () => {
    fc.assert(
      fc.property(fc.integer({ max: 0 }), (minutes) => {
        expect(formatDuration(minutes)).toBe("");
      }),
    );
  });

  test("parseDuration never throws and yields a non-negative integer or null", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = parseDuration(s);
        if (result === null) return;
        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  test("parseDuration is additive over concatenated unit terms", () => {
    const unit = fc.constantFrom("w", "d", "h", "m");
    const term = fc
      .tuple(fc.integer({ min: 0, max: 999 }), unit)
      .map(([n, u]) => `${n}${u}`);
    fc.assert(
      fc.property(fc.array(term, { minLength: 1, maxLength: 8 }), (terms) => {
        const combined = parseDuration(terms.join(" "));
        const summed = terms.reduce((acc, t) => acc + (parseDuration(t) ?? 0), 0);
        expect(combined).toBe(summed);
      }),
    );
  });
});
