"use client";

// "Where the hours went" (MR 3 addendum §4.4): the CAUSE behind the rate-mix
// banner. Native <details> (the house disclosure pattern), controlled so the
// banner action can open it; focus moves to the summary AFTER commit, keyed on
// a nonce — never synchronously in the click handler (plan Ruling 10).
import { useEffect, useRef } from "react";
import { type Lang, t, localeFor } from "./i18n";
import { formatCurrency } from "./resource-cost";
import { formatHours, formatShare } from "./forecast-format";
import { Badge } from "./badge";
import { rateMixExplanation, rateMixPoints } from "./budget-rate-mix-text";
import { RATE_MIX_DRIVER_MIN_DIFFERENCE, type RateMix } from "./budget-rate-mix";
import type { BudgetForecast } from "./budget-forecast";

// Controller ruling P14: the "used of budget" cell reads "539 of 600 h (90%)"
// (spec §4.4) — a plain locale-formatted number for the actual hours, not
// `formatHours`'s " h"-suffixed form, so the unit appears once per cell.
function plainNumber(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n);
}

export function RateMixDetails({
  lang, mix, eur, hours, open, onToggle, focusNonce,
}: {
  lang: Lang; mix: RateMix; eur: BudgetForecast; hours: BudgetForecast;
  open: boolean; onToggle: (open: boolean) => void; focusNonce: number;
}) {
  const summaryRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (focusNonce > 0) summaryRef.current?.focus();
  }, [focusNonce]);
  const locale = localeFor(lang);
  const money = (n: number) => formatCurrency(n, "EUR", locale);
  const headers = ["forecastMixColRole", "forecastMixColRate", "forecastMixColPlanned", "forecastMixColBooked", "forecastMixColDifference", "forecastMixColUsed"] as const;
  return (
    <details
      open={open}
      onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}
      className="rounded-md border border-line"
    >
      <summary ref={summaryRef} className="cursor-pointer px-3 py-1.5 text-sm font-medium text-foreground">
        {t(lang, "forecastMixAction")}
        <span className="ml-2 text-xs font-normal text-muted-foreground">{t(lang, "forecastMixSummary")}</span>
      </summary>
      <div className="overflow-x-auto px-3 pb-3">
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr>
              {headers.map((key) => (
                <th key={key} scope="col" className="px-2 py-1 text-left text-xs font-medium text-muted-foreground">{t(lang, key)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mix.rows.map((row) => (
              <tr key={row.key}>
                <td className="px-2 py-1">
                  {row.name}
                  {mix.driver?.key === row.key ? (
                    <Badge size="sm" pill className="ml-2 border border-line">{t(lang, "forecastMixDriverBadge")}</Badge>
                  ) : null}
                </td>
                <td className="px-2 py-1 tabular-nums">{row.plannedRate === null ? "—" : t(lang, "forecastRatePerHour", money(row.plannedRate))}</td>
                <td className="px-2 py-1 tabular-nums">{formatShare(row.plannedShare, locale)}</td>
                <td className="px-2 py-1 tabular-nums">{formatShare(row.bookedShare, locale)}</td>
                <td className="px-2 py-1 tabular-nums">{rateMixPoints(lang, row.difference)}</td>
                <td className="px-2 py-1 tabular-nums">
                  {row.usedOfBudget === null ? "—" : t(lang, "forecastMixUsed", plainNumber(row.actualHours, locale), formatHours(row.budgetHours, locale), formatShare(row.usedOfBudget, locale))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">
          {mix.driver
            ? rateMixExplanation(lang, mix, eur, hours)
            : t(lang, "forecastMixOnPlan", String(Math.round(RATE_MIX_DRIVER_MIN_DIFFERENCE * 100)))}
        </p>
      </div>
    </details>
  );
}
