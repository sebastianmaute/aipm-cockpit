"use client";

import { t, type Lang } from "./i18n";
import type { MetricTrend } from "./dashboard-trends";

interface TrendArrowProps {
  trend: MetricTrend;
  /** Already-translated metric label, e.g. "Overdue". */
  metricLabel: string;
  /** Unit suffix for the delta magnitude, e.g. "%" for completion. Counts pass "". */
  unit?: string;
  lang: Lang;
}

const GLYPH: Record<MetricTrend["direction"], string> = { up: "↑", down: "↓", flat: "→" };

/** Direction arrow + signed delta for a single dashboard KPI vs the last visit.
 *  Renders nothing when there is no prior to compare (first visit). The glyph and
 *  number are aria-hidden; the wrapper's aria-label carries the full meaning so a
 *  screen reader never double-reads "↑ +2" as noise. */
export function TrendArrow({ trend, metricLabel, unit = "", lang }: TrendArrowProps) {
  // No prior to compare (first visit) ⇒ no arrow. Bail on a null delta too so the
  // magnitude below is always a real number (no masking `?? 0` fallback).
  if (trend.improved === null || trend.delta === null) return null;

  const magnitude = Math.abs(trend.delta);
  const magnitudeStr = `${magnitude}${unit}`;
  const colorClass =
    trend.improved
      ? "text-AIPM-green-strong"
      : trend.direction === "flat"
        ? "text-muted-foreground"
        : "text-AIPM-pink-strong";

  const label =
    trend.direction === "up"
      ? t(lang, "dashboardTrendUp", metricLabel, magnitudeStr)
      : trend.direction === "down"
        ? t(lang, "dashboardTrendDown", metricLabel, magnitudeStr)
        : t(lang, "dashboardTrendFlat", metricLabel);

  // Signed delta with a real minus sign (U+2212), omitted when flat.
  const signed = trend.direction === "up" ? `+${magnitudeStr}` : trend.direction === "down" ? `−${magnitudeStr}` : "";

  return (
    <span aria-label={label} className={`inline-flex items-center gap-0.5 text-xs font-medium tabular-nums ${colorClass}`}>
      <span aria-hidden="true">{GLYPH[trend.direction]}</span>
      {signed ? <span aria-hidden="true">{signed}</span> : null}
    </span>
  );
}
