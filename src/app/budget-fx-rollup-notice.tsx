"use client";

import { type Lang, tPlural } from "./i18n";
import { countUnresolvedBuckets } from "./fx";
import type { BudgetBucket, FxRates } from "./types";

/**
 * §474 (the rollup half — read together with `budget-currency-label.ts`,
 * which discloses the SAME "unresolved" state per bucket): the project-total
 * rollup both budget-panel.tsx and budget-report-panel.tsx render sums every
 * bucket's EUR-reported figure regardless of whether a rate was ever
 * confirmed for it. A bucket whose `resolveRateSource` (fx.ts) reads
 * "unresolved" is summed in AT PAR, with nothing on screen saying so — this
 * is that disclosure. Arithmetic is unchanged; this only names how many
 * summands were counted that way, via the same pure `countUnresolvedBuckets`
 * both surfaces would otherwise have to reimplement (and could disagree on).
 * That count takes fixed-price buckets only — a T&M bucket's money is never
 * converted, so it cannot have been summed at par (see the helper).
 * Renders nothing when the count is 0, same "muted line, no icon, no
 * colour" shape as `CostUnknownNotice` — a text disclosure, not a warning.
 */
export function BudgetFxRollupNotice({
  lang, buckets, fxRates,
}: {
  lang: Lang;
  buckets: readonly Pick<BudgetBucket, "type" | "currency" | "fxRateOverride">[];
  fxRates: FxRates | null;
}) {
  const count = countUnresolvedBuckets(buckets, fxRates);
  if (count === 0) return null;
  return <p className="mt-2 text-xs text-muted-foreground">{tPlural(lang, "budgetFxRollupUnresolved", count, String(count))}</p>;
}
