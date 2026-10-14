"use client";

// Schedule forecast chart (§502): share of runs finishing in each working week, the
// cumulative curve, and P50/P80/P95 as vertical lines that each carry a text label.
// One x scale (`slotX`) places bars, lines and ticks; one y scale (share of runs) holds
// both the bars and the curve, so every mark reads against the same ticks.

import { type Lang, t } from "./i18n";
import { localeFor } from "./date-format";
import { formatDayMonth, formatDayMonthYear } from "./forecast-format";
import { formatWhen } from "./forecast-tables";
import type { ScheduleForecast } from "./forecast";
import { MAX_HORIZON_WORKING_DAYS } from "./forecast/constants";
import { nthWorkingDayAfter } from "./working-days";

const WORKING_DAYS_PER_WEEK = 5;
const W = 640;
const H = 220;
const X0 = 36;
const X1 = W - 8;
const Y_TOP = 28;
const Y_BOTTOM = H - 24;
const MAX_X_TICKS = 6;
const Y_TICKS = [0, 0.5, 1] as const;
const PERCENTILE_LABEL_STEP = 9;

/** Week slot of a simulated finish day: days 0–5 are week 0, 6–10 week 1, and so on. */
export function weekOf(day: number): number {
  return day <= 0 ? 0 : Math.ceil(day / WORKING_DAYS_PER_WEEK) - 1;
}

/** Runs per working week up to the last non-empty week, plus the runs beyond the horizon. */
export function weeklyBuckets(distribution: ArrayLike<number>): { weeks: number[]; beyond: number } {
  const weeks: number[] = [];
  let beyond = 0;
  for (let i = 0; i < distribution.length; i += 1) {
    const d = distribution[i];
    if (d > MAX_HORIZON_WORKING_DAYS) {
      beyond += 1;
      continue;
    }
    const w = weekOf(d);
    while (weeks.length <= w) weeks.push(0);
    weeks[w] += 1;
  }
  return { weeks: weeks.length === 0 ? [0] : weeks, beyond };
}

/** Slack for float error in `slotX`, in viewBox units. */
const EDGE_EPSILON = 0.5;

/** A tick at either edge of the plot is anchored inward, so its label is not clipped. */
function tickAnchor(x: number): "start" | "middle" | "end" {
  if (x <= X0 + EDGE_EPSILON) return "start";
  return x >= X1 - EDGE_EPSILON ? "end" : "middle";
}

