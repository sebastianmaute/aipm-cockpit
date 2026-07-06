import { describe, expect, test } from "vitest";
import { resolveRate, eurToCurrency, currencyToEur } from "./fx";
import type { FxRates, BudgetBucket } from "./types";

const fx: FxRates = { base: "EUR", date: "2026-05-26", fetchedAt: "x", rates: { EUR: 1, USD: 1.08, GBP: 0.85 } };
const bucket = (extra: Partial<BudgetBucket> = {}): BudgetBucket =>
  ({ id: 1, name: "B", type: "tm", currency: "USD", startDate: "", endDate: "", status: "open", allocations: [], ...extra });

describe("resolveRate", () => {
  test("manual override wins when present", () => {
    expect(resolveRate(bucket({ fxRateOverride: 1.2 }), fx)).toBe(1.2);
  });
  test("falls back to cached ECB rate when no override", () => {
    expect(resolveRate(bucket(), fx)).toBe(1.08);
  });
  test("falls back to 1 when currency missing / no cache / EUR", () => {
    expect(resolveRate(bucket({ currency: "GBP" }), null)).toBe(1);
    expect(resolveRate(bucket({ currency: "EUR" }), fx)).toBe(1);
  });
});

describe("conversion", () => {
  test("eurToCurrency multiplies by the rate", () => {
    expect(eurToCurrency(100, bucket(), fx)).toBeCloseTo(108, 5);
  });
  test("currencyToEur divides by the rate", () => {
    expect(currencyToEur(108, bucket(), fx)).toBeCloseTo(100, 5);
  });
  test("currencyToEur never divides by zero — a 0/negative override falls back to a safe rate", () => {
    // resolveRate ignores a non-positive override, so the rate is always > 0.
    expect(currencyToEur(100, bucket({ fxRateOverride: 0 }), fx)).toBeCloseTo(100 / 1.08, 5);
    expect(currencyToEur(100, bucket({ fxRateOverride: -5 }), fx)).toBeCloseTo(100 / 1.08, 5);
    expect(Number.isFinite(currencyToEur(100, bucket({ currency: "EUR", fxRateOverride: 0 }), null))).toBe(true);
  });
});
