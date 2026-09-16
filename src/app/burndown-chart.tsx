"use client";

// One burn-down chart (MR 3 addendum §5): pure presentation over a ChartModel.
// Dash patterns and the legend carry each series' meaning, not colour alone.
// End labels are foreground text (small `ui-purple` text fails AA on dark
// schemes); the line swatch in the legend carries the colour.
import { type Lang, t, localeFor } from "./i18n";
import { formatCurrency } from "./resource-cost";
import { formatDayMonthYear, formatHours, signedFigure } from "./forecast-format";
import { TermTooltip } from "./budget-forecast-tooltip";
import { scaleDate, scaleValue, type BacMarker, type ChartModel, type ChartOrientation, type ChartPoint, type ChartUnit } from "./burndown-geometry";

const W = 640, H = 240, PAD_L = 64, PAD_R = 80, PAD_T = 16, PAD_B = 28;
const X0 = PAD_L, X1 = W - PAD_R, Y_BOTTOM = H - PAD_B, Y_TOP = PAD_T;

const DASH = { planned: "5 4", pace: "7 4", efficiency: "2 3", evLine: "6 2 1 2", evPartial: "2 4", bac: "4 4", today: "3 3" } as const;

/** Baseline offset of an end label below its line end (8px text). */
const END_LABEL_OFFSET = 3;
/** Minimum distance between the pace and efficiency end-label baselines. */
const END_LABEL_GAP = 10;

/**
 * Baselines for the two end labels. Each sits at its own line end; when the two
 * ends are closer than END_LABEL_GAP (EAC pace ≈ EAC efficiency is common) the
 * pair is spread around its midpoint, keeping its order (pace on top on a tie),
 * then shifted back inside the plot.
 */
function endLabelYs(paceY: number | null, efficiencyY: number | null): { pace: number | null; efficiency: number | null } {
  if (paceY === null || efficiencyY === null || Math.abs(paceY - efficiencyY) >= END_LABEL_GAP) {
    return { pace: paceY, efficiency: efficiencyY };
  }
  const mid = (paceY + efficiencyY) / 2;
  const top = mid - END_LABEL_GAP / 2;
  const bottom = mid + END_LABEL_GAP / 2;
  const shift = bottom > Y_BOTTOM ? Y_BOTTOM - bottom : top < Y_TOP + END_LABEL_GAP ? Y_TOP + END_LABEL_GAP - top : 0;
  return paceY <= efficiencyY
    ? { pace: top + shift, efficiency: bottom + shift }
    : { pace: bottom + shift, efficiency: top + shift };
}

function Swatch({ className, dash, width = 2.5 }: { className: string; dash?: string; width?: number }) {
  return (
    <svg width="22" height="6" aria-hidden="true">
      <line x1="0" y1="3" x2="22" y2="3" className={className} strokeWidth={width} strokeDasharray={dash} />
    </svg>
  );
}

