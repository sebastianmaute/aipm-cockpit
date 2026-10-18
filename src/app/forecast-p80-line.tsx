"use client";

// "Safe to commit (P80) over time" (§502 part 4, spec §3.7): the recorded daily P80 finish dates as a line, on the
// history's own date axis, with the plan end as a reference line. Reuses `TrendChart`.
//
// The y value is a PLAIN CALENDAR-DAY offset from the first recorded entry's date (the builder's choice the spec
// leaves open): a finish date is exact in calendar days and needs no holiday calendar to invert, so every y tick
// formats back to the date it stands for. Entries whose P80 ran past the horizon (`p80: null`) are left out.

import { type Lang, t } from "./i18n";
import { localeFor } from "./date-format";
import { formatDayMonth, formatDayMonthYear } from "./forecast-format";
import type { ForecastHistoryEntry } from "./forecast-history";
import { isValidIsoDate } from "./forecast/throughput";
import { addCalendarDays } from "./working-days";
import { TrendChart, type TrendPoint } from "./trend-chart";

const DAY_MS = 86_400_000;

/** Calendar days from `from` to `to` (negative when `to` is earlier); both are ISO dates. */
function dayOffset(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function ForecastP80Line({ lang, history, planEnd, compact = false }: {
  lang: Lang;
  history: readonly ForecastHistoryEntry[];
  planEnd: string;
  /** The Reports section's small line under the tiles; full width otherwise (Trends). */
  compact?: boolean;
}) {
  const entries = history.filter((e): e is ForecastHistoryEntry & { p80: string } => e.p80 !== null);
  if (entries.length === 0) return null;
  const locale = localeFor(lang);
  const origin = entries[0].date;
  const points: TrendPoint[] = entries.map((e) => ({
    label: formatDayMonth(e.date, locale), value: dayOffset(origin, e.p80), gapBefore: false,
  }));
  const reference = isValidIsoDate(planEnd)
    ? { value: dayOffset(origin, planEnd), label: t(lang, "forecastP80LinePlanEnd", formatDayMonthYear(planEnd, locale)) }
    : undefined;
  return (
    <div className={compact ? "max-w-md" : undefined} data-testid="forecast-p80-line">
      <TrendChart
        caption={t(lang, "forecastP80LineCaption")}
        points={points}
        reference={reference}
        emptyLabel={t(lang, "forecastP80LineTooShort")}
        format={(v) => formatDayMonth(addCalendarDays(origin, Math.round(v)), locale)}
      />
    </div>
  );
}
