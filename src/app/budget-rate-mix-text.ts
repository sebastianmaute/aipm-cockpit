/**
 * Sentences for the rate-mix signal (MR 3 addendum §4.3–§4.7). React-free.
 * ONE explanation feeds every chip tooltip, the rate fact's tooltip and the
 * role-mix footnote; the banner prefixes it with its lead word and head, so
 * the numbers agree on every surface (S6).
 */
import { type Lang, t, localeFor } from "./i18n";
import { formatCurrency } from "./resource-cost";
import { formatDayMonth, formatHours, formatShare, formatSignedPercent } from "./forecast-format";
import { isPaceAvailable, type BudgetForecast } from "./budget-forecast";
import { RATE_DRIFT_SIGNAL_RATIO, type RateMix } from "./budget-rate-mix";

// `computeRateMix` only sets a non-null `direction` when BOTH pace
// forecasts are available and both BACs are positive (`rateMixSignal`,
// spec §4.3) — so for a mix the real engine produced, `paceVacRatio` below
// never actually returns null for either forecast. TypeScript cannot infer
// that from these independent parameters (`RateMix`/`BudgetForecast` carry
// no link to each other in their types), so the null case stays as a
// type-safety fallback only — it is not a real forecast state that
// co-occurs with a triggered mix.
function paceVacRatio(f: BudgetForecast): number | null {
  return isPaceAvailable(f.pace) && f.facts.bac > 0 ? f.pace.vac / f.facts.bac : null;
}

export function rateMixExplanation(lang: Lang, mix: RateMix, eur: BudgetForecast, hours: BudgetForecast): string {
  const locale = localeFor(lang);
  const money = (n: number) => formatCurrency(n, "EUR", locale);
  const parts: string[] = [];
  if (mix.driver) {
    parts.push(t(lang, "forecastMixDriver", mix.driver.name, formatShare(mix.driver.bookedShare, locale), formatShare(mix.driver.plannedShare, locale)));
    parts.push(t(lang, "forecastMixRateAfterDriver", money(mix.bookedRate), money(mix.plannedRate)));
  } else {
    parts.push(t(lang, "forecastMixRate", money(mix.bookedRate), money(mix.plannedRate)));
  }
  const e = paceVacRatio(eur);
  const h = paceVacRatio(hours);
  // `mix.direction !== null` is the real-world gate (it already implies
  // `e`/`h` are non-null for an engine-produced mix, see the comment on
  // `paceVacRatio`); the null checks are the type-safety-only part.
  if (e !== null && h !== null && mix.direction !== null) {
    parts.push(mix.direction === "hours-worse"
      ? t(lang, "forecastMixPaceHoursWorse", formatSignedPercent(h, locale, 1), formatSignedPercent(e, locale, 1))
      : t(lang, "forecastMixPaceEurWorse", formatSignedPercent(e, locale, 1), formatSignedPercent(h, locale, 1)));
  }
  return parts.join(" ");
}

export function rateMixBannerText(lang: Lang, mix: RateMix, eur: BudgetForecast, hours: BudgetForecast): string {
  const lead = t(lang, mix.severity === "warning" ? "forecastMixLeadWarning" : "forecastMixLeadNote");
  const head = t(lang, mix.direction === "eur-worse" ? "forecastMixHeadEurWorse" : "forecastMixHeadHoursWorse");
  return `${lead} ${head} ${rateMixExplanation(lang, mix, eur, hours)}`;
}

export function rateMixChipText(lang: Lang, mix: RateMix): string {
  return t(lang, mix.direction === "eur-worse" ? "forecastMixChipEurWorse" : "forecastMixChipHoursWorse");
}

export function rateMixChipName(lang: Lang, mix: RateMix, card: "pace" | "efficiency"): string {
  return t(lang, card === "pace" ? "forecastMixChipNamePace" : "forecastMixChipNameEfficiency", rateMixChipText(lang, mix));
}

export function rateMixTileChipText(lang: Lang, mix: RateMix, hours: BudgetForecast): string {
  const locale = localeFor(lang);
  // `pace` is bound to ONE local so both narrows below (VAC ratio and
  // run-out date) read the same value, rather than re-reading
  // `hours.pace` per use. As with `paceVacRatio`, `pace` being unavailable
  // here is a type-safety fallback, not a real state that co-occurs with a
  // triggered mix (see that function's comment) — this function is only
  // ever called with an unavailable-pace `hours` forecast if a caller
  // passes a `mix`/`hours` pair that did not come from the same
  // `computeForecastBundle`.
  const pace = hours.pace;
  const h = formatSignedPercent(isPaceAvailable(pace) && hours.facts.bac > 0 ? pace.vac / hours.facts.bac : 0, locale, 0);
  if (mix.direction === "eur-worse") return t(lang, "forecastMixTileEurWorse", h);
  const runOut = isPaceAvailable(pace) ? pace.runOutDate : null;
  return runOut === null
    ? t(lang, "forecastMixTileHoursWorseNoRunOut", h)
    : t(lang, "forecastMixTileHoursWorse", h, formatDayMonth(runOut, locale));
}

export function rateMixWhyName(lang: Lang, visibleText: string): string {
  return t(lang, "forecastMixWhy", visibleText);
}

export function rateMixPoints(lang: Lang, difference: number): string {
  const points = Math.round(difference * 100);
  // ASCII hyphen-minus for a negative, matching `formatSignedPercent` on the
  // same page (controller ruling); `String(-7)` is "-7" and `String(0)` "0".
  const text = points > 0 ? `+${points}` : String(points);
  return t(lang, "forecastMixPoints", text);
}

/**
 * Rate fact value split into its parts (controller ruling P13). `rate` is
 * always the booked rate per hour; `note`/`arrow` depend on whether the
 * drift is at or above `RATE_DRIFT_SIGNAL_RATIO` — the ONLY place that
 * threshold is checked (`rateFactValue` derives from this, never re-checks
 * it). `arrow` is `null` when the rate is on plan (no glyph is rendered).
 */
export function rateFactParts(lang: Lang, mix: RateMix): { rate: string; note: string; arrow: "▲" | "▼" | null } {
  const locale = localeFor(lang);
  const rate = t(lang, "forecastRatePerHour", formatCurrency(mix.bookedRate, "EUR", locale));
  if (Math.abs(mix.drift) >= RATE_DRIFT_SIGNAL_RATIO) {
    const note = t(lang, "forecastRateDrift", formatSignedPercent(mix.drift, locale, 1));
    return { rate, note, arrow: mix.drift < 0 ? "▼" : "▲" };
  }
  return { rate, note: t(lang, "forecastRateOnPlan"), arrow: null };
}

export function rateFactValue(lang: Lang, mix: RateMix): string {
  const { rate, note, arrow } = rateFactParts(lang, mix);
  return arrow !== null ? `${rate} ${note}` : `${rate} · ${note}`;
}

export function rateFactTip(lang: Lang, mix: RateMix): string {
  const locale = localeFor(lang);
  const money = (n: number) => formatCurrency(n, "EUR", locale);
  return t(
    lang, "forecastTipRate",
    money(mix.bookedValue), formatHours(mix.actualHours, locale), money(mix.bookedRate),
    money(mix.budgetValue), formatHours(mix.budgetHours, locale), money(mix.plannedRate),
  );
}
