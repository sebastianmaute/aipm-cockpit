import type { BudgetBucket, FxRates } from "./types";

/**
 * Which branch of `resolveRate`'s precedence produced its return value.
 * §474: "eur" and "unresolved" both return a rate of 1, and that 1 is
 * INDISTINGUISHABLE from a genuinely resolved rate unless a caller asks for
 * the source separately — never derive "unresolved" from `resolveRate(...)
 * === 1` alone, since a cached or overridden rate can itself legitimately be
 * 1 (a currency trading at par with EUR).
 */
export type RateSource = "eur" | "override" | "cached" | "unresolved";

interface RateResolution {
  source: RateSource;
  rate: number;
}

/**
 * The single precedence walk `resolveRate` and `resolveRateSource` both read
 * from, so the two can never disagree about which branch fired:
 *   1. 1 for an EUR bucket (true BY DEFINITION — see below)
 *   2. bucket.fxRateOverride (manual; wins while present)
 *   3. cached ECB rate for the currency
 *   4. 1 (unknown currency / no cache) — UNRESOLVED, see `RateSource`
 *
 * The EUR short-circuit runs FIRST because the rate is defined as units of the
 * bucket's currency per 1 EUR, which for an EUR bucket is 1 by definition — an
 * override on an EUR bucket is incoherent data, not a user preference to
 * honour. The modal's currency <select> now drops the override on save when a
 * bucket is switched to EUR, but a bucket saved before that fix — or one
 * imported from elsewhere — can still carry a stale override; deciding it
 * here at read time repairs those too, which the write-time fix alone cannot.
 */
function resolveRateInfo(bucket: Pick<BudgetBucket, "currency" | "fxRateOverride">, fxRates: FxRates | null): RateResolution {
  if (bucket.currency === "EUR") return { source: "eur", rate: 1 };
  if (bucket.fxRateOverride != null && bucket.fxRateOverride > 0) return { source: "override", rate: bucket.fxRateOverride };
  const cached = fxRates?.rates[bucket.currency];
  if (cached != null && cached > 0) return { source: "cached", rate: cached };
  return { source: "unresolved", rate: 1 };
}

/** Units of the bucket's currency per 1 EUR. See `resolveRateInfo` for the precedence. */
export function resolveRate(bucket: Pick<BudgetBucket, "currency" | "fxRateOverride">, fxRates: FxRates | null): number {
  return resolveRateInfo(bucket, fxRates).rate;
}

/** Which branch of the precedence produced `resolveRate`'s value. See `RateSource`. */
export function resolveRateSource(bucket: Pick<BudgetBucket, "currency" | "fxRateOverride">, fxRates: FxRates | null): RateSource {
  return resolveRateInfo(bucket, fxRates).source;
}

/**
 * How many of `buckets` put money into a EUR-labelled rollup AT PAR because
 * no rate was ever confirmed for them (§474, `RateSource` "unresolved").
 * ★ Only a FIXED-PRICE bucket qualifies: its contract amount is the one
 * figure that passes through `currencyToEur` (`computeBucketReport`,
 * `computeBurndownSeries`), so it alone is summed 1:1 when the rate is
 * unresolved. A T&M bucket's money is hours × EUR role rates and is converted
 * nowhere, so its missing rate changes none of the figures it contributes —
 * counting it would disclose a par conversion that never happened.
 * Reads `resolveRateSource` directly so the source test cannot disagree with
 * the per-bucket currency-label marker.
 */
export function countUnresolvedBuckets(
  buckets: readonly Pick<BudgetBucket, "type" | "currency" | "fxRateOverride">[],
  fxRates: FxRates | null,
): number {
  return buckets.reduce(
    (count, bucket) => count + (bucket.type === "fixed" && resolveRateSource(bucket, fxRates) === "unresolved" ? 1 : 0),
    0,
  );
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
