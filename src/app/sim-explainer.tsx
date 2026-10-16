"use client";

import { useCallback, useId, useRef, useState } from "react";
import { Button } from "./button";
import { chanceText } from "./chance-text";
import { IconButton } from "./icon-button";
import { InformationCircleIcon, XMarkIcon } from "./icons";
import { type Lang, t } from "./i18n";
import { percentileWord, type SimPercentile } from "./percentile-words";
import { PopoverPanel } from "./popover-panel";
import { MAX_HORIZON_WORKING_DAYS } from "./forecast/constants";
import { localeFor } from "./date-format";

/** Help concept the explainer's link opens. The entry itself is created
 *  elsewhere; consumers wire `onOpenHelp` (typically `requestHelpConcept`). */
export const FORECAST_SIM_HELP_ID = "concept-forecast-simulation";

/** The engine's horizon in working days. A trial that never finished is encoded
 *  in the distribution, and a beyond-horizon marker as, this plus one. */
const HORIZON_DAYS = MAX_HORIZON_WORKING_DAYS;
const MAX_BINS = 20;

/** One marker for the histogram's accessible label: a day count, or "beyond the horizon". */
function markerPhrase(lang: Lang, days: number): string {
  return days > HORIZON_DAYS ? t(lang, "simHistogramBeyond") : t(lang, "simHistogramIn", days.toLocaleString(localeFor(lang)));
}

/** P50/P80/P95 cut values, in working days ahead. */
export interface SimMarkers {
  p50: number;
  p80: number;
  p95: number;
}

export interface HistogramBin {
  /** First working day the bin covers (inclusive). */
  from: number;
  count: number;
}

export interface Histogram {
  bins: HistogramBin[];
  /** Trials that did not finish inside the horizon; NOT drawn as a bar. */
  beyond: number;
}

/** Bin finished-trial days into at most `maxBins` equal-width bins. Trials
 *  beyond the horizon are counted separately and excluded from the bars. */
export function buildHistogramBins(distribution: ArrayLike<number>, maxBins: number): Histogram {
  const finished: number[] = [];
  for (let i = 0; i < distribution.length; i += 1) if (distribution[i] <= HORIZON_DAYS) finished.push(distribution[i]);
  const beyond = distribution.length - finished.length;
  if (finished.length === 0) return { bins: [], beyond };
  const min = Math.min(...finished);
  const max = Math.max(...finished);
  const width = Math.max(1, Math.ceil((max - min + 1) / maxBins));
  const count = Math.ceil((max - min + 1) / width);
  const bins: HistogramBin[] = Array.from({ length: count }, (_, i) => ({ from: min + i * width, count: 0 }));
  const counts = bins.map(() => 0);
  for (const d of finished) counts[Math.floor((d - min) / width)] += 1;
  return { bins: bins.map((b, i) => ({ ...b, count: counts[i] })), beyond };
}

const CHART_W = 240;
const CHART_H = 72;
const CHART_TOP = 10;
const CUTS: ReadonlyArray<{ p: SimPercentile; key: keyof SimMarkers; label: string }> = [
  { p: 50, key: "p50", label: "P50" },
  { p: 80, key: "p80", label: "P80" },
  { p: 95, key: "p95", label: "P95" },
];

