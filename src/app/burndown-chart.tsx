"use client";

// One burn-down chart (MR 3 addendum §5): pure presentation over a ChartModel.
// Dash patterns and the legend carry each series' meaning, not colour alone.
// End labels are foreground text (small `ui-purple` text fails AA on dark
// schemes); the line swatch in the legend carries the colour.
import { type Lang, t, localeFor } from "./i18n";
import { formatCurrency } from "./resource-cost";
import { formatDayMonthYear, formatHours } from "./forecast-format";
import { TermTooltip } from "./budget-forecast-tooltip";
import { scaleDate, scaleValue, type ChartModel, type ChartOrientation, type ChartPoint, type ChartSegment, type ChartUnit } from "./burndown-geometry";

const W = 640, H = 240, PAD_L = 64, PAD_R = 80, PAD_T = 16, PAD_B = 28;
const X0 = PAD_L, X1 = W - PAD_R, Y_BOTTOM = H - PAD_B, Y_TOP = PAD_T;

const DASH = { planned: "5 4", pace: "7 4", efficiency: "2 3", evLine: "6 2 1 2", bac: "4 4", today: "3 3" } as const;

function Swatch({ className, dash, width = 2.5 }: { className: string; dash?: string; width?: number }) {
  return (
    <svg width="22" height="6" aria-hidden="true">
      <line x1="0" y1="3" x2="22" y2="3" className={className} strokeWidth={width} strokeDasharray={dash} />
    </svg>
  );
}

/** The VAC a segment ends at, in BOTH orientations (spec §5.2: the chart's name
 *  summarises the end VAC values). `buildChartModel` sets a burn-down segment's
 *  `endFigure` to the forecast's VAC but a cumulative one's to its EAC, so the
 *  cumulative VAC is recovered in the chart's frame as `total − EAC`. */
function segmentVac(segment: ChartSegment, orientation: ChartOrientation, total: number): number {
  return orientation === "burndown" ? segment.endFigure : total - segment.endFigure;
}

