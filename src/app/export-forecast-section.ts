// src/app/export-forecast-section.ts — open-followups §545, the exports half.
//
// The budget forecast as a two-column (field, value) export section, built
// from the SAME `ForecastBundle` the dashboard model computes (dashboard.ts),
// so an exported figure cannot disagree with the dashboard tile or the AI
// snapshot. Labels reuse the forecast cards' own strings.
//
// ★ DERIVED, not a workspace slice: the bundle arrives as `ExportExtras`, and
//  the CSV / Markdown / JSON workspace formats never carry it (they are
//  storage round-trip formats, pinned byte for byte by the golden tests).

import { type Lang, localeFor, t } from "./i18n";
import type { ForecastBundle } from "./budget-forecast-bundle";
import {
  isEfficiencyAvailable,
  isPaceAvailable,
  type BudgetForecast,
} from "./budget-forecast";
import { formatCurrency } from "./resource-cost";
import { formatHours, formatSignedPercent, signedFigure } from "./forecast-format";
import { rateFactValue } from "./budget-rate-mix-text";

/** What `buildExportSections` needs beyond the workspace. */
export type ExportExtras = {
  /** The dashboard model's forecast bundle, or null when the budget module is
   *  off or no forecast exists — in which case the section is omitted. */
  budgetForecast?: ForecastBundle | null;
};

type Leg = "pace" | "efficiency";

function legOf(f: BudgetForecast, leg: Leg): { eac: number; vac: number } | null {
  if (leg === "pace") return isPaceAvailable(f.pace) ? f.pace : null;
  return isEfficiencyAvailable(f.efficiency) ? f.efficiency : null;
}

function unavailableText(f: BudgetForecast, leg: Leg, lang: Lang): string {
  if (leg === "pace") {
    if (isPaceAvailable(f.pace)) return "";
    return t(lang, f.pace.unavailable === "no-burn" ? "forecastPaceNoBurn" : "forecastPaceNotEnough");
  }
  if (isEfficiencyAvailable(f.efficiency)) return "";
  switch (f.efficiency.unavailable) {
    case "needs-percent-complete": return t(lang, "forecastEfficiencyNeedsPercent");
    case "no-actual-cost": return t(lang, "forecastEfficiencyNoCost");
    case "no-earned-value": return t(lang, "forecastEfficiencyNoEarned");
  }
}

/** The section's body rows, or `[]` when there is no forecast to show. */
export function budgetForecastRows(bundle: ForecastBundle | null | undefined, lang: Lang): string[][] {
  if (!bundle) return [];
  const { eur, hours } = bundle;
  const locale = localeFor(lang);
  const money = (n: number) => formatCurrency(n, "EUR", locale);
  const withHours = (euro: string, h: number | null) => (h === null ? euro : `${euro} (${formatHours(h, locale)})`);

  const rows: string[][] = [
    [t(lang, "forecastFactBac"), withHours(money(eur.facts.bac), hours.facts.bac)],
    [t(lang, "forecastFactAc"), withHours(money(eur.facts.ac), hours.facts.ac)],
    [t(lang, "forecastFactRemaining"), withHours(money(eur.facts.remaining), hours.facts.remaining)],
  ];

  for (const leg of ["pace", "efficiency"] as const) {
    const e = legOf(eur, leg);
    const h = legOf(hours, leg);
    const eacKey = leg === "pace" ? "forecastEacPace" : "forecastEacEfficiency";
    const vacKey = leg === "pace" ? "forecastVacPace" : "forecastVacEfficiency";
    if (e === null) {
      rows.push([t(lang, eacKey), unavailableText(eur, leg, lang)]);
      continue;
    }
    rows.push([t(lang, eacKey), withHours(money(e.eac), h?.eac ?? null)]);
    const pct = eur.facts.bac > 0 ? ` (${formatSignedPercent(e.vac / eur.facts.bac, locale, 1)})` : "";
    rows.push([t(lang, vacKey), `${signedFigure(money(e.vac), e.vac)}${pct}`]);
  }

  if (eur.gap) {
    const pctText = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(eur.gap.percentOfBac);
    rows.push([
      t(lang, "exportForecastGap"),
      t(lang, eur.gap.severity === "warning" ? "forecastGapWarning" : "forecastGapInfo", money(eur.gap.eacDifference), pctText),
    ]);
  }
  if (bundle.mix) rows.push([t(lang, "forecastFactRate"), rateFactValue(lang, bundle.mix)]);
  if (eur.hasFixedPrice) rows.push([t(lang, "exportForecastNote"), t(lang, "forecastFixedPriceNote")]);
  return rows;
}
