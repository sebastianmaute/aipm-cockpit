"use client";

// One burn-down chart (MR 3 addendum §5): pure presentation over a ChartModel.
// Dash patterns and the legend carry each series' meaning, not colour alone.
// End labels are foreground text (small `ui-purple` text fails AA on dark
// schemes); the line swatch in the legend carries the colour.
import { useId, useMemo } from "react";
import { type Lang, t, localeFor } from "./i18n";
import { currencySymbol, formatCurrency } from "./resource-cost";
import { formatDayMonthYear, formatHours, signedFigure } from "./forecast-format";
import { TermTooltip } from "./budget-forecast-tooltip";
import { InfoTooltip } from "./info-tooltip";
import {
  estimatedLabelWidth, fitJoinLabel, layoutMarkerLabels, markerBandHeight, markerLabelBoxes, scaleDate, scaleValue,
  type BacMarker, type ChartModel, type ChartOrientation, type ChartPoint, type ChartUnit,
} from "./burndown-geometry";
import { labelBox, placeLabels, polylineSegments, type Box, type LabelRequest, type Segment } from "./chart-label-placement";
import { ChartReadout, readoutSentence } from "./chart-readout";
import { readoutAt, readoutStops } from "./burndown-readout";
import { useChartReadout } from "./use-chart-readout";

// `H` and `PAD_T` are the chart's height and top margin when the budget-change
// labels fit the default margin. More label rows grow the top margin
// (`markerBandHeight`) and the height with it, so the plot never shrinks.
const W = 640, H = 240, PAD_L = 64, PAD_R = 80, PAD_T = 16, PAD_B = 28;
const X0 = PAD_L, X1 = W - PAD_R;

const DASH = { planned: "5 4", pace: "7 4", efficiency: "2 3", evLine: "6 2 1 2", evPartial: "2 4", bac: "4 4", today: "3 3", simP80: "6 3" } as const;

/** §502 — the simulated ranges wear the sim teal (the Forecast range bar's fill), the finish band faint enough that
 *  every line reads clearly over it, the cost wedge a little stronger. */
const SIM_FILL = "fill-ui-green-strong dark:fill-ui-green";
const SIM_STROKE = "stroke-ui-green-strong dark:stroke-ui-green";
const SIM_FINISH_OPACITY = 0.12;
const SIM_COST_OPACITY = 0.25;

/** §737 — every label except the y-axis ticks carries a halo in the card's `surface` colour (`paint-order="stroke"`
 *  draws the stroke under the fill), so a line passing close by does not cut the letters. */
const HALO = { paintOrder: "stroke", strokeWidth: 3, strokeLinejoin: "round" } as const;
/** §737 — baseline offsets, from a label's usual spot, of the spots it moves to when a line or
 *  another label covers that spot: alternately up and down, further each time. */
