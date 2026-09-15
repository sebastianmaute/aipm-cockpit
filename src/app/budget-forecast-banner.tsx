"use client";

// Forecast transparency banners (spec §6.1a): renders `forecastNotices` (a
// pure, i18n-free ordered list) as `Banner`s at the top of the Forecast
// section, above the cards. This module only formats notice fields — it
// computes nothing.
import { type Lang, t, localeFor } from "./i18n";
import { formatDayMonth, formatDayMonthYear } from "./forecast-format";
import { Banner } from "./banner";
import { forecastNotices, type ForecastNotice } from "./budget-forecast-notices";
import { BURN_RATE_WINDOW_WORKING_DAYS, type BudgetForecast } from "./budget-forecast";
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
  lang, forecast, granularity,
}: {
  lang: Lang;
  forecast: BudgetForecast;
  granularity: PlanGranularity;
}) {
  const notices = forecastNotices(forecast);
  if (notices.length === 0) return null;
  return (
    <div className="space-y-2">
      {notices.map((n) => (
        <Banner key={n.kind} severity={n.severity}>
          {forecastNoticeText(n, lang, granularity)}
        </Banner>
      ))}
    </div>
  );
}
