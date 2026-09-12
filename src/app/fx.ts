import type { BudgetBucket, FxRates } from "./types";

/**
 * Units of the bucket's currency per 1 EUR. Precedence:
 *   1. 1 for an EUR bucket (true BY DEFINITION — see below)
 *   2. bucket.fxRateOverride (manual; wins while present)
 *   3. cached ECB rate for the currency
 *   4. 1 (unknown currency / no cache)
 *
 * The EUR short-circuit runs FIRST because the rate is defined as units of the
 * bucket's currency per 1 EUR, which for an EUR bucket is 1 by definition — an
 * override on an EUR bucket is incoherent data, not a user preference to
 * honour. The modal's currency <select> never clears the override, so buckets
 * switched back to EUR already carry a stale one; deciding it here repairs
 * those too, which clearing the field on switch could not.
 */
export function resolveRate(bucket: Pick<BudgetBucket, "currency" | "fxRateOverride">, fxRates: FxRates | null): number {
  if (bucket.currency === "EUR") return 1;
  if (bucket.fxRateOverride != null && bucket.fxRateOverride > 0) return bucket.fxRateOverride;
  const cached = fxRates?.rates[bucket.currency];
  return cached != null && cached > 0 ? cached : 1;
}

/** EUR amount -> bucket currency. */
export function eurToCurrency(amountEur: number, bucket: Pick<BudgetBucket, "currency" | "fxRateOverride">, fxRates: FxRates | null): number {
  return amountEur * resolveRate(bucket, fxRates);
}

/** Bucket-currency amount -> EUR. */
export function currencyToEur(amount: number, bucket: Pick<BudgetBucket, "currency" | "fxRateOverride">, fxRates: FxRates | null): number {
  // resolveRate always returns a positive rate (manual override and cached ECB
  // rate are both guarded `> 0`, otherwise it falls back to 1), so the division
  // is never by zero — no zero-rate special case is reachable.
  return amount / resolveRate(bucket, fxRates);
}
