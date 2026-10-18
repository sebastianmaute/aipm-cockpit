"use client";

// "Safe to commit (P80) over time" (§502 part 4, spec §3.7): the recorded daily P80 finish dates as a line, on the
// history's own date axis, with the plan end as a reference line. Reuses `TrendChart`.
//
// The y value is a PLAIN CALENDAR-DAY offset (the builder's choice the spec leaves open): a finish date is exact in
// calendar days and needs no holiday calendar to invert, so every y tick formats back to the date it stands for. The
// origin is the EARLIEST plotted date (a P80 or the plan end): `TrendChart` floors its scale at 0, so an origin far
// below the line (the first recording date, months before the P80) would flatten its movement to a sliver of the plot.
// Entries whose P80 ran past the horizon (`p80: null`) are left out.
//
// The x axis is calendar days too (Task 11b): each point carries its recording date's day offset as `x`, so days the
// recorder missed stretch the axis instead of steepening the slope. The x labels carry the year once the recordings
// span more than one calendar year, and the y ticks once the plotted dates (plan end included) do.

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

/** Day and month within one calendar year; with the year once `from`..`to` (ISO dates, ascending) crosses one. */
function dateLabelFor(from: string, to: string): (iso: string, locale: string) => string {
  return from.slice(0, 4) === to.slice(0, 4) ? formatDayMonth : formatDayMonthYear;
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
  const hasPlanEnd = isValidIsoDate(planEnd);
  const plotted = [...entries.map((e) => e.p80), ...(hasPlanEnd ? [planEnd] : [])];
  const origin = plotted.reduce((a, b) => (b < a ? b : a));
  const latest = plotted.reduce((a, b) => (b > a ? b : a));
  const first = entries[0].date, last = entries[entries.length - 1].date;
  const xLabel = dateLabelFor(first, last);
  const yLabel = dateLabelFor(origin, latest);
  const points: TrendPoint[] = entries.map((e) => ({
    label: xLabel(e.date, locale), value: dayOffset(origin, e.p80), gapBefore: false, x: dayOffset(first, e.date),
  }));
  const reference = hasPlanEnd
    ? { value: dayOffset(origin, planEnd), label: t(lang, "forecastP80LinePlanEnd", formatDayMonthYear(planEnd, locale)) }
    : undefined;
  return (
    <div className={compact ? "max-w-md" : undefined} data-testid="forecast-p80-line">
      <TrendChart
        caption={t(lang, "forecastP80LineCaption")}
        points={points}
        reference={reference}
        emptyLabel={t(lang, "forecastP80LineTooShort")}
        format={(v) => yLabel(addCalendarDays(origin, Math.round(v)), locale)}
      />
    </div>
  );
}
