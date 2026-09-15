"use client";

// Dashboard "Budget burn" tile headline (spec §6.3). Formats the forecast's
// two named EACs (or the pace-unavailable Actuals fallback) into one line,
// plus the first §6.1a transparency notice as a muted second line. This
// module only formats fields of `BudgetForecast` — it computes nothing.
import { t, localeFor, type Lang } from "./i18n";
import { formatMoneyCompact, formatSignedPercent, formatDayMonth } from "./forecast-format";
import { isPaceAvailable, isEfficiencyAvailable, type BudgetForecast } from "./budget-forecast";
import { forecastNotices } from "./budget-forecast-notices";
import { forecastNoticeShortText } from "./budget-forecast-banner";

/** One-line tile headline (§6.3): the pace/efficiency EAC range (ordered by
 *  EAC ascending, each VAC following its own EAC), or the pace figure alone
 *  when efficiency is unavailable, or Actuals when pace itself is
 *  unavailable. Ends with "runs out <date>" when the pace forecast has a
 *  `runOutDate`. */
export function forecastHeadlineText(f: BudgetForecast, lang: Lang): string {
  const locale = localeFor(lang);
  const bac = f.facts.bac;
  const vacPercent = (vac: number) => formatSignedPercent(bac > 0 ? vac / bac : 0, locale, 0);

  if (!isPaceAvailable(f.pace)) {
    return t(lang, "forecastTileActuals", formatMoneyCompact(f.facts.ac, locale), formatMoneyCompact(bac, locale));
  }
  const pace = f.pace;

  let rangeText: string;
  if (isEfficiencyAvailable(f.efficiency)) {
    const efficiency = f.efficiency;
    const [low, high] = pace.eac <= efficiency.eac ? [pace, efficiency] : [efficiency, pace];
    rangeText = t(
      lang, "forecastTileRange",
      formatMoneyCompact(low.eac, locale), formatMoneyCompact(high.eac, locale),
      vacPercent(low.vac), vacPercent(high.vac),
    );
  } else {
    rangeText = t(lang, "forecastTileSingle", formatMoneyCompact(pace.eac, locale), vacPercent(pace.vac));
  }

  const parts = [rangeText];
  if (pace.runOutDate !== null) {
    parts.push(t(lang, "forecastTileRunsOut", formatDayMonth(pace.runOutDate, locale)));
  }
  return parts.join(" · ");
}

/** Dashboard "Budget burn" tile headline body (§6.3): the headline line, plus
 *  the first §6.1a notice (if any) as a muted second line — the full notice
 *  text stays on the Budget report. */
export function ForecastHeadline({ lang, forecast }: { lang: Lang; forecast: BudgetForecast }) {
  const notices = forecastNotices(forecast);
  return (
    <>
      <p className="text-sm font-semibold">{forecastHeadlineText(forecast, lang)}</p>
      {notices.length > 0 ? (
        <p className="text-xs text-muted-foreground">{forecastNoticeShortText(notices[0], lang)}</p>
      ) : null}
    </>
  );
}