export function BurndownChart({
  lang, currency, model, unit, orientation, periods,
}: {
  lang: Lang; currency: string; model: ChartModel; unit: ChartUnit; orientation: ChartOrientation; periods: readonly string[];
}) {
  if (model.empty) return <p className="text-sm text-muted-foreground">{t(lang, "dashboardNoBudget")}</p>;
  const locale = localeFor(lang);
  const fmt = (v: number) => (unit === "eur" ? formatCurrency(v, currency, locale) : formatHours(v, locale));
  // The hours key carries its own " h", so the join amount is the bare number.
  const joinKey = (count: number) => (unit === "eur"
    ? (count > 1 ? "burndownEvJoinsEurPlural" : "burndownEvJoinsEur")
    : (count > 1 ? "burndownEvJoinsHoursPlural" : "burndownEvJoinsHours"));
  const joinAmount = (v: number) => (unit === "eur" ? fmt(v) : new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(v));
  const x = (date: string) => scaleDate(date, model.xDomain, X0, X1);
  const y = (value: number) => scaleValue(value, model.yDomain, Y_BOTTOM, Y_TOP);
  const pts = (list: readonly ChartPoint[]) => list.map((p) => `${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const down = orientation === "burndown";
  const caption = t(lang, down
    ? (unit === "eur" ? "burndownBudgetRemaining" : "burndownHoursRemaining")
    : (unit === "eur" ? "burndownValueCumulative" : "burndownHoursCumulative"));
  const aria = [t(lang, "burndownAria", caption, t(lang, unit === "eur" ? "burndownUnitEur" : "burndownUnitHours"))];
  if (model.runOut) aria.push(t(lang, "burndownAriaRunOut", formatDayMonthYear(model.runOut.date, locale)));
  // Spec §5.2: the name carries the forecast's own VAC (the card figure) in BOTH
  // orientations; `endFigure` is the EAC in cumulative, so it is not used here.
  if (model.pace && model.efficiency) {
    aria.push(t(lang, "burndownAriaEnd", fmt(model.pace.vac), fmt(model.efficiency.vac)));
  } else if (model.pace) {
    aria.push(t(lang, "burndownAriaEndPace", fmt(model.pace.vac)));
  } else if (model.efficiency) {
    // The two availability predicates are independent, so efficiency-without-pace
    // is a real state (`isPaceAvailable` false, `isEfficiencyAvailable` true);
    // without this branch that forecast's name carries no end figure at all.
    aria.push(t(lang, "burndownAriaEndEfficiency", fmt(model.efficiency.vac)));
  }
  // A marker reads "+€3,000 Vendor", or "−€800 Ops removed" when every entry
  // behind it deleted its bucket. The pure model carries the amount and the
  // names apart (it is i18n- and formatter-free), so the sentence is composed
  // here — the ordinary case is the pair with no trailing word, which is why
  // only the deletion wording is a key.
  const markerLabel = (marker: BacMarker) => {
    const amount = signedFigure(fmt(marker.amount), marker.amount);
    return marker.removed
      ? t(lang, "burndownBacMarkerRemoved", amount, marker.label)
      : `${amount} ${marker.label}`;
  };
  // The ticks are `aria-hidden` like every other in-plot label, so without this
  // sentence the recorded budget changes would reach no screen reader at all.
  if (model.bacMarkers.length > 0) {
    aria.push(t(lang, "burndownAriaBudgetChanges", model.bacMarkers
      .map((marker) => `${formatDayMonthYear(marker.date, locale)} ${markerLabel(marker)}`)
      .join("; ")));
  }
  // Two partial spans can name the same buckets; say each sentence once.
  for (const names of new Set(model.evPartialNames.map((p) => p.names))) aria.push(t(lang, "burndownAriaEvPartial", names));
  const partialCaptions = [...new Set(model.evPartialNames.map((p) =>
    t(lang, p.created ? "burndownEvPartialCreated" : "burndownEvPartialNotRecorded", p.names)))];
  const hasPartial = model.evSegments?.some((seg) => seg.partial) ?? false;
  const yTicks = [...new Set([model.yDomain[0], 0, model.total / 2, model.total])].filter((v) => v >= model.yDomain[0]);
  const belowZero = model.yDomain[0] < 0;
  const zeroY = y(0);
  const actualClass = model.over ? "stroke-ui-pink" : "stroke-ui-green";
  const labelY = endLabelYs(
    model.pace ? y(model.pace.to.value) + END_LABEL_OFFSET : null,
    model.efficiency ? y(model.efficiency.to.value) + END_LABEL_OFFSET : null,
  );

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
          {/* Recorded budget changes replace the flat BAC line with a stepped
              one plus a dashed reference at the baseline. Each of the two is
              named by its own text label, so they never rely on weight alone. */}
          {model.bacSteps ? (
            <>
              {model.bacBaseline !== null && (
                <>
                  <line data-bac-baseline="" x1={X0} y1={y(model.bacBaseline)} x2={X1} y2={y(model.bacBaseline)} className="stroke-muted-foreground" strokeWidth={1} strokeDasharray={DASH.bac} />
                  <text x={X0 + 4} y={y(model.bacBaseline) + 9} className="fill-muted-foreground text-[8px]" aria-hidden="true">{t(lang, "burndownBacBaseline")}</text>
                </>
              )}
              <polyline data-bac-steps="" points={pts(model.bacSteps)} fill="none" className="stroke-muted-foreground" strokeWidth={1.5} strokeDasharray={DASH.bac} />
              {model.bacMarkers.map((marker) => (
                <g key={marker.date}>
                  <line x1={x(marker.date)} y1={y(marker.value) - 4} x2={x(marker.date)} y2={y(marker.value) + 4} className="stroke-muted-foreground" strokeWidth={1.5} />
                  <text x={x(marker.date) + (x(marker.date) > (X0 + X1) / 2 ? -4 : 4)} y={y(marker.value) - 7} textAnchor={x(marker.date) > (X0 + X1) / 2 ? "end" : "start"} className="fill-foreground text-[8px] tabular-nums" aria-hidden="true">
                    {markerLabel(marker)}
                  </text>
                </g>
              ))}
            </>
          ) : model.bacLine !== null && (
            <>
              <line data-bac-line="" x1={X0} y1={y(model.bacLine)} x2={X1} y2={y(model.bacLine)} className="stroke-muted-foreground" strokeWidth={1.5} strokeDasharray={DASH.bac} />
              <text x={X0 + 4} y={y(model.bacLine) - 4} className="fill-muted-foreground text-[8px]" aria-hidden="true">{t(lang, "burndownBac", fmt(model.bacLine))}</text>
            </>
          )}
          <polyline points={pts(model.planned)} fill="none" className="stroke-muted-foreground" strokeWidth={2} strokeDasharray={DASH.planned} />
          {model.evSegments?.map((seg, i) => (
            <polyline key={i} points={pts(seg.points)} fill="none" className="stroke-[var(--rag-amber)]" strokeWidth={2} strokeDasharray={seg.partial ? DASH.evPartial : DASH.evLine} />
          ))}
          {model.evJoins.map((j) => (
            <text key={j.date} x={x(j.date)} y={y(j.value) - 6} textAnchor={x(j.date) > (X0 + X1) / 2 ? "end" : "start"} className="fill-foreground text-[8px] tabular-nums" aria-hidden="true">
              {t(lang, joinKey(j.count), j.label, joinAmount(j.amount))}
            </text>
          ))}
          {model.actual.length > 1 && <polyline points={pts(model.actual)} fill="none" className={actualClass} strokeWidth={2.5} />}
          {model.pace && (
            <>
              <line x1={x(model.pace.from.date)} y1={y(model.pace.from.value)} x2={x(model.pace.to.date)} y2={y(model.pace.to.value)} className="stroke-ui-dark-blue" strokeWidth={2.5} strokeDasharray={DASH.pace} />
              <text x={X1 + 4} y={labelY.pace ?? undefined} className="fill-foreground text-[8px] tabular-nums" aria-hidden="true">{fmt(model.pace.endFigure)}</text>
            </>
          )}
          {model.efficiency && (
            <>
              <line x1={x(model.efficiency.from.date)} y1={y(model.efficiency.from.value)} x2={x(model.efficiency.to.date)} y2={y(model.efficiency.to.value)} className="stroke-ui-purple" strokeWidth={2.5} strokeDasharray={DASH.efficiency} />
              <text x={X1 + 4} y={labelY.efficiency ?? undefined} className="fill-foreground text-[8px] tabular-nums" aria-hidden="true">{fmt(model.efficiency.endFigure)}</text>
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
        {model.evSegments && (
          <span className="inline-flex items-center gap-1.5">
            <Swatch className="stroke-[var(--rag-amber)]" dash={DASH.evLine} width={2} />{t(lang, "burndownEvHistory")}
            <TermTooltip lang={lang} term={t(lang, "burndownEvHistory")} tip={t(lang, "burndownTipEvHistory")} />
          </span>
        )}
        {hasPartial && (
          <span className="inline-flex items-center gap-1.5"><Swatch className="stroke-[var(--rag-amber)]" dash={DASH.evPartial} width={2} />{t(lang, "burndownEvPartial")}</span>
        )}
        {model.ev && <span className="inline-flex items-center gap-1.5"><svg width="10" height="10" aria-hidden="true"><path d="M 5 0 l 5 5 l -5 5 l -5 -5 z" className="fill-[var(--rag-amber)]" /></svg>{t(lang, "burndownEv")}</span>}
        {model.runOut && <span className="inline-flex items-center gap-1.5"><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" className="fill-ui-pink" /></svg>{t(lang, "forecastRunOut")}</span>}
        {model.today && <span className="inline-flex items-center gap-1.5"><Swatch className="stroke-muted-foreground" dash={DASH.today} width={1} />{t(lang, "burndownToday")}</span>}
      </div>
      {model.frameDiffers && <p className="text-xs text-muted-foreground">{t(lang, "burndownFrameNote")}</p>}
      {partialCaptions.map((caption) => <p key={caption} className="text-xs text-muted-foreground">{caption}</p>)}
      {model.evUnavailable && (
        <p className="text-xs text-muted-foreground">{t(lang, "burndownEvHistoryUnavailable", model.evUnavailable.join(", "))}</p>
      )}
    </div>
  );
}