const FAR_OFFSETS = [-12, 20, -24, 32, -36, 44] as const;

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
function endLabelYs(
  paceY: number | null, efficiencyY: number | null, yTop: number, yBottom: number,
): { pace: number | null; efficiency: number | null } {
  if (paceY === null || efficiencyY === null || Math.abs(paceY - efficiencyY) >= END_LABEL_GAP) {
    return { pace: paceY, efficiency: efficiencyY };
  }
  const mid = (paceY + efficiencyY) / 2;
  const top = mid - END_LABEL_GAP / 2;
  const bottom = mid + END_LABEL_GAP / 2;
  const shift = bottom > yBottom ? yBottom - bottom : top < yTop + END_LABEL_GAP ? yTop + END_LABEL_GAP - top : 0;
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

export function BurndownChart(props: {
  lang: Lang; currency: string; model: ChartModel; unit: ChartUnit; orientation: ChartOrientation; periods: readonly string[];
  /** The dashboard tile: the notes under the legend move behind one info trigger beside the caption
   *  (they still print). The Budget view leaves this off and shows them as lines. */
  notesAsInfo?: boolean;
}) {
  if (props.model.empty) return <p className="text-sm text-muted-foreground">{t(props.lang, "dashboardNoBudget")}</p>;
  return <BurndownChartBody {...props} />;
}

function BurndownChartBody({
  lang, currency, model, unit, orientation, periods, notesAsInfo = false,
}: {
  lang: Lang; currency: string; model: ChartModel; unit: ChartUnit; orientation: ChartOrientation; periods: readonly string[];
  notesAsInfo?: boolean;
}) {
  // The SVG's own `aria-label` (below) is the chart's whole non-visual summary;
  // `aria-describedby` folds it into the trigger button's accessible DESCRIPTION
  // (the button's own `aria-label` already claims its NAME, which is not folded
  // in by the accessible-name computation) with no second copy of the string.
  // A stable per-render literal would collide — this component renders twice on
  // one page (Budget report + dashboard tile) — so the id comes from `useId`.
  const svgDescId = useId();
  const locale = localeFor(lang);
  const fmt = (v: number) => (unit === "eur" ? formatCurrency(v, currency, locale) : formatHours(v, locale));
  // The hours key carries its own " h", so the join amount is the bare number.
  // The keys carry no sign: `signedFigure` adds the "+" and the formatter the "-".
  const joinKey = (count: number) => (unit === "eur"
    ? (count > 1 ? "burndownEvJoinsEurPlural" : "burndownEvJoinsEur")
    : (count > 1 ? "burndownEvJoinsHoursPlural" : "burndownEvJoinsHours"));
  const joinAmount = (v: number) =>
    signedFigure(unit === "eur" ? fmt(v) : new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(v), v);
  const x = (date: string) => scaleDate(date, model.xDomain, X0, X1);
  // §665 — the room a join label may use: the plot, minus the baseline label at its left end when that is drawn.
  const joinBounds = { left: model.bacSteps && model.bacBaseline !== null ? X0 + 4 + estimatedLabelWidth(t(lang, "burndownBacBaseline")) + 4 : X0, right: X1 };
  const down = orientation === "burndown";
  const caption = t(lang, down
    ? (unit === "eur" ? "burndownBudgetRemaining" : "burndownHoursRemaining")
    : (unit === "eur" ? "burndownValueCumulative" : "burndownHoursCumulative"));
  const aria = [t(lang, "burndownAria", caption, unit === "eur" ? t(lang, "burndownUnitEur", currencySymbol(currency, locale)) : t(lang, "burndownUnitHours"))];
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
  // §502 — the bands are drawn shapes only, so the simulated P80 figures reach a screen reader here.
  if (model.simFinish) {
    const finish = model.simFinish.p80Beyond ? t(lang, "simHistogramBeyond") : formatDayMonthYear(model.simFinish.p80, locale);
    // The hours unit says "hours at finish": "cost" beside an "h" figure misreads.
    const simKey = unit === "eur" ? "burndownAriaSim" : "burndownAriaSimHours";
    aria.push(model.simCost ? t(lang, simKey, finish, fmt(model.simCost.p80)) : t(lang, "burndownAriaSimFinish", finish));
    // The band edge sits on P80 when P95 is past the horizon, so say so rather than let it read as P95 = P80.
    if (model.simFinish.p95Beyond && !model.simFinish.p80Beyond) aria.push(t(lang, "burndownAriaSimP95Beyond"));
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
  // Marker labels sit in rows in a band above the plot (`layoutMarkerLabels`),
  // so close ticks cannot print on top of each other. The plot moves down by
  // however much of that band the default top margin cannot hold.
  const markerLayout = layoutMarkerLabels(
    model.bacSteps ? model.bacMarkers.map((marker) => ({ x: x(marker.date), text: markerLabel(marker) })) : [],
    (X0 + X1) / 2,
  );
  const yTop = Math.max(PAD_T, markerBandHeight(markerLayout.rows));
  const grow = yTop - PAD_T;
  const height = H + grow;
  const yBottom = H - PAD_B + grow;
  const markerLabels = markerLabelBoxes(markerLayout, yTop);
  const y = (value: number) => scaleValue(value, model.yDomain, yBottom, yTop);
  const pts = (list: readonly ChartPoint[]) => list.map((p) => `${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
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
  // The notes under the legend, in the order they always had. Two have no full stop of their own.
  const sentence = (note: string) => (/[.!?…]$/.test(note) ? note : `${note}.`);
  const notes = [
    ...(model.frameDiffers ? [t(lang, "burndownFrameNote")] : []),
    ...partialCaptions,
    ...(model.evUnavailable ? [t(lang, "burndownEvHistoryUnavailable", model.evUnavailable.join(", "))] : []),
  ];
  const hasPartial = model.evSegments?.some((seg) => seg.partial) ?? false;
  // The solid "Earned value" entry names only a line that is drawn: an empty
  // list, or one whose every segment is partial, draws no solid span.
  const hasSolid = model.evSegments?.some((seg) => !seg.partial) ?? false;
  // The stepped BAC line's final level, which its text label names. `bacFields`
  // seeds `steps` with the baseline point before reading any entry and returns
  // NO_BAC when there are none, so a non-null `bacSteps` is never empty — the
  // null here is the no-history case, not an empty-array one.
  const bacStepEnd = model.bacSteps ? model.bacSteps[model.bacSteps.length - 1].value : null;
  const yTicks = [...new Set([model.yDomain[0], 0, model.total / 2, model.total])].filter((v) => v >= model.yDomain[0]);
  const belowZero = model.yDomain[0] < 0;
  const zeroY = y(0);
  const actualClass = model.over ? "stroke-ui-pink" : "stroke-ui-green";
  const labelY = endLabelYs(
    model.pace ? y(model.pace.to.value) + END_LABEL_OFFSET : null,
    model.efficiency ? y(model.efficiency.to.value) + END_LABEL_OFFSET : null,
    yTop, yBottom,
  );
  // §502 — with the simulation on, the x domain runs on past plan end to the simulated finish dates, so X1 is
  // no longer where the pace and efficiency segments end or where the plan's last period ends. Their labels
  // follow what they mark instead of the right edge. Off, both stay exactly where they always were.
  const endFigureX = model.simFinish ? x(model.planEnd) + 4 : X1 + 4;
  const lastPeriodX = model.simFinish ? x(model.planned.at(-1)?.date ?? model.planEnd) : X1;
  const endFigureBoxes: Box[] = model.simFinish
    ? ([[model.pace, labelY.pace], [model.efficiency, labelY.efficiency]] as const).flatMap(([seg, baseline]) =>
      (seg && baseline !== null ? [labelBox({ x: endFigureX, baseline }, estimatedLabelWidth(fmt(seg.endFigure)), "start")] : []))
    : [];
  // §737 — the labels inside the plot, placed clear of every plotted line, of the marks and of
  // each other (`placeLabels`). A point label that has to move keeps a leader to its point; a
  // label that runs along a line only swaps sides of it.
  const at = (p: ChartPoint) => ({ x: x(p.date), y: y(p.value) });
  const across = (v: number): Segment => ({ x1: X0, y1: y(v), x2: X1, y2: y(v) });
  const upright = (date: string): Segment => ({ x1: x(date), y1: yTop, x2: x(date), y2: yBottom });
  const segments: Segment[] = [
    ...polylineSegments(model.planned.map(at)),
    ...(model.actual.length > 1 ? polylineSegments(model.actual.map(at)) : []),
    ...(model.evSegments ?? []).flatMap((seg) => polylineSegments(seg.points.map(at))),
    ...[model.pace, model.efficiency].flatMap((f) => (f ? [{ x1: x(f.from.date), y1: y(f.from.value), x2: x(f.to.date), y2: y(f.to.value) }] : [])),
    ...(model.bacSteps
      ? [...polylineSegments(model.bacSteps.map(at)), ...(model.bacBaseline !== null ? [across(model.bacBaseline)] : [])]
      : model.bacLine !== null ? [across(model.bacLine)] : []),
    // Each budget-change tick, and the leader from its label in the band down to it.
    ...(model.bacSteps ? model.bacMarkers.map((marker, i) => ({ x1: x(marker.date), y1: markerLabels[i].baseline + 2, x2: x(marker.date), y2: y(marker.value) + 4 })) : []),
    ...(model.today ? [upright(model.today)] : []),
    ...(model.simFinish ? [upright(model.simFinish.p80)] : []),
    // The plan-end line counts only when it is inside the plot. At X1 (the usual case with the simulation
    // off) it is the plot's right edge, which every right-anchored label touches; a series running past
    // plan end, or the simulated finish dates (§502), move it inside.
    ...(x(model.planEnd) < X1 - 0.5 ? [upright(model.planEnd)] : []),
    ...(belowZero ? [across(0)] : []),
  ];
  const marks: Box[] = [
    ...(model.ev ? [{ left: x(model.ev.date) - 5, top: y(model.ev.value) - 5, right: x(model.ev.date) + 5, bottom: y(model.ev.value) + 5 }] : []),
    ...(model.runOut ? [{ left: x(model.runOut.date) - 4, top: y(model.runOut.value) - 4, right: x(model.runOut.date) + 4, bottom: y(model.runOut.value) + 4 }] : []),
    ...markerLabels,
    // Inside the plot only with the simulation on; off, the end figures sit in the right margin.
    ...endFigureBoxes,
    // The "Over" label in the below-zero band keeps its fixed spot.
    ...(belowZero ? [labelBox({ x: X0 + 4, baseline: yBottom - 4 }, estimatedLabelWidth(t(lang, "burndownOver")), "start")] : []),
  ];
  type PlotLabel = { key: string; text: string; request: LabelRequest; data?: string; strong?: boolean; title?: string };
  const pointLabel = (key: string, text: string, point: { x: number; y: number }, spot: { x: number; baseline: number }, anchor: "start" | "end"): PlotLabel =>
    ({ key, text, request: { width: estimatedLabelWidth(text), anchor, near: [spot], far: FAR_OFFSETS.map((d) => ({ x: spot.x, baseline: spot.baseline + d })), point } });
  // Below the line first (+9) or above it first (−4); either way the label stays beside its line.
  const lineLabel = (key: string, text: string, lx: number, lineY: number, anchor: "start" | "end", belowFirst: boolean): PlotLabel => {
    const below = { x: lx, baseline: lineY + 9 }, above = { x: lx, baseline: lineY - 4 };
    return { key, text, request: { width: estimatedLabelWidth(text), anchor, near: belowFirst ? [below, above] : [above, below], far: [], point: null } };
  };
  const plotLabels: PlotLabel[] = [];
  if (model.ev && down) {
    const ev = at(model.ev);
    plotLabels.push(pointLabel("work-left", t(lang, "burndownWorkLeft", fmt(model.ev.value)), ev, { x: ev.x - 7, baseline: ev.y - 7 }, "end"));
  }
  for (const j of model.evJoins) {
    // §665 — kept inside the plot and clear of the baseline label, which sits at the plot's left edge.
    const fitted = fitJoinLabel((name) => t(lang, joinKey(j.count), name, joinAmount(j.amount)), j.label, x(j.date), (X0 + X1) / 2, joinBounds);
    const point = { x: x(j.date), y: y(j.value) };
    plotLabels.push({
      ...pointLabel(`join-${j.date}`, fitted.text, point, { x: point.x, baseline: point.y - 6 }, fitted.anchor),
      data: "data-ev-join-label", strong: true,
      title: fitted.truncated ? t(lang, joinKey(j.count), j.label, joinAmount(j.amount)) : undefined,
    });
  }
  // The stepped line's two labels sit BELOW their line first: the marker ticks sit ON the stepped
  // line (see the comment at the steps below). The flat line's label sits above it first.
  if (model.bacSteps) {
    if (model.bacBaseline !== null) plotLabels.push(lineLabel("bac-baseline", t(lang, "burndownBacBaseline"), X0 + 4, y(model.bacBaseline), "start", true));
    if (bacStepEnd !== null) plotLabels.push(lineLabel("bac-end", t(lang, "burndownBac", fmt(bacStepEnd)), X1, y(bacStepEnd), "end", true));
  } else if (model.bacLine !== null) {
    plotLabels.push(lineLabel("bac", t(lang, "burndownBac", fmt(model.bacLine)), X0 + 4, y(model.bacLine), "start", false));
  }
  // The plot, plus the top margin the flat BAC label has always used (the marker band is `marks`),
  // plus the 1px box margin of a label anchored at the plot's right edge.
  const placed = placeLabels(plotLabels.map((l) => l.request), segments, { left: X0, top: 0, right: X1 + 1, bottom: yBottom }, marks);
  // `readoutStops` walks the whole model, so memoize it on the model's own identity.
  const stops = useMemo(() => readoutStops(model), [model]);
  const readout = useChartReadout({ stops, xDomain: model.xDomain, x0: X0, x1: X1, viewBoxWidth: W });
  const active = readout.stop === null ? null : readoutAt(model, readout.stop);
  const activeX = readout.stop === null ? null : x(readout.stop);
  const announce = active ? readoutSentence(lang, active, fmt, locale) : "";

  return (
    <div className="space-y-2">
      <div>
        <div className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
          {caption}
          {/* The notes are on screen only in the bubble, so the trigger's name carries them too. */}
          {notesAsInfo && notes.length > 0 && (
            <span className="print:hidden">
              <InfoTooltip text={notes.map(sentence).join(" ")} label={`${t(lang, "burndownNotesLabel")}: ${notes.map(sentence).join(" ")}`} />
            </span>
          )}
        </div>
        <button
          type="button"
          {...readout.triggerProps}
          aria-label={t(lang, "burndownReadoutTrigger")}
          aria-describedby={svgDescId}
          className="block w-full cursor-crosshair rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-green print:cursor-auto"
        >
          <svg id={svgDescId} viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={aria.join(" ")}>
          {belowZero && <rect x={X0} y={zeroY} width={X1 - X0} height={yBottom - zeroY} className="fill-ui-pink/10" />}
          {/* §502 — the simulated finish band (P50–P95) and cost wedge sit behind every line. */}
          {model.simFinish && (
            <rect
              data-sim-finish="" x={x(model.simFinish.from)} y={yTop} width={Math.max(1, x(model.simFinish.to) - x(model.simFinish.from))}
              height={yBottom - yTop} fillOpacity={SIM_FINISH_OPACITY} className={SIM_FILL}
            />
          )}
          {model.simCost && (
            <polygon
              data-sim-cost=""
              points={[at(model.simCost.from), { x: x(model.simCost.at), y: y(model.simCost.low) }, { x: x(model.simCost.at), y: y(model.simCost.high) }]
                .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
              fillOpacity={SIM_COST_OPACITY} className={SIM_FILL}
            />
          )}
          <line x1={X0} y1={yTop} x2={X0} y2={yBottom} className="stroke-line" strokeWidth={1} />
          <line x1={X0} y1={zeroY} x2={X1} y2={zeroY} className="stroke-line" strokeWidth={1} />
          {yTicks.map((v) => (
            <text key={v} data-axis="y" x={X0 - 4} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground text-[8px] tabular-nums" aria-hidden="true">{fmt(v)}</text>
          ))}
          {/* Recorded budget changes replace the flat BAC line with a stepped
              one plus a dashed reference at the baseline. The two share
              `DASH.bac` and `stroke-muted-foreground` and differ only by stroke
              width, so each carries its own text label and neither relies on
              weight alone: `burndownBacBaseline` at the left end of the
              reference, `burndownBac` (with the stepped line's FINAL level, the
              last recorded entry's own BAC) at the right end of the steps.
              Both labels sit BELOW their line by default: the marker ticks sit
              ON the stepped line, and whenever the last period's group yields a
              marker, its tick is at this final level, so an above-placed label
              would crowd it. §737: they go above only when a plotted line covers
              the spot below, and the ticks count as lines there. The labels are
              drawn in the label layer at the end. The marker labels themselves
              sit in the band above the plot (`layoutMarkerLabels`). */}
          {model.bacSteps ? (
            <>
              {model.bacBaseline !== null && (
                <>
                  <line data-bac-baseline="" x1={X0} y1={y(model.bacBaseline)} x2={X1} y2={y(model.bacBaseline)} className="stroke-muted-foreground" strokeWidth={1} strokeDasharray={DASH.bac} />
                </>
              )}
              <polyline data-bac-steps="" points={pts(model.bacSteps)} fill="none" className="stroke-muted-foreground" strokeWidth={1.5} strokeDasharray={DASH.bac} />
              {/* Ticks and leaders first, then every label, so a leader that runs
                  down through a lower row passes BEHIND that row's label. Each
                  label carries a halo in the card's own `surface` colour
                  (`paint-order="stroke"`: the stroke is drawn under the fill), so
                  the text reads cleanly over the leader line. */}
              {model.bacMarkers.map((marker, i) => (
                <g key={marker.date}>
                  <line x1={x(marker.date)} y1={y(marker.value) - 4} x2={x(marker.date)} y2={y(marker.value) + 4} className="stroke-muted-foreground" strokeWidth={1.5} />
                  {/* A faint leader ties the label in the band to its tick. */}
                  <line data-bac-leader="" x1={x(marker.date)} y1={markerLabels[i].baseline + 2} x2={x(marker.date)} y2={y(marker.value) - 4} className="stroke-line" strokeWidth={0.75} />
                </g>
              ))}
              {model.bacMarkers.map((marker, i) => {
                // Same order as the ticks `markerLayout` was built from.
                const label = markerLabels[i];
                return (
                  <text key={marker.date} data-bac-marker-label="" x={label.x} y={label.baseline} textAnchor={label.anchor} {...HALO} className="fill-foreground stroke-surface text-[8px] tabular-nums" aria-hidden="true">
                    {markerLabel(marker)}
                  </text>
                );
              })}
            </>
          ) : model.bacLine !== null && (
            <>
              <line data-bac-line="" x1={X0} y1={y(model.bacLine)} x2={X1} y2={y(model.bacLine)} className="stroke-muted-foreground" strokeWidth={1.5} strokeDasharray={DASH.bac} />
            </>
          )}
          <polyline points={pts(model.planned)} fill="none" className="stroke-muted-foreground" strokeWidth={2} strokeDasharray={DASH.planned} />
          {model.evSegments?.map((seg, i) => (
            <polyline key={i} points={pts(seg.points)} fill="none" className="stroke-[var(--rag-amber)]" strokeWidth={2} strokeDasharray={seg.partial ? DASH.evPartial : DASH.evLine} />
          ))}
          {model.actual.length > 1 && <polyline points={pts(model.actual)} fill="none" className={actualClass} strokeWidth={2.5} />}
          {model.pace && (
            <line x1={x(model.pace.from.date)} y1={y(model.pace.from.value)} x2={x(model.pace.to.date)} y2={y(model.pace.to.value)} className="stroke-ui-dark-blue" strokeWidth={2.5} strokeDasharray={DASH.pace} />
          )}
          {model.efficiency && (
            <line x1={x(model.efficiency.from.date)} y1={y(model.efficiency.from.value)} x2={x(model.efficiency.to.date)} y2={y(model.efficiency.to.value)} className="stroke-ui-purple" strokeWidth={2.5} strokeDasharray={DASH.efficiency} />
          )}
          {model.today && (
            <line x1={x(model.today)} y1={yTop} x2={x(model.today)} y2={yBottom} className="stroke-muted-foreground" strokeWidth={1} strokeDasharray={DASH.today} />
          )}
          <line x1={x(model.planEnd)} y1={yTop} x2={x(model.planEnd)} y2={yBottom} className="stroke-line" strokeWidth={1} />
          {model.simFinish && (
            <line data-sim-p80="" x1={x(model.simFinish.p80)} y1={yTop} x2={x(model.simFinish.p80)} y2={yBottom} className={SIM_STROKE} strokeWidth={2} strokeDasharray={DASH.simP80} />
          )}
          {/* §737 — a moved label's leader, under the marks, so the EV diamond covers its start. */}
          {placed.map((spot, i) => spot.leader && (
            <line key={plotLabels[i].key} data-label-leader="" x1={spot.leader.x1} y1={spot.leader.y1} x2={spot.leader.x2} y2={spot.leader.y2} className="stroke-line" strokeWidth={0.75} />
          ))}
          {model.ev && (
            <path d={`M ${x(model.ev.date)} ${y(model.ev.value) - 5} l 5 5 l -5 5 l -5 -5 z`} className="fill-[var(--rag-amber)]" />
          )}
          {model.runOut && <circle cx={x(model.runOut.date)} cy={y(model.runOut.value)} r={4} className="fill-ui-pink" />}
          {/* §737 — the placed labels, the end figures, "Over" and the period labels after every
              plotted line and mark, so each halo covers whatever runs near it. The budget-change
              labels in the band above the plot are drawn with their ticks, earlier. */}
          {plotLabels.map((label, i) => (
            <text
              key={label.key} {...(label.data ? { [label.data]: "" } : {})} x={placed[i].x} y={placed[i].baseline} textAnchor={label.request.anchor} {...HALO}
              className={`${label.strong ? "fill-foreground tabular-nums" : "fill-muted-foreground"} stroke-surface text-[8px]`} aria-hidden="true"
            >
              {label.title && <title>{label.title}</title>}
              {label.text}
            </text>
          ))}
          {model.pace && <text x={endFigureX} y={labelY.pace ?? undefined} {...HALO} className="fill-foreground stroke-surface text-[8px] tabular-nums" aria-hidden="true">{fmt(model.pace.endFigure)}</text>}
          {model.efficiency && <text x={endFigureX} y={labelY.efficiency ?? undefined} {...HALO} className="fill-foreground stroke-surface text-[8px] tabular-nums" aria-hidden="true">{fmt(model.efficiency.endFigure)}</text>}
          {belowZero && <text x={X0 + 4} y={yBottom - 4} {...HALO} className="fill-muted-foreground stroke-surface text-[8px]" aria-hidden="true">{t(lang, "burndownOver")}</text>}
          {periods.length > 0 && (
            <>
              <text x={X0} y={height - 8} textAnchor="start" {...HALO} className="fill-muted-foreground stroke-surface text-[8px] tabular-nums" aria-hidden="true">{periods[0]}</text>
              <text x={lastPeriodX} y={height - 8} textAnchor="end" {...HALO} className="fill-muted-foreground stroke-surface text-[8px] tabular-nums" aria-hidden="true">{periods[periods.length - 1]}</text>
            </>
          )}
          {activeX !== null && active && (
            <g aria-hidden="true" className="pointer-events-none print:hidden">
              <line data-readout-guide="" x1={activeX} y1={yTop} x2={activeX} y2={yBottom} className="stroke-foreground" strokeWidth={1} />
              {active.rows
                .filter((row) => row.kind !== "change")
                .map((row) => (
                  <circle data-readout-dot="" key={row.kind} cx={activeX} cy={y(row.value)} r={2.5} className="fill-foreground" />
                ))}
            </g>
          )}
          </svg>
        </button>
        {active && readout.anchor && (
          <ChartReadout lang={lang} readout={active} anchor={readout.anchor} fmt={fmt} locale={locale} />
        )}
        <span data-readout-live="" aria-live="polite" className="sr-only">{announce}</span>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><Swatch className="stroke-muted-foreground" dash={DASH.planned} width={2} />{t(lang, "burndownPlanned")}</span>
        {model.actual.length > 1 && <span className="inline-flex items-center gap-1.5"><Swatch className={actualClass} />{t(lang, "burndownActual")}</span>}
        {model.pace && <span className="inline-flex items-center gap-1.5"><Swatch className="stroke-ui-dark-blue" dash={DASH.pace} />{t(lang, "forecastPaceTitle")}</span>}
        {model.efficiency && <span className="inline-flex items-center gap-1.5"><Swatch className="stroke-ui-purple" dash={DASH.efficiency} />{t(lang, "forecastEfficiencyTitle")}</span>}
        {model.simFinish && (
          <span className="inline-flex items-center gap-1.5">
            <svg width="22" height="10" aria-hidden="true">
              <rect x="0" y="0" width="22" height="10" fillOpacity={SIM_FINISH_OPACITY} className={SIM_FILL} />
              <line x1="11" y1="0" x2="11" y2="10" className={SIM_STROKE} strokeWidth={2} strokeDasharray="3 2" />
            </svg>
            {t(lang, "burndownSimFinishRange")}
          </span>
        )}
        {model.simCost && (
          <span className="inline-flex items-center gap-1.5">
            <svg width="22" height="10" aria-hidden="true"><path d="M 0 5 L 22 0 L 22 10 z" fillOpacity={SIM_COST_OPACITY} className={SIM_FILL} /></svg>
            {t(lang, unit === "eur" ? "burndownSimCostRange" : "burndownSimHoursRange")}
          </span>
        )}
        {hasSolid && (
          <span className="inline-flex items-center gap-1.5">
            <Swatch className="stroke-[var(--rag-amber)]" dash={DASH.evLine} width={2} />{t(lang, "burndownEvHistory")}
            <TermTooltip lang={lang} term={t(lang, "burndownEvHistory")} tip={t(lang, "burndownTipEvHistory")} />
          </span>
        )}
        {hasPartial && (
          <span className="inline-flex items-center gap-1.5">
            <Swatch className="stroke-[var(--rag-amber)]" dash={DASH.evPartial} width={2} />{t(lang, "burndownEvPartial")}
            {/* With no solid entry, this is the only place the line's explanation can live. */}
            {!hasSolid && <TermTooltip lang={lang} term={t(lang, "burndownEvPartial")} tip={t(lang, "burndownTipEvHistory")} />}
          </span>
        )}
        {model.ev && <span className="inline-flex items-center gap-1.5"><svg width="10" height="10" aria-hidden="true"><path d="M 5 0 l 5 5 l -5 5 l -5 -5 z" className="fill-[var(--rag-amber)]" /></svg>{t(lang, "burndownEv")}</span>}
        {model.runOut && <span className="inline-flex items-center gap-1.5"><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" className="fill-ui-pink" /></svg>{t(lang, "forecastRunOut")}</span>}
        {model.today && <span className="inline-flex items-center gap-1.5"><Swatch className="stroke-muted-foreground" dash={DASH.today} width={1} />{t(lang, "burndownToday")}</span>}
      </div>
      {notes.length > 0 && (
        <div className={notesAsInfo ? "hidden space-y-2 print:block" : "space-y-2"}>
          {notes.map((note) => <p key={note} className="text-xs text-muted-foreground">{note}</p>)}
        </div>
      )}
    </div>
  );
}
