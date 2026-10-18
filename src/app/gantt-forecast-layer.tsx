"use client";

// src/app/gantt-forecast-layer.tsx — the Gantt's simulated finish (§502 part 4, spec §3.7): a faint P50–P95
// band behind the bars and a dashed P80 line labelled "P80 {date}".
//
// Presentational and inert, like gantt-overlays.tsx: `aria-hidden` (the same dates are read out on the
// Dashboard's Forecast tile and the Reports Forecast section) and `pointer-events-none`, so it can never
// intercept a bar drag. It draws on the SHARED day geometry (`dayLeftPx`); the caller's `dayIndexOf` owns
// the clamping, so a finish past the axis sits on its edge rather than off the chart.
//
// ★ The band is `bg-ui-green/10`: faint enough that a bar drawn over it keeps its own colour (eye-checked by
// the owner at un-hide, spec §3.7 "the band stays faint enough that bars read clearly").

import { type Lang, t } from "./i18n";
import { DAY_WIDTH_PX } from "./gantt-engine";
import { dayLeftPx } from "./gantt-overlays";
import { formatWhen } from "./forecast-tables";

export function GanttForecastLayer({
  lang,
  p50,
  p80,
  p95,
  dayIndexOf,
  nameColWidth,
  height,
}: {
  lang: Lang;
  /** The percentile finish dates; `null` = past the forecast horizon. */
  p50: string | null;
  p80: string | null;
  p95: string | null;
  /** The axis day index of a date, clamped to the visible range (`null` = past the horizon, the last day);
   *  `null` back only for a date that does not parse. */
  dayIndexOf: (iso: string | null) => number | null;
  nameColWidth: number;
  height: number;
}) {
  const i50 = dayIndexOf(p50);
  const i80 = dayIndexOf(p80);
  const i95 = dayIndexOf(p95);
  if (i50 === null || i80 === null || i95 === null) return null;
  const bandLeft = dayLeftPx(i50, nameColWidth);
  // Through the END of the P95 day: "done by D" includes D.
  const bandWidth = dayLeftPx(i95, nameColWidth) + DAY_WIDTH_PX - bandLeft;
  const lineLeft = dayLeftPx(i80, nameColWidth);
  const label = t(lang, "ganttForecastP80Label", formatWhen(p80, lang));
  return (
    <>
      {/* The visible label is inside the aria-hidden layer; this one line gives a screen reader the same date. */}
      <span data-gantt-forecast-sr="" className="sr-only">{label}</span>
      <div
        data-gantt-forecast-layer=""
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 z-0 w-full"
        style={{ height }}
      >
        <div
          data-gantt-forecast-band=""
          className="absolute top-0 bg-ui-green/10"
          style={{ left: bandLeft, width: bandWidth, height }}
        />
        <div
          data-gantt-forecast-p80=""
          className="absolute top-0 border-l-2 border-dashed border-ui-green-strong dark:border-ui-green"
          style={{ left: lineLeft, height }}
        />
        {/* LEFT of the line: a finish past the axis clamps to the right edge, where a label to the right
            would run off the chart. A finish never clamps left — the axis always contains today. */}
        <span
          className="absolute top-0 -translate-x-full whitespace-nowrap bg-surface px-1 text-[10px] font-medium text-ui-green-strong dark:text-ui-green"
          style={{ left: lineLeft - 2 }}
        >
          {label}
        </span>
      </div>
    </>
  );
}
