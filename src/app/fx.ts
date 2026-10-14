import type { BudgetBucket, BudgetCurrency, FxRates } from "./types";
import { isContractPriced } from "./types";

/**
 * Which branch of `resolveRate`'s precedence produced its return value.
 * §474: "base" and "unresolved" both return a rate of 1, and that 1 is
 * INDISTINGUISHABLE from a genuinely resolved rate unless a caller asks for
 * the source separately — never derive "unresolved" from `resolveRate(...)
 * === 1` alone, since a cached or overridden rate can itself legitimately be
 * 1 (a currency trading at par with the baseline).
 */
export type RateSource = "base" | "override" | "cached" | "unresolved";

interface RateResolution {
  source: RateSource;
  rate: number;
}

type RateBucket = Pick<BudgetBucket, "currency" | "fxRateOverride">;

/** Units of the BASE currency per 1 EUR, or null when no rate is known. */
function basePerEur(base: BudgetCurrency, fxRates: FxRates | null): number | null {
  if (base === "EUR") return 1;
  const cached = fxRates?.rates[base];
  return cached != null && cached > 0 ? cached : null;
}

/**
 * Units of the BUCKET's currency per 1 EUR, with the branch that produced it,
 * or null when unresolved. An EUR bucket is 1 by definition, so an override
 * on it is incoherent data and is ignored (§475) — the modal's currency
 * <select> drops it on save, and deciding it here at read time also repairs
 * a bucket saved before that fix or imported from elsewhere.
 */
function bucketPerEur(bucket: RateBucket, fxRates: FxRates | null): { source: "override" | "cached"; perEur: number } | null {
  if (bucket.currency === "EUR") return { source: "cached", perEur: 1 };
  if (bucket.fxRateOverride != null && bucket.fxRateOverride > 0) return { source: "override", perEur: bucket.fxRateOverride };
  const cached = fxRates?.rates[bucket.currency];
  if (cached != null && cached > 0) return { source: "cached", perEur: cached };
  return null;
}

/**
 * The single precedence walk `resolveRate` and `resolveRateSource` both read
 * from, so the two can never disagree about which branch fired. The result is
 * units of the bucket's currency per 1 unit of `base` — the project's baseline
 * currency (`plan.currency`, §476), the unit every budget figure is in.
 *   1. 1 for a bucket in the base currency (true BY DEFINITION; an override on
 *      it is ignored) — source "base"
 *   2. otherwise both sides are resolved against EUR, the unit of the cached
 *      ECB table and of `fxRateOverride` (which keeps its stored meaning:
 *      units of the bucket's currency per 1 EUR):
 *        base per EUR   = 1 for EUR, else the cached rate
 *        bucket per EUR = 1 for EUR, else the override, else the cached rate
 *      and the rate is bucket per EUR ÷ base per EUR, with the bucket side's
 *      source ("cached" for an EUR bucket)
 *   3. 1 when either side has no rate — UNRESOLVED, see `RateSource`
 */
function resolveRateInfo(bucket: RateBucket, fxRates: FxRates | null, base: BudgetCurrency): RateResolution {
  if (bucket.currency === base) return { source: "base", rate: 1 };
  const baseSide = basePerEur(base, fxRates);
  const bucketSide = bucketPerEur(bucket, fxRates);
  if (baseSide === null || bucketSide === null) return { source: "unresolved", rate: 1 };
  return { source: bucketSide.source, rate: bucketSide.perEur / baseSide };
}

/** Units of the bucket's currency per 1 `base`. See `resolveRateInfo` for the precedence. */
export function resolveRate(bucket: RateBucket, fxRates: FxRates | null, base: BudgetCurrency): number {
  return resolveRateInfo(bucket, fxRates, base).rate;
}

/** Which branch of the precedence produced `resolveRate`'s value. See `RateSource`. */
export function resolveRateSource(bucket: RateBucket, fxRates: FxRates | null, base: BudgetCurrency): RateSource {
  return resolveRateInfo(bucket, fxRates, base).source;
}

/**
 * How many of `buckets` put money into a baseline-currency rollup AT PAR
 * because no rate was ever confirmed for them (§474, `RateSource`
 * "unresolved").
 * ★ Only a FIXED-PRICE bucket qualifies: its contract amount is the one
 * figure that passes through `currencyToBase` (`computeBucketReport`,
 * `computeBurndownSeries`), so it alone is summed 1:1 when the rate is
 * unresolved. A T&M bucket's money is hours × role rates, which are already
 * in the baseline (§476) — so the bucket's own missing rate changes none of
 * the figures it contributes, and counting it would disclose a par conversion
 * that never happened.
 * Reads `resolveRateSource` directly so the source test cannot disagree with
 * the per-bucket currency-label marker.
 */
export function countUnresolvedBuckets(
  buckets: readonly Pick<BudgetBucket, "type" | "currency" | "fxRateOverride">[],
  fxRates: FxRates | null,
  base: BudgetCurrency,
): number {
  return buckets.reduce(
    (count, bucket) => count + (isContractPriced(bucket.type) && resolveRateSource(bucket, fxRates, base) === "unresolved" ? 1 : 0),
    0,
  );
}

/** Baseline amount -> bucket currency. */
export function baseToCurrency(amount: number, bucket: RateBucket, fxRates: FxRates | null, base: BudgetCurrency): number {
  return amount * resolveRate(bucket, fxRates, base);
}

/** Bucket-currency amount -> baseline. */
export function currencyToBase(amount: number, bucket: RateBucket, fxRates: FxRates | null, base: BudgetCurrency): number {
  // resolveRate always returns a positive rate (both sides of the cross rate
  // are guarded `> 0`, otherwise it falls back to 1), so the division is never
  // by zero — no zero-rate special case is reachable.
  return amount / resolveRate(bucket, fxRates, base);
}
