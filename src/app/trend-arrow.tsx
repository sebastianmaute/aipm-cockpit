"use client";

import { t, type Lang } from "./i18n";
import type { MetricTrend } from "./dashboard-trends";

interface TrendArrowProps {
  trend: MetricTrend;
  /** Already-translated metric label, e.g. "Overdue". */
  metricLabel: string;
  lang: Lang;
}

const GLYPH: Record<MetricTrend["direction"], string> = { up: "↑", down: "↓", flat: "→" };

/** Direction arrow + signed delta for a single dashboard KPI vs the last visit.
 *  Renders nothing when there is no prior to compare (first visit). The glyph and
 *  number are aria-hidden; the wrapper's aria-label carries the full meaning so a
 *  screen reader never double-reads "↑ +2" as noise. */
export function TrendArrow({ trend, metricLabel, lang }: TrendArrowProps) {
  if (trend.improved === null) return null;

  const magnitude = Math.abs(trend.delta ?? 0);
  const colorClass =
    trend.improved
      ? "text-AIPM-green-strong"
      : trend.direction === "flat"
        ? "text-muted-foreground"
        : "text-AIPM-pink-strong";

  const label =
    trend.direction === "up"
      ? t(lang, "dashboardTrendUp", metricLabel, String(magnitude))
      : trend.direction === "down"
        ? t(lang, "dashboardTrendDown", metricLabel, String(magnitude))
        : t(lang, "dashboardTrendFlat", metricLabel);

  // Signed delta with a real minus sign (U+2212), omitted when flat.
  const signed = trend.direction === "up" ? `+${magnitude}` : trend.direction === "down" ? `−${magnitude}` : "";

  return (
    <span aria-label={label} className={`inline-flex items-center gap-0.5 text-xs font-medium tabular-nums ${colorClass}`}>
      <span aria-hidden="true">{GLYPH[trend.direction]}</span>
      {signed ? <span aria-hidden="true">{signed}</span> : null}
    </span>
  );
}
