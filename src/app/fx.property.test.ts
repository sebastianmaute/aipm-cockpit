import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { resolveRate, resolveRateSource, baseToCurrency, currencyToBase } from "./fx";
import type { BudgetCurrency, FxRates } from "./types";

const currencyArb = fc.constantFrom<BudgetCurrency>("EUR", "USD", "GBP", "INR");
// §476 — the project baseline is any supported currency, not only EUR.
const baseArb = currencyArb;

// A bucket Pick across all currencies + optional override.
// Used only for resolveRate (no arithmetic, so MAX_VALUE overrides are fine).
// The "unknown currency → rate 1" fallback is still exercised here via USD/GBP
// with no cached rate (resolveRate only takes typed BudgetCurrency values).
const bucketArb = fc.record({
  currency: currencyArb,
  fxRateOverride: fc.option(fc.double({ noNaN: true }), { nil: undefined }),
});

// Same shape but with a realistically-bounded override, so multiply-then-divide
// round-trips don't overflow to Infinity for absurd rates near Number.MAX_VALUE.
const saneBucketArb = fc.record({
  currency: currencyArb,
  fxRateOverride: fc.option(fc.double({ min: 0.01, max: 1000, noNaN: true }), { nil: undefined }),
});

// Arbitrary FxRates (or null), rates kept finite & positive-ish.
const fxRatesArb = fc.option(
  fc.record({
    base: fc.constant("EUR" as const),
    date: fc.constant("2024-01-01"),
    fetchedAt: fc.constant("2024-01-01T00:00:00Z"),
    rates: fc.dictionary(
      fc.constantFrom("USD", "GBP", "INR", "CHF"),
      fc.double({ min: 0.01, max: 1000, noNaN: true }),
    ),
  }),
  { nil: null },
) as fc.Arbitrary<FxRates | null>;

describe("fx — properties", () => {
  test("resolveRate is always strictly positive", () => {
    fc.assert(
      fc.property(bucketArb, fxRatesArb, baseArb, (bucket, fxRates, base) => {
        expect(resolveRate(bucket, fxRates, base)).toBeGreaterThan(0);
      }),
    );
  });

  test("base→currency→base round-trips within float tolerance", () => {
    const amountArb = fc.double({ min: -1e9, max: 1e9, noNaN: true });
    fc.assert(
      fc.property(amountArb, saneBucketArb, fxRatesArb, baseArb, (amount, bucket, fxRates, base) => {
        const back = currencyToBase(baseToCurrency(amount, bucket, fxRates, base), bucket, fxRates, base);
        // Relative tolerance: rate multiply-then-divide re-introduces tiny float
        // error that scales with magnitude, so an absolute epsilon is wrong here.
        expect(Math.abs(back - amount)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(amount)));
      }),
    );
  });

  // §474: `resolveRateSource` is the only thing that can tell a genuinely
  // resolved rate of 1 apart from a rateless bucket read at par — both
  // collapse to `resolveRate(...) === 1`. This pins the two directions of
  // that relationship across arbitrary inputs, not just the handful of fixed
  // fixtures in fx.test.ts.
  test("\"unresolved\" and \"base\" both imply rate === 1; \"base\" iff currency === the base", () => {
    fc.assert(
      fc.property(bucketArb, fxRatesArb, baseArb, (bucket, fxRates, base) => {
        const source = resolveRateSource(bucket, fxRates, base);
        const rate = resolveRate(bucket, fxRates, base);
        if (source === "unresolved" || source === "base") {
          expect(rate).toBe(1);
        }
        expect(source === "base").toBe(bucket.currency === base);
      }),
    );
  });

  test("baseToCurrency is monotonic non-decreasing in the baseline amount", () => {
    const pair = fc
      .tuple(fc.double({ min: -1e6, max: 1e6, noNaN: true }), fc.double({ min: -1e6, max: 1e6, noNaN: true }))
      .map(([a, b]) => (a <= b ? [a, b] : [b, a]) as [number, number]);
    fc.assert(
      fc.property(pair, saneBucketArb, fxRatesArb, baseArb, ([lo, hi], bucket, fxRates, base) => {
        // rate is always > 0, so order is preserved.
        expect(baseToCurrency(lo, bucket, fxRates, base)).toBeLessThanOrEqual(baseToCurrency(hi, bucket, fxRates, base));
      }),
    );
  });
});
