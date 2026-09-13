import { describe, expect, test } from "vitest";
import { resolveRate, resolveRateSource, eurToCurrency, currencyToEur } from "./fx";
import type { FxRates, BudgetBucket } from "./types";

const fx: FxRates = { base: "EUR", date: "2026-05-26", fetchedAt: "x", rates: { EUR: 1, USD: 1.08, GBP: 0.85 } };
const bucket = (extra: Partial<BudgetBucket> = {}): BudgetBucket =>
  ({ id: 1, name: "B", type: "tm", currency: "USD", startDate: "", endDate: "", status: "open", allocations: [], ...extra });

describe("resolveRate", () => {
  // ★★ BOTH NAMES CARRY "on a non-EUR bucket", and it is not padding. The EUR
  // short-circuit runs BEFORE the override and before the cache lookup, so
  // neither of these two claims holds unqualified — the third test below is the
  // EUR case and asserts the exact contradiction. Each fixture here is USD only
  // because `bucket()` defaults to it; an unqualified name reads as the whole
  // precedence rule and the file would then state two mutually exclusive ones.
  test("manual override wins when present on a non-EUR bucket", () => {
    expect(resolveRate(bucket({ fxRateOverride: 1.2 }), fx)).toBe(1.2);
  });
  test("falls back to cached ECB rate when no override on a non-EUR bucket", () => {
    expect(resolveRate(bucket(), fx)).toBe(1.08);
  });
  test("falls back to 1 when currency missing / no cache / EUR", () => {
    expect(resolveRate(bucket({ currency: "GBP" }), null)).toBe(1);
    expect(resolveRate(bucket({ currency: "EUR" }), fx)).toBe(1);
  });
  test("an EUR bucket is 1 even carrying a POSITIVE stale override — the short-circuit wins", () => {
    // The rate is units of the bucket's currency per 1 EUR, so for EUR it is 1 by
    // definition and an override on it is incoherent data, not a preference.
    // The override must be POSITIVE: the `> 0` guard already rejects the 0 used
    // by the divide-by-zero case below, so a 0 here would prove nothing.
    expect(resolveRate(bucket({ currency: "EUR", fxRateOverride: 1.1 }), fx)).toBe(1);
    expect(resolveRate(bucket({ currency: "EUR", fxRateOverride: 1.1 }), null)).toBe(1);
  });
});

// §474: `resolveRate` collapses "genuinely resolved to 1" and "no override,
// no cached rate — read at par" into the SAME return value (1), so a caller
// deciding whether to disclose the fallback cannot ask `resolveRate(...) ===
// 1` — that conflates the two. `resolveRateSource` is the only way to tell
// them apart, and MUST agree with `resolveRate` on every branch.
describe("resolveRateSource", () => {
  test("is \"eur\" for an EUR bucket, even carrying a stale positive override", () => {
    expect(resolveRateSource(bucket({ currency: "EUR" }), fx)).toBe("eur");
    expect(resolveRateSource(bucket({ currency: "EUR", fxRateOverride: 1.1 }), fx)).toBe("eur");
  });
  test("is \"override\" when a positive override is present on a non-EUR bucket", () => {
    expect(resolveRateSource(bucket({ fxRateOverride: 1.2 }), fx)).toBe("override");
  });
  test("is \"cached\" when no override but a cached ECB rate exists", () => {
    expect(resolveRateSource(bucket(), fx)).toBe("cached");
  });
  // The case §474 exists for: a "cached" resolution can itself land on 1 (a
  // currency genuinely trading at par with EUR), and that must read as
  // RESOLVED, not as the unresolved fallback below — both return `1` from
  // `resolveRate`, so only the source tells them apart.
  test("is \"cached\", not \"unresolved\", when the cached rate genuinely is 1", () => {
    const parFx: FxRates = { ...fx, rates: { ...fx.rates, USD: 1 } };
    expect(resolveRateSource(bucket({ currency: "USD" }), parFx)).toBe("cached");
    expect(resolveRate(bucket({ currency: "USD" }), parFx)).toBe(1);
  });
  test("is \"unresolved\" when a non-EUR bucket has neither an override nor a cached rate", () => {
    expect(resolveRateSource(bucket({ currency: "GBP" }), null)).toBe("unresolved");
    // fxRates itself resolved (a fetch happened), but this currency's rate
    // never came back — still unresolved, not merely the null-fxRates case.
    const partialFx: FxRates = { base: "EUR", date: "2026-05-26", fetchedAt: "x", rates: { EUR: 1 } };
    expect(resolveRateSource(bucket({ currency: "GBP" }), partialFx)).toBe("unresolved");
  });
  test("a non-positive override does not resolve the rate — falls through to cached or unresolved", () => {
    expect(resolveRateSource(bucket({ fxRateOverride: 0 }), fx)).toBe("cached");
    expect(resolveRateSource(bucket({ fxRateOverride: -5, currency: "GBP" }), null)).toBe("unresolved");
  });
});

describe("conversion", () => {
  test("eurToCurrency multiplies by the rate", () => {
    expect(eurToCurrency(100, bucket(), fx)).toBeCloseTo(108, 5);
  });
  test("currencyToEur divides by the rate", () => {
    expect(currencyToEur(108, bucket(), fx)).toBeCloseTo(100, 5);
  });
  test("both conversions are the identity on an EUR bucket with a stale positive override", () => {
    // `toBe`, not `toBeCloseTo` — identity is the claim, and a rate of 1.1 would
    // land ~9% off rather than one ulp away.
    const eur = bucket({ currency: "EUR", fxRateOverride: 1.1 });
    expect(currencyToEur(80000, eur, fx)).toBe(80000);
    expect(eurToCurrency(80000, eur, fx)).toBe(80000);
  });
  test("currencyToEur never divides by zero — a 0/negative override falls back to a safe rate", () => {
    // resolveRate ignores a non-positive override, so the rate is always > 0.
    expect(currencyToEur(100, bucket({ fxRateOverride: 0 }), fx)).toBeCloseTo(100 / 1.08, 5);
    expect(currencyToEur(100, bucket({ fxRateOverride: -5 }), fx)).toBeCloseTo(100 / 1.08, 5);
    expect(Number.isFinite(currencyToEur(100, bucket({ currency: "EUR", fxRateOverride: 0 }), null))).toBe(true);
  });
});
