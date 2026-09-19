"use client";

// Budget view link line (spec §6.4). One line above the bucket cards
// summarising the current-pace forecast (or its unavailable-state text), with
// a `TextButton` link to the Budget report. This module only formats fields
// of `BudgetForecast` — it computes nothing.
//
// ★ The EAC-range ordering (low EAC first) mirrored the same idea in
//   `budget-forecast-headline.tsx`'s tile headline before spec C deleted that
//   file (its only production caller, the burn tile, moved to a chart-only
//   body). The two were never worth extracting into a shared helper: they
//   shared only a one-line ternary (`a.eac <= b.eac ? [a, b] : [b, a]`), and
//   every other formatting detail differed — the deleted headline also
//   emitted a VAC pair and a "runs out" clause and had its own
//   pace-unavailable branch (Actuals of BAC), while this line never shows
//   VAC/run-out and has THREE pace-unavailable texts of its own (§6.4).
import { t, localeFor, type Lang } from "./i18n";
import { formatMoneyCompact, formatDayMonthYear } from "./forecast-format";
import { isPaceAvailable, isEfficiencyAvailable, type BudgetForecast } from "./budget-forecast";
import { TextButton } from "./text-button";

/** Link-line text (§6.4): the pace/efficiency EAC range (low EAC first), the
 *  pace EAC alone when efficiency is unavailable, or one of the three
 *  pace-unavailable texts ("Forecast from <date>", "Forecast starts once
 *  hours are booked", "No recent bookings"). */
export function forecastLinkText(f: BudgetForecast, lang: Lang): string {
  const locale = localeFor(lang);
  if (!isPaceAvailable(f.pace)) {
    const pace = f.pace;
    if (pace.unavailable === "no-burn") return t(lang, "forecastLinkNoBurn");
    return pace.availableFrom !== null
      ? t(lang, "forecastLinkStartsOn", formatDayMonthYear(pace.availableFrom, locale))
      : t(lang, "forecastLinkOnceBooked");
  }
  const pace = f.pace;
  if (!isEfficiencyAvailable(f.efficiency)) {
    return t(lang, "forecastLinkSingle", formatMoneyCompact(pace.eac, locale));
  }
  const efficiency = f.efficiency;
  const [low, high] = pace.eac <= efficiency.eac ? [pace, efficiency] : [efficiency, pace];
  return t(lang, "forecastLinkRange", formatMoneyCompact(low.eac, locale), formatMoneyCompact(high.eac, locale));
}

/** Budget view link line (§6.4): the text above, plus a `TextButton` to the
 *  Budget report. The arrow is decorative (`aria-hidden`) and sits OUTSIDE the
 *  button, so the button's accessible name stays the visible "Budget Report"
 *  text alone (controller ruling 2). */
export function BudgetForecastLink({
  lang, forecast, onOpen,
}: { lang: Lang; forecast: BudgetForecast; onOpen: () => void }) {
  return (
    <p className="mb-2 flex flex-wrap items-center gap-2 text-sm">
      {forecastLinkText(forecast, lang)}
      <span aria-hidden="true">→</span>
      <TextButton onClick={onOpen}>{t(lang, "budgetReportTitle")}</TextButton>
    </p>
  );
}