export function ForecastChart({
  lang,
  forecast,
  today,
  holidaySet,
}: {
  lang: Lang;
  forecast: ScheduleForecast;
  today: string;
  holidaySet: ReadonlySet<string>;
}) {
  const { weeks, beyond } = weeklyBuckets(forecast.distribution);
  const total = Math.max(1, forecast.distribution.length);
  const slots = weeks.length + (beyond > 0 ? 1 : 0);
  const slotW = (X1 - X0) / slots;
  const slotX = (i: number) => X0 + i * slotW;
  // Working days ahead on the same scale: day 5 lands on slotX(1), the end of week 0,
  // where that week's tick and cumulative point sit.
  const dayX = (day: number) => X0 + (day / WORKING_DAYS_PER_WEEK) * slotW;
  const y = (share: number) => Y_BOTTOM - share * (Y_BOTTOM - Y_TOP);
  const beyondSlot = weeks.length;

  let running = 0;
  const cumulative = [`${X0},${y(0)}`];
  weeks.forEach((count, i) => {
    running += count;
    cumulative.push(`${slotX(i + 1)},${y(running / total)}`);
  });
  if (beyond > 0) cumulative.push(`${slotX(beyondSlot + 1)},${y(1)}`);

  const tickEvery = Math.max(1, Math.ceil(weeks.length / MAX_X_TICKS));
  const locale = localeFor(lang);
  const ticks = weeks
    .map((_, i) => i)
    .filter((i) => i % tickEvery === 0)
    .map((i) => ({ i, x: slotX(i + 1), date: nthWorkingDayAfter(today, (i + 1) * WORKING_DAYS_PER_WEEK, holidaySet) }));
  // Day and month alone are ambiguous once the axis runs into another calendar year.
  const axisEnd = nthWorkingDayAfter(today, weeks.length * WORKING_DAYS_PER_WEEK, holidaySet);
  const formatTick = axisEnd.slice(0, 4) !== today.slice(0, 4) ? formatDayMonthYear : formatDayMonth;
  const summary = t(lang, "forecastChartSummary", ...forecast.when.map((w) => formatWhen(w.date, lang)));

  return (
    <figure>
      <figcaption className="mb-1 text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
        {t(lang, "forecastChartTitle")}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={summary}>
        {Y_TICKS.map((v) => (
          <g key={v} aria-hidden="true">
            <line x1={X0} y1={y(v)} x2={X1} y2={y(v)} className="stroke-line" strokeWidth={1} />
            <text x={X0 - 4} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground text-[8px] tabular-nums">
              {t(lang, "forecastPercent", Math.round(v * 100))}
            </text>
          </g>
        ))}
        {weeks.map((count, i) =>
          count === 0 ? null : (
            <rect
              key={i}
              data-week={i}
              x={slotX(i) + 1}
              y={y(count / total)}
              width={Math.max(1, slotW - 2)}
              height={Y_BOTTOM - y(count / total)}
              className="fill-muted-foreground/40"
            />
          ),
        )}
        {beyond > 0 && (
          <rect
            data-week="beyond"
            x={slotX(beyondSlot) + 1}
            y={y(beyond / total)}
            width={Math.max(1, slotW - 2)}
            height={Y_BOTTOM - y(beyond / total)}
            className="fill-ui-pink/40"
          />
        )}
        <polyline points={cumulative.join(" ")} fill="none" className="stroke-ui-dark-blue dark:stroke-ui-light-grey" strokeWidth={2} />
        {forecast.when.map((w, i) => {
          const x = w.daysAhead === "beyond" ? slotX(beyondSlot) + slotW / 2 : dayX(w.daysAhead);
          return (
            <g key={w.p} data-percentile={w.p} aria-hidden="true">
              <line x1={x} y1={Y_TOP - 4} x2={x} y2={Y_BOTTOM} className="stroke-foreground" strokeWidth={1} strokeDasharray="4 3" />
              <text x={x + 3} y={Y_TOP - 18 + i * PERCENTILE_LABEL_STEP} className="fill-foreground text-[8px] font-medium">
                {`P${w.p}`}
              </text>
            </g>
          );
        })}
        <line x1={X0} y1={Y_BOTTOM} x2={X1} y2={Y_BOTTOM} className="stroke-line" strokeWidth={1} aria-hidden="true" />
        {ticks.map(({ i, x, date }) => (
          <text
            key={i}
            data-tick={i}
            aria-hidden="true"
            x={x}
            y={H - 8}
            textAnchor={tickAnchor(x)}
            className="fill-muted-foreground text-[8px] tabular-nums"
          >
            {formatTick(date, locale)}
          </text>
        ))}
        {beyond > 0 && (
          <text
            aria-hidden="true"
            x={slotX(beyondSlot) + slotW / 2}
            y={H - 8}
            textAnchor="middle"
            className="fill-muted-foreground text-[8px]"
          >
            {t(lang, "forecastBeyond")}
          </text>
        )}
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-xs text-muted-foreground" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5">
          <svg width="12" height="8"><rect width="12" height="8" className="fill-muted-foreground/40" /></svg>
          {t(lang, "forecastChartWeekly")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" className="stroke-ui-dark-blue dark:stroke-ui-light-grey" strokeWidth={2} /></svg>
          {t(lang, "forecastChartCumulative")}
        </span>
      </div>
    </figure>
  );
}
