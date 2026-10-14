import { describe, expect, test } from "vitest";
import { resolveRate, resolveRateSource, baseToCurrency, currencyToBase, countUnresolvedBuckets } from "./fx";
import type { BudgetBucket, FxRates } from "./types";

// §476 — the engine computes in the project's baseline (`plan.currency`), so
// `resolveRate` answers "units of the bucket's currency per 1 BASE". The cached
// table stays EUR-based (ECB), so a non-EUR base is a cross rate through EUR.
const fx: FxRates = { base: "EUR", date: "2026-10-14", fetchedAt: "x", rates: { EUR: 1, GBP: 0.85, USD: 1.1 } };
const bucket = (extra: Partial<BudgetBucket> = {}): BudgetBucket =>
  ({ id: 1, name: "B", type: "tm", currency: "USD", startDate: "", endDate: "", status: "open", allocations: [], ...extra });

describe("resolveRate with a GBP base", () => {
  test("a GBP bucket is 1 and \"base\", even carrying a stale override", () => {
    const gbp = bucket({ currency: "GBP", fxRateOverride: 2 });
    expect(resolveRate(gbp, fx, "GBP")).toBe(1);
    expect(resolveRateSource(gbp, fx, "GBP")).toBe("base");
  });
  test("an EUR bucket is the inverse of the base's per-EUR rate, \"cached\"", () => {
    const eur = bucket({ currency: "EUR" });
    expect(resolveRate(eur, fx, "GBP")).toBeCloseTo(1 / 0.85, 10);
    expect(resolveRateSource(eur, fx, "GBP")).toBe("cached");
  });
  test("a USD bucket is the cross rate through EUR", () => {
    expect(resolveRate(bucket(), fx, "GBP")).toBeCloseTo(1.1 / 0.85, 10);
    expect(resolveRateSource(bucket(), fx, "GBP")).toBe("cached");
  });
  test("a USD override keeps its per-EUR meaning and is divided by the base's per-EUR rate", () => {
    const usd = bucket({ fxRateOverride: 1.2 });
    expect(resolveRate(usd, fx, "GBP")).toBeCloseTo(1.2 / 0.85, 10);
    expect(resolveRateSource(usd, fx, "GBP")).toBe("override");
  });
});

describe("resolveRate with a GBP base and no table", () => {
  test("an EUR bucket is unresolved — the base itself has no per-EUR rate", () => {
    const eur = bucket({ currency: "EUR" });
    expect(resolveRate(eur, null, "GBP")).toBe(1);
    expect(resolveRateSource(eur, null, "GBP")).toBe("unresolved");
  });
  test("a GBP bucket is still 1 and \"base\"", () => {
    const gbp = bucket({ currency: "GBP" });
    expect(resolveRate(gbp, null, "GBP")).toBe(1);
    expect(resolveRateSource(gbp, null, "GBP")).toBe("base");
  });
});

describe("resolveRate with an EUR base matches the pre-§476 results", () => {
  const legacy: FxRates = { base: "EUR", date: "2026-05-26", fetchedAt: "x", rates: { EUR: 1, USD: 1.08, GBP: 0.85 } };
  test("manual override wins on a non-EUR bucket", () => {
    expect(resolveRate(bucket({ fxRateOverride: 1.2 }), legacy, "EUR")).toBe(1.2);
    expect(resolveRateSource(bucket({ fxRateOverride: 1.2 }), legacy, "EUR")).toBe("override");
  });
  test("falls back to the cached rate", () => {
    expect(resolveRate(bucket(), legacy, "EUR")).toBe(1.08);
    expect(resolveRateSource(bucket(), legacy, "EUR")).toBe("cached");
  });
  test("an EUR bucket is 1 and \"base\", even carrying a stale override", () => {
    expect(resolveRate(bucket({ currency: "EUR", fxRateOverride: 1.1 }), legacy, "EUR")).toBe(1);
    expect(resolveRateSource(bucket({ currency: "EUR", fxRateOverride: 1.1 }), legacy, "EUR")).toBe("base");
  });
  test("unresolved falls back to 1", () => {
    expect(resolveRate(bucket({ currency: "GBP" }), null, "EUR")).toBe(1);
    expect(resolveRateSource(bucket({ currency: "GBP" }), null, "EUR")).toBe("unresolved");
  });
});

describe("conversion against a GBP base", () => {
  test("currencyToBase divides by the cross rate", () => {
    expect(currencyToBase(110, bucket(), fx, "GBP")).toBeCloseTo((110 * 0.85) / 1.1, 10);
  });
  test("baseToCurrency is its inverse", () => {
    const inGbp = currencyToBase(110, bucket(), fx, "GBP");
    expect(baseToCurrency(inGbp, bucket(), fx, "GBP")).toBeCloseTo(110, 10);
  });
});

describe("countUnresolvedBuckets against a GBP base", () => {
  test("with no table, a fixed-price EUR bucket counts and a fixed-price GBP bucket does not", () => {
    expect(countUnresolvedBuckets([bucket({ type: "fixed", currency: "EUR" })], null, "GBP")).toBe(1);
    expect(countUnresolvedBuckets([bucket({ type: "fixed", currency: "GBP" })], null, "GBP")).toBe(0);
  });
});