export function BurndownChart({
  lang, currency, model, unit, orientation, periods,
}: {
  lang: Lang; currency: string; model: ChartModel; unit: ChartUnit; orientation: ChartOrientation; periods: readonly string[];
}) {
  if (model.empty) return <p className="text-sm text-muted-foreground">{t(lang, "dashboardNoBudget")}</p>;
  const locale = localeFor(lang);
  const fmt = (v: number) => (unit === "eur" ? formatCurrency(v, currency, locale) : formatHours(v, locale));
  const x = (date: string) => scaleDate(date, model.xDomain, X0, X1);
  const y = (value: number) => scaleValue(value, model.yDomain, Y_BOTTOM, Y_TOP);
  const pts = (list: readonly ChartPoint[]) => list.map((p) => `${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const down = orientation === "burndown";
  const caption = t(lang, down
    ? (unit === "eur" ? "burndownBudgetRemaining" : "burndownHoursRemaining")
    : (unit === "eur" ? "burndownValueCumulative" : "burndownHoursCumulative"));
  const aria = [t(lang, "burndownAria", caption, t(lang, unit === "eur" ? "burndownUnitEur" : "burndownUnitHours"))];
  if (model.runOut) aria.push(t(lang, "burndownAriaRunOut", formatDayMonthYear(model.runOut.date, locale)));
  if (model.pace && model.efficiency) {
    aria.push(t(lang, "burndownAriaEnd",
      fmt(segmentVac(model.pace, orientation, model.total)), fmt(segmentVac(model.efficiency, orientation, model.total))));
  } else if (model.pace) {
    aria.push(t(lang, "burndownAriaEndPace", fmt(segmentVac(model.pace, orientation, model.total))));
  }
  const yTicks = [...new Set([model.yDomain[0], 0, model.total / 2, model.total])].filter((v) => v >= model.yDomain[0]);
  const belowZero = model.yDomain[0] < 0;
  const zeroY = y(0);
  const actualClass = model.over ? "stroke-ui-pink" : "stroke-ui-green";

  return (
    <div className="space-y-2">
      <div>
        <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{caption}</div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={aria.join(" ")}>
          {belowZero && <rect x={X0} y={zeroY} width={X1 - X0} height={Y_BOTTOM - zeroY} className="fill-ui-pink/10" />}
          <line x1={X0} y1={Y_TOP} x2={X0} y2={Y_BOTTOM} className="stroke-line" strokeWidth={1} />
          <line x1={X0} y1={zeroY} x2={X1} y2={zeroY} className="stroke-line" strokeWidth={1} />
          {yTicks.map((v) => (
            <text key={v} data-axis="y" x={X0 - 4} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground text-[8px] tabular-nums" aria-hidden="true">{fmt(v)}</text>
          ))}
          {belowZero && (
            <text x={X0 + 4} y={Y_BOTTOM - 4} className="fill-muted-foreground text-[8px]" aria-hidden="true">{t(lang, "burndownOver")}</text>
          )}
          {periods.length > 0 && (
            <>
              <text x={X0} y={H - 8} textAnchor="start" className="fill-muted-foreground text-[8px] tabular-nums" aria-hidden="true">{periods[0]}</text>
              <text x={X1} y={H - 8} textAnchor="end" className="fill-muted-foreground text-[8px] tabular-nums" aria-hidden="true">{periods[periods.length - 1]}</text>
            </>
          )}
          {model.bacLine !== null && (
            <>
              <line x1={X0} y1={y(model.bacLine)} x2={X1} y2={y(model.bacLine)} className="stroke-muted-foreground" strokeWidth={1.5} strokeDasharray={DASH.bac} />
              <text x={X0 + 4} y={y(model.bacLine) - 4} className="fill-muted-foreground text-[8px]" aria-hidden="true">{t(lang, "burndownBac", fmt(model.bacLine))}</text>
            </>
          )}
          <polyline points={pts(model.planned)} fill="none" className="stroke-muted-foreground" strokeWidth={2} strokeDasharray={DASH.planned} />
          {model.evLine && <polyline points={pts(model.evLine)} fill="none" className="stroke-[var(--rag-amber)]" strokeWidth={2} strokeDasharray={DASH.evLine} />}
          {model.actual.length > 1 && <polyline points={pts(model.actual)} fill="none" className={actualClass} strokeWidth={2.5} />}
          {model.pace && (
            <>
              <line x1={x(model.pace.from.date)} y1={y(model.pace.from.value)} x2={x(model.pace.to.date)} y2={y(model.pace.to.value)} className="stroke-ui-dark-blue" strokeWidth={2.5} strokeDasharray={DASH.pace} />
              <text x={X1 + 4} y={y(model.pace.to.value) + 3} className="fill-foreground text-[8px] tabular-nums" aria-hidden="true">{fmt(model.pace.endFigure)}</text>
            </>
          )}
          {model.efficiency && (
            <>
              <line x1={x(model.efficiency.from.date)} y1={y(model.efficiency.from.value)} x2={x(model.efficiency.to.date)} y2={y(model.efficiency.to.value)} className="stroke-ui-purple" strokeWidth={2.5} strokeDasharray={DASH.efficiency} />
              <text x={X1 + 4} y={y(model.efficiency.to.value) + 12} className="fill-foreground text-[8px] tabular-nums" aria-hidden="true">{fmt(model.efficiency.endFigure)}</text>
            </>
          )}
          {model.today && (
            <line x1={x(model.today)} y1={Y_TOP} x2={x(model.today)} y2={Y_BOTTOM} className="stroke-muted-foreground" strokeWidth={1} strokeDasharray={DASH.today} />
          )}
          <line x1={x(model.planEnd)} y1={Y_TOP} x2={x(model.planEnd)} y2={Y_BOTTOM} className="stroke-line" strokeWidth={1} />
          {model.ev && (
            <path d={`M ${x(model.ev.date)} ${y(model.ev.value) - 5} l 5 5 l -5 5 l -5 -5 z`} className="fill-[var(--rag-amber)]" />
          )}
          {model.ev && down && (
            <text x={x(model.ev.date) - 7} y={y(model.ev.value) - 7} textAnchor="end" className="fill-muted-foreground text-[8px]" aria-hidden="true">{t(lang, "burndownWorkLeft", fmt(model.ev.value))}</text>
          )}
          {model.runOut && <circle cx={x(model.runOut.date)} cy={y(model.runOut.value)} r={4} className="fill-ui-pink" />}
        </svg>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><Swatch className="stroke-muted-foreground" dash={DASH.planned} width={2} />{t(lang, "burndownPlanned")}</span>
        {model.actual.length > 1 && <span className="inline-flex items-center gap-1.5"><Swatch className={actualClass} />{t(lang, "burndownActual")}</span>}
        {model.pace && <span className="inline-flex items-center gap-1.5"><Swatch className="stroke-ui-dark-blue" dash={DASH.pace} />{t(lang, "forecastPaceTitle")}</span>}
        {model.efficiency && <span className="inline-flex items-center gap-1.5"><Swatch className="stroke-ui-purple" dash={DASH.efficiency} />{t(lang, "forecastEfficiencyTitle")}</span>}
        {model.evLine && (
          <span className="inline-flex items-center gap-1.5">
            <Swatch className="stroke-[var(--rag-amber)]" dash={DASH.evLine} width={2} />{t(lang, "burndownEvHistory")}
            <TermTooltip lang={lang} term={t(lang, "burndownEvHistory")} tip={t(lang, "burndownTipEvHistory")} />
          </span>
        )}
        {model.ev && <span className="inline-flex items-center gap-1.5"><svg width="10" height="10" aria-hidden="true"><path d="M 5 0 l 5 5 l -5 5 l -5 -5 z" className="fill-[var(--rag-amber)]" /></svg>{t(lang, "burndownEv")}</span>}
        {model.runOut && <span className="inline-flex items-center gap-1.5"><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" className="fill-ui-pink" /></svg>{t(lang, "forecastRunOut")}</span>}
        {model.today && <span className="inline-flex items-center gap-1.5"><Swatch className="stroke-muted-foreground" dash={DASH.today} width={1} />{t(lang, "burndownToday")}</span>}
      </div>
      {model.frameDiffers && <p className="text-xs text-muted-foreground">{t(lang, "burndownFrameNote")}</p>}
      {model.evHistoryBlockedBy && (
        <p className="text-xs text-muted-foreground">{t(lang, "burndownEvHistoryUnavailable", model.evHistoryBlockedBy.join(", "))}</p>
      )}
    </div>
  );
}
