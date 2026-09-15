"use client";

// Forecast transparency banners (spec §6.1a): renders `forecastNotices` (a
// pure, i18n-free ordered list) as `Banner`s at the top of the Forecast
// section, above the cards. This module only formats notice fields — it
// computes nothing.
import { type Lang, t, localeFor } from "./i18n";
import { formatDayMonth, formatDayMonthYear } from "./forecast-format";
import { Banner } from "./banner";
import { Button } from "./button";
import { rateMixBannerText } from "./budget-rate-mix-text";
import { forecastNotices, type ForecastNotice } from "./budget-forecast-notices";
import { BURN_RATE_WINDOW_WORKING_DAYS, type BudgetForecast } from "./budget-forecast";
import type { RateMix } from "./budget-rate-mix";
import type { PlanGranularity } from "./types";

/** Full banner sentence for one notice (§6.1a). */
export function forecastNoticeText(n: ForecastNotice, lang: Lang, granularity: PlanGranularity): string {
  const locale = localeFor(lang);
  const windowDays = String(BURN_RATE_WINDOW_WORKING_DAYS);
  switch (n.kind) {
    case "starts-on":
      return t(
        lang, "forecastBannerStartsOn",
        formatDayMonthYear(n.availableFrom, locale), windowDays,
        String(n.bookedWorkingDays), formatDayMonth(n.firstBookingDate, locale),
      );
    case "starts-once-booked":
      return t(lang, "forecastBannerStartsOnceBooked", windowDays);
    case "no-burn": {
      const base = t(
        lang, "forecastBannerNoBurn",
        windowDays, formatDayMonth(n.windowStart, locale), formatDayMonth(n.windowEnd, locale),
      );
      return n.lastBookingDate === null
        ? base
        : `${base} ${t(lang, "forecastBannerLastBooking", formatDayMonth(n.lastBookingDate, locale))}`;
    }
    case "spread":
      return t(lang, granularity === "week" ? "forecastBannerSpreadWeek" : "forecastBannerSpreadMonth");
    case "needs-percent":
      return t(lang, "forecastBannerNeedsPercent", n.bucketNames.join(", "));
  }
}

/** One-line tile form of a notice (§6.3). */
export function forecastNoticeShortText(n: ForecastNotice, lang: Lang): string {
  switch (n.kind) {
    case "starts-on":
      return t(lang, "forecastShortStartsOn", formatDayMonthYear(n.availableFrom, localeFor(lang)));
    case "starts-once-booked":
      return t(lang, "forecastShortOnceBooked");
    case "no-burn":
      return t(lang, "forecastShortNoBurn");
    case "spread":
      return t(lang, "forecastShortSpread");
    case "needs-percent":
      return t(lang, "forecastShortNeedsPercent");
  }
}

export function ForecastBanners({
  lang, forecast, granularity, hours = null, mix = null, onShowMix,
}: {
  lang: Lang;
  forecast: BudgetForecast;
  granularity: PlanGranularity;
  hours?: BudgetForecast | null;
  mix?: RateMix | null;
  onShowMix?: () => void;
}) {
  const notices = forecastNotices(forecast);
  // MR 3 §4.3: the rate-mix banner goes FIRST — it changes how the cards read.
  // It cannot co-occur with a pace-unavailable notice (the trigger needs both
  // pace forecasts), but it can be the ONLY banner, so the early return below
  // must account for it.
  const mixBanner = mix && mix.triggered && hours ? (
    <Banner severity={mix.severity === "warning" ? "warn" : "info"} className="flex flex-wrap items-start gap-2">
      <span className="min-w-0 flex-1">{rateMixBannerText(lang, mix, forecast, hours)}</span>
      {onShowMix ? (
        <Button variant="secondary" size="xs" onClick={onShowMix}>{t(lang, "forecastMixAction")}</Button>
      ) : null}
    </Banner>
  ) : null;
  if (notices.length === 0 && mixBanner === null) return null;
  return (
    <div className="space-y-2">
      {mixBanner}
      {notices.map((n) => (
        <Banner key={n.kind} severity={n.severity}>
          {forecastNoticeText(n, lang, granularity)}
        </Banner>
      ))}
    </div>
  );
}
