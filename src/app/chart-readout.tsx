"use client";

// The readout box (spec A): one row per drawn series at the active stop, each
// with its colour swatch, value and a one-line explanation. It renders inside
// the shared `TooltipSurface`, so the app keeps ONE tooltip look. Formatting
// arrives as `fmt` from the chart, which owns the unit (€ or hours).
import { type Lang, t, type TranslationKey } from "./i18n";
import { formatDayMonthYear, signedFigure } from "./forecast-format";
import { TooltipSurface } from "./tooltip-surface";
import type { Readout, ReadoutKind, ReadoutRow } from "./burndown-readout";
import type { ReadoutAnchor } from "./use-chart-readout";

/** Label, explanation and swatch per row kind. The swatch classes mirror each
 *  series' DEFAULT colour in `burndown-chart.tsx`; the dash patterns are not
 *  repeated, since the row's own words carry the meaning. ★ This is NOT a
 *  full mirror: the chart recolours the actual line `stroke-ui-pink` when
 *  `model.over`, but `ReadoutRow` carries no over/under flag, so the `actual`
 *  swatch here is always `bg-ui-green`. Deliberate — the row's LABEL, not its
 *  colour, carries that meaning, and threading the flag through Task 1's
 *  `ReadoutRow` for a swatch tint alone was not judged worth the coupling. */
const ROW: Record<ReadoutKind, { label: TranslationKey; tip: TranslationKey; swatch: string }> = {
  plan: { label: "burndownPlanned", tip: "burndownReadoutTipPlan", swatch: "bg-muted-foreground" },
  budget: { label: "burndownReadoutBudget", tip: "burndownReadoutTipBudget", swatch: "bg-muted-foreground" },
  baseline: { label: "burndownBacBaseline", tip: "burndownReadoutTipBaseline", swatch: "bg-muted-foreground" },
  actual: { label: "burndownActual", tip: "burndownReadoutTipActual", swatch: "bg-ui-green" },
  ev: { label: "burndownEvHistory", tip: "burndownReadoutTipEv", swatch: "bg-[var(--rag-amber)]" },
  // The diamond's own legend wording is `burndownEv`, NOT `burndownEvHistory` — the two are
  // different series and both can appear at one stop in the cumulative orientation.
  evPoint: { label: "burndownEv", tip: "burndownReadoutTipEvPoint", swatch: "bg-[var(--rag-amber)]" },
  pace: { label: "forecastPaceTitle", tip: "burndownReadoutTipPace", swatch: "bg-ui-dark-blue" },
  efficiency: { label: "forecastEfficiencyTitle", tip: "burndownReadoutTipEfficiency", swatch: "bg-ui-purple" },
  change: { label: "burndownReadoutChange", tip: "burndownReadoutTipChange", swatch: "bg-muted-foreground" },
  runOut: { label: "forecastRunOut", tip: "burndownReadoutTipRunOut", swatch: "bg-ui-pink" },
};

/** A partial earned-value point names the partial line, not the solid one. */
function labelKey(row: ReadoutRow): TranslationKey {
  return row.kind === "ev" && row.partial ? "burndownEvPartial" : ROW[row.kind].label;
}

/** A change row reads "+€3,000 Vendor" / "−€800 Ops removed"; every other row
 *  reads its plain formatted value. */
function valueText(lang: Lang, row: ReadoutRow, fmt: (v: number) => string): string {
  if (row.kind !== "change") return fmt(row.value);
  const amount = signedFigure(fmt(row.value), row.value);
  return row.removed
    ? t(lang, "burndownBacMarkerRemoved", amount, row.label ?? "")
    : `${amount} ${row.label ?? ""}`;
}

/** The forecast/partial flags are WORDS, not shades — the live region is the
 *  accessible channel, so it must carry everything the visual `(forecast)`
 *  marker conveys. Appended after the value (not the parens the visual marker
 *  uses, which read as stray punctuation spoken aloud), mirroring the marker's
 *  own position after the value in the box. The row's explanation goes last,
 *  as it sits last in the box's row: it is the readout's stated purpose, and
 *  the live region is the only channel a screen-reader user gets it from. */
function rowText(lang: Lang, row: ReadoutRow, fmt: (v: number) => string): string {
  const base = t(lang, "burndownReadoutSentence", t(lang, labelKey(row)), valueText(lang, row, fmt));
  const flagged = row.forecast ? `${base}, ${t(lang, "burndownReadoutForecast")}` : base;
  return `${flagged}, ${t(lang, ROW[row.kind].tip)}`;
}

/** The live region's text: the date, then every row, semicolon separated. */
export function readoutSentence(
  lang: Lang, readout: Readout, fmt: (v: number) => string, locale: string,
): string {
  if (readout.rows.length === 0) return "";
  const head = readout.today
    ? `${formatDayMonthYear(readout.date, locale)} (${t(lang, "burndownReadoutTodayFlag")})`
    : formatDayMonthYear(readout.date, locale);
  return [head, ...readout.rows.map((row) => rowText(lang, row, fmt))].join("; ");
}

export function ChartReadout({
  lang, readout, anchor, fmt, locale,
}: {
  lang: Lang; readout: Readout; anchor: ReadoutAnchor;
  fmt: (value: number) => string; locale: string;
}) {
  if (readout.rows.length === 0) return null;
  return (
    <TooltipSurface decorative top={anchor.top} left={anchor.left} className="max-w-[22rem] print:hidden">
      {/* `TooltipSurface`'s `decorative` prop takes the WHOLE node out of the
          accessibility tree (aria-hidden, no role) — the polite live region in
          `burndown-chart.tsx` is the sole accessible channel, so this box must
          not be announced twice, and an ARIA `role="tooltip"` node with no
          accessible name is itself an axe-serious violation
          (`aria-tooltip-name`), which is what a root-only `aria-hidden` used to
          leave behind. The inner span below keeps its `block` layout class but
          no longer needs its own `aria-hidden` — the root already covers it.
          `data-readout-box` identifies THIS box: `data-tooltip-portal` is set
          by every `TooltipSurface`, so it only proves that SOME tooltip is up. */}
      <span data-readout-box="" className="block">
        <span className="block font-semibold tabular-nums">
          {formatDayMonthYear(readout.date, locale)}
          {readout.today && <span className="ml-1 font-normal text-muted-foreground">{t(lang, "burndownReadoutTodayFlag")}</span>}
        </span>
        <span role="list" className="mt-1 block space-y-1">
          {readout.rows.map((row) => (
            <span role="listitem" key={row.kind} className="block">
              <span className="flex items-center gap-1.5">
                <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${ROW[row.kind].swatch}`} />
                <span className="font-medium">{t(lang, labelKey(row))}</span>
                <span className="ml-auto pl-2 tabular-nums">{valueText(lang, row, fmt)}</span>
                {row.forecast && <span className="text-muted-foreground">({t(lang, "burndownReadoutForecast")})</span>}
              </span>
              <span className="block pl-3.5 text-muted-foreground">{t(lang, ROW[row.kind].tip)}</span>
            </span>
          ))}
        </span>
      </span>
    </TooltipSurface>
  );
}