function Chart({
  bins,
  markers,
  ariaLabel,
}: {
  bins: HistogramBin[];
  markers: SimMarkers;
  ariaLabel: string;
}) {
  const first = bins[0]?.from ?? 0;
  const span = bins.length > 1 ? bins[1].from - first : 1;
  const domain = Math.max(1, bins.length * span);
  const slot = CHART_W / Math.max(1, bins.length);
  const peak = Math.max(1, ...bins.map((b) => b.count));
  const xFor = (day: number) => Math.min(CHART_W, Math.max(0, ((day - first) / domain) * CHART_W));
  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${CHART_W} ${CHART_H + CHART_TOP}`}
      className="h-20 w-full"
    >
      {bins.map((b, i) => {
        const h = (b.count / peak) * CHART_H;
        return (
          <rect
            key={b.from}
            data-bin={b.from}
            x={i * slot + 0.5}
            y={CHART_TOP + CHART_H - h}
            width={Math.max(1, slot - 1)}
            height={h}
            className="fill-ui-green-strong dark:fill-ui-green"
          />
        );
      })}
      {CUTS.map((c) => {
        const x = xFor(markers[c.key]);
        return (
          <g key={c.p}>
            <line
              data-cut={c.p}
              x1={x}
              x2={x}
              y1={CHART_TOP - 2}
              y2={CHART_TOP + CHART_H}
              strokeWidth={1.5}
              className="stroke-ui-dark-blue dark:stroke-ui-light-grey"
            />
            <text
              x={x}
              y={CHART_TOP - 3}
              textAnchor="middle"
              fontSize={8}
              className="fill-ui-dark-blue dark:fill-ui-light-grey"
            >
              {c.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const LINE_KEY = {
  date: "simExplainerLine1",
  chance: "simExplainerLineChance",
  milestone: "simExplainerLineMilestone",
} as const;

/** The (i) beside a simulated value: a popover saying how to read it. */
type SimExplainerBase = {
  lang: Lang;
  windowDays: number;
  /** Names the (i) after its value, so two on one screen are told apart. Absent → the plain name. */
  label?: string;
  /** Renders the Help link when given. */
  onOpenHelp?: (conceptId: string) => void;
};

/** A finish `date` (default) or the `chance` of finishing by the plan end: both draw the histogram, so the
 *  distribution is required. The per-`milestone` variant draws none (the line, the window, the Help link). */
export type SimExplainerProps =
  | (SimExplainerBase & {
      kind?: "date" | "chance";
      /** Working days per trial; the engine's `Int32Array` is passed as is. */
      distribution: ArrayLike<number>;
      trials: number;
      markers: SimMarkers;
    })
  | (SimExplainerBase & { kind: "milestone"; distribution?: never; trials?: never; markers?: never });

/** The props of the histogram variants, for a caller that passes the rest through (`SimValue`). */
export type SimValueExplainerProps = Extract<SimExplainerProps, { distribution: ArrayLike<number> }>;

export function SimExplainer(props: SimExplainerProps) {
  const { lang, windowDays, label, onOpenHelp } = props;
  const kind = props.kind ?? "date";
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);
  const isMilestone = props.kind === "milestone";
  const { bins, beyond } = isMilestone ? { bins: [], beyond: 0 } : buildHistogramBins(props.distribution, MAX_BINS);
  const beyondShare = !isMilestone && beyond > 0 && props.trials > 0 ? chanceText(lang, beyond / props.trials) : "";
  const name = label ? t(lang, "simExplainerOpenFor", label) : t(lang, "simExplainerOpen");
  return (
    <>
      <IconButton
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        label={name}
        title={name}
        size="sm"
      >
        <InformationCircleIcon aria-hidden="true" className="h-4 w-4" />
      </IconButton>
      <PopoverPanel
        open={open}
        anchorRef={triggerRef}
        onClose={close}
        role="dialog"
        ariaLabel={t(lang, "simExplainerTitle")}
        id={panelId}
        className="w-72 space-y-2 p-3 text-xs"
      >
        <span className="flex items-start justify-between gap-2">
          <span className="font-medium text-foreground">{t(lang, "simExplainerTitle")}</span>
          <IconButton label={t(lang, "alertModalClose")} title={t(lang, "alertModalClose")} onClick={close} size="xs">
            <XMarkIcon aria-hidden="true" className="h-3.5 w-3.5" />
          </IconButton>
        </span>
        <p className="block text-foreground">{t(lang, LINE_KEY[kind])}</p>
        <p className="block text-muted-foreground">{t(lang, "simExplainerWindow", windowDays)}</p>
        {!isMilestone && bins.length > 0 && (
          <Chart
            bins={bins}
            markers={props.markers}
            ariaLabel={t(lang, "simHistogramAria",
              markerPhrase(lang, props.markers.p50), markerPhrase(lang, props.markers.p80), markerPhrase(lang, props.markers.p95))}
          />
        )}
        {!isMilestone && (
          <ul className="m-0 list-none p-0 text-muted-foreground">
            {CUTS.map((c) => (
              <li key={c.p}>
                {c.label} · {t(lang, percentileWord(c.p))}
              </li>
            ))}
          </ul>
        )}
        {beyond > 0 && <p className="block text-muted-foreground">{t(lang, "simBeyondHorizon", beyondShare)}</p>}
        {onOpenHelp && (
          <Button variant="ghost" size="xs" onClick={() => onOpenHelp(FORECAST_SIM_HELP_ID)}>
            {t(lang, "simExplainerHelp")}
          </Button>
        )}
      </PopoverPanel>
    </>
  );
}
