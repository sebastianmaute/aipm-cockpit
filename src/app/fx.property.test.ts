import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { resolveRate, eurToCurrency, currencyToEur } from "./fx";
import type { BudgetCurrency, FxRates } from "./types";

const currencyArb = fc.constantFrom<BudgetCurrency>("EUR", "USD", "GBP");

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
      fc.constantFrom("USD", "GBP", "CHF"),
      fc.double({ min: 0.01, max: 1000, noNaN: true }),
    ),
  }),
  { nil: null },
) as fc.Arbitrary<FxRates | null>;

describe("fx — properties", () => {
  test("resolveRate is always strictly positive", () => {
    fc.assert(
      fc.property(bucketArb, fxRatesArb, (bucket, fxRates) => {
        expect(resolveRate(bucket, fxRates)).toBeGreaterThan(0);
      }),
    );
  });

  test("EUR→currency→EUR round-trips within float tolerance", () => {
    const amountArb = fc.double({ min: -1e9, max: 1e9, noNaN: true });
    fc.assert(
      fc.property(amountArb, saneBucketArb, fxRatesArb, (amount, bucket, fxRates) => {
        const back = currencyToEur(eurToCurrency(amount, bucket, fxRates), bucket, fxRates);
        // Relative tolerance: rate multiply-then-divide re-introduces tiny float
        // error that scales with magnitude, so an absolute epsilon is wrong here.
        expect(Math.abs(back - amount)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(amount)));
      }),
    );
  });

  test("eurToCurrency is monotonic non-decreasing in the EUR amount", () => {
    const pair = fc
      .tuple(fc.double({ min: -1e6, max: 1e6, noNaN: true }), fc.double({ min: -1e6, max: 1e6, noNaN: true }))
      .map(([a, b]) => (a <= b ? [a, b] : [b, a]) as [number, number]);
    fc.assert(
      fc.property(pair, saneBucketArb, fxRatesArb, ([lo, hi], bucket, fxRates) => {
        // rate is always > 0, so order is preserved.
        expect(eurToCurrency(lo, bucket, fxRates)).toBeLessThanOrEqual(eurToCurrency(hi, bucket, fxRates));
      }),
    );
  });
});
