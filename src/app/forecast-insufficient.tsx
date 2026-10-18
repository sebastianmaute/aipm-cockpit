"use client";

// The Forecast view's below-the-floor message (§502): Quick and What-if show it in place of the forecast, and
// Scenarios mode shows it once for every column (they share As is's window). Its own file so the Scenarios
// view can use it without importing the panel that mounts the view.

import { type Lang, t, tPlural } from "./i18n";
import { localeFor } from "./date-format";
import { formatDayMonthYear } from "./forecast-format";
import type { ForecastInsufficient } from "./forecast";
import { EmptyState } from "./empty-state";

/** The history floor is not met: say which shortfall(s), in counts the user can act on. */
export function InsufficientState({ lang, result }: { lang: Lang; result: ForecastInsufficient }) {
  const lines: string[] = [];
  if (result.finished < result.neededFinished) {
    lines.push(t(lang, "forecastInsufficient", result.finished, result.neededFinished, result.neededFinished - result.finished));
  }
  if (result.days < result.neededDays) {
    const args = [result.days, result.neededDays, result.neededDays - result.days] as const;
    // R14 cut a fixed window at the first completion: say so, or "8 of 10 days" reads as a wrong window.
    lines.push(
      result.windowCutAt === null
        ? t(lang, "forecastInsufficientDays", ...args)
        : t(lang, "forecastInsufficientDaysCut", ...args, formatDayMonthYear(result.windowCutAt, localeFor(lang))),
    );
  }
  if (result.doneWithoutDate > 0) lines.push(tPlural(lang, "forecastDoneWithoutDate", result.doneWithoutDate, result.doneWithoutDate));
  const [first, ...rest] = lines;
  return (
    <div className="pb-6">
      <EmptyState title={t(lang, "forecastInsufficientTitle")} description={first} />
      {rest.map((line) => (
        <p key={line} className="text-center text-xs text-muted-foreground">
          {line}
        </p>
      ))}
    </div>
  );
}
