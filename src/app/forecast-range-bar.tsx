"use client";

import { localeFor } from "./date-format";
import { isValidIsoDate } from "./forecast/throughput";
import { formatDayMonthYear } from "./forecast-format";
import { type Lang, t } from "./i18n";
import { SIM_OUTLINE_CLASS, SimBadge } from "./sim-value";

/**
 * The Forecast tile's range bar (§502): P50–P95 as a band, P80 as a mark and the plan end as a
 * dashed tick, all on one date axis that starts today. Drawn in the explainer histogram's tokens
 * (green bars, dark-blue cut lines). The SVG is `role="img"`; its accessible name states the dates.
 * With P95 beyond the horizon the band runs open to the right edge.
 * ★ Every date on it is simulated, so it wears the sim marking (§3.2): `SimValue`'s dashed outline
 * and "sim" badge, in a group named "<label>, simulated".
 */

const W = 240;
const H = 40;
const INSET = 6;
const AXIS_Y = 28;
const BAND_Y = 16;
const BAND_H = 10;
/** Room past the last date when the band is open-ended, as a share of the axis span. */
const OPEN_END_PAD = 0.15;
/** Half the width of the "P80" label at font size 8; its centre is kept this far from either edge so it never clips. */
const P80_LABEL_HALF_W = 8;

/** Days since the epoch for an ISO day, read in UTC. Pure: no clock is read. */
function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export function ForecastRangeBar({
  lang,
  p50,
  p80,
  p95,
  planEnd,
  today,
}: {
  lang: Lang;
  p50: string;
  p80: string;
  /** Null = beyond the forecast horizon. */
  p95: string | null;
  /** Null or an invalid date drops the plan-end tick and its sentence. */
  planEnd: string | null;
  today: string;
}) {
  const locale = localeFor(lang);
  const fmt = (iso: string) => formatDayMonthYear(iso, locale);
  const plan = planEnd !== null && isValidIsoDate(planEnd) ? planEnd : null;

  const points = [today, p50, p80, ...(p95 ? [p95] : []), ...(plan ? [plan] : [])].map(dayNumber);
  const lo = Math.min(...points);
  const last = Math.max(...points);
  const hi = p95 ? last : last + Math.max(1, (last - lo) * OPEN_END_PAD);
  const span = Math.max(1, hi - lo);
  const xFor = (iso: string) => INSET + ((dayNumber(iso) - lo) / span) * (W - 2 * INSET);

  const bandLeft = xFor(p50);
  const bandRight = p95 ? xFor(p95) : W - INSET;
  const markX = xFor(p80);
  const planX = plan ? xFor(plan) : null;

  const ariaLabel = p95
    ? plan
      ? t(lang, "forecastRangeAria", fmt(p50), fmt(p80), fmt(p95), fmt(plan))
      : t(lang, "forecastRangeAriaNoPlanEnd", fmt(p50), fmt(p80), fmt(p95))
    : plan
      ? t(lang, "forecastRangeAriaBeyond", fmt(p50), fmt(p80), fmt(plan))
      : t(lang, "forecastRangeAriaBeyondNoPlanEnd", fmt(p50), fmt(p80));

  return (
    <div
      role="group"
      aria-label={t(lang, "simValueSr", t(lang, "forecastRangeLabel"))}
      data-sim="true"
      className={`flex items-center gap-1.5 ${SIM_OUTLINE_CLASS}`}
    >
      <svg role="img" aria-label={ariaLabel} viewBox={`0 0 ${W} ${H}`} className="h-10 min-w-0 flex-1">
        <line x1={INSET} x2={W - INSET} y1={AXIS_Y} y2={AXIS_Y} strokeWidth={1} className="stroke-ui-dark-blue dark:stroke-ui-light-grey" />
        <rect
          data-band
          data-open-end={p95 ? undefined : "true"}
          x={bandLeft}
          y={BAND_Y}
          width={Math.max(1, bandRight - bandLeft)}
          height={BAND_H}
          rx={2}
          fillOpacity={0.45}
          className="fill-ui-green-strong dark:fill-ui-green"
        />
        <line data-p80 x1={markX} x2={markX} y1={BAND_Y - 4} y2={AXIS_Y} strokeWidth={2} className="stroke-ui-dark-blue dark:stroke-ui-light-grey" />
        <text data-p80-label x={Math.min(W - P80_LABEL_HALF_W, Math.max(P80_LABEL_HALF_W, markX))} y={BAND_Y - 6} textAnchor="middle" fontSize={8} className="fill-ui-dark-blue dark:fill-ui-light-grey">
          P80
        </text>
        {planX !== null && (
          <g>
            <line
              data-plan-end
              x1={planX}
              x2={planX}
              y1={BAND_Y - 2}
              y2={AXIS_Y + 3}
              strokeWidth={1.5}
              strokeDasharray="2 2"
              className="stroke-ui-dark-blue dark:stroke-ui-light-grey"
            />
            <text
              x={planX}
              y={H - 1}
              textAnchor={planX < W / 4 ? "start" : planX > (3 * W) / 4 ? "end" : "middle"}
              fontSize={8}
              className="fill-ui-dark-blue dark:fill-ui-light-grey"
            >
              {t(lang, "forecastRangePlanEnd")}
            </text>
          </g>
        )}
      </svg>
      <SimBadge lang={lang} />
    </div>
  );
}
