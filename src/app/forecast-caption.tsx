"use client";

// The forecast's basis line (§502): runs, window and finished tasks, then the done-without-date and beyond-horizon
// notes. The Forecast view shows it under its toolbar; the Reports Forecast section (part 4) under its verdict.

import { type Lang, t, tPlural } from "./i18n";
import { localeFor } from "./date-format";
import type { ScheduleForecast } from "./forecast";
import type { HistoryWindow } from "./forecast/constants";

export function ForecastCaption({ lang, forecast, historyWindow }: { lang: Lang; forecast: ScheduleForecast; historyWindow: HistoryWindow }) {
  const locale = localeFor(lang);
  const runs = new Intl.NumberFormat(locale).format(forecast.trials);
  // An empty backlog skips the history floor, so either count can be 0 or 1 here.
  const days = forecast.windowDays;
  const windowText = tPlural(lang, historyWindow === "all" ? "forecastBasisWindowAll" : "forecastBasisWindow", days, days);
  const finishedText = tPlural(lang, "forecastBasisFinished", forecast.finished, forecast.finished);
  const basis = t(lang, "forecastBasis", runs, windowText, finishedText);
  const beyond = t(lang, "forecastPercent", forecast.beyondShare < 0.01 ? "< 1" : Math.round(forecast.beyondShare * 100));
  return (
    <div className="space-y-0.5 text-xs text-muted-foreground">
      <p>{basis}</p>
      {forecast.doneWithoutDate > 0 && <p>{tPlural(lang, "forecastDoneWithoutDate", forecast.doneWithoutDate, forecast.doneWithoutDate)}</p>}
      {forecast.beyondShare > 0 && <p>{t(lang, "forecastBeyondShare", beyond)}</p>}
    </div>
  );
}
