import type { BudgetBucket, FxRates } from "./types";

/**
 * Units of the bucket's currency per 1 EUR. Precedence:
 *   1. bucket.fxRateOverride (manual; wins while present)
 *   2. cached ECB rate for the currency
 *   3. 1 (EUR base, or unknown currency / no cache)
 */
export function resolveRate(bucket: Pick<BudgetBucket, "currency" | "fxRateOverride">, fxRates: FxRates | null): number {
  if (bucket.fxRateOverride != null && bucket.fxRateOverride > 0) return bucket.fxRateOverride;
  if (bucket.currency === "EUR") return 1;
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
