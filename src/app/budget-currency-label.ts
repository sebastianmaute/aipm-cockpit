import { type Lang, t } from "./i18n";
import type { RateSource } from "./fx";

/**
 * The `(×rate)` suffix budget-panel.tsx and budget-report-panel.tsx both
 * append after a bucket's currency code. Shared so the two surfaces cannot
 * disagree about when §474's UNRESOLVED marker fires — `rate !== 1` alone
 * cannot tell a genuinely resolved rate of 1 apart from a rateless non-EUR
 * bucket read at par (both return 1 from `resolveRate`), so this takes the
 * resolver's SOURCE (`resolveRateSource`, fx.ts), never the rate alone.
 */
export function bucketCurrencyLabel(lang: Lang, currency: string, rate: number, source: RateSource): string {
  if (source === "unresolved") return `${currency} (${t(lang, "budgetFxRateUnresolved")})`;
  return rate !== 1 ? `${currency} (×${rate})` : currency;
}
