# Burn-down chart hover readout — design

**Status:** approved 2026-09-17. Spec A of three brainstormed together; B is
`2026-09-17-forecast-switch-and-budget-report-row-design.md`, C is
`2026-09-17-dashboard-layout-rework-design.md`. A ships first: B re-lays the same chart out and
C changes the tile that hosts it, so both build on the component A touches.

## Goal

The budget chart (both the burn-down and the cumulative orientation) tells the reader what every
line is worth at the position under the pointer, and says in one line what each line means. Today
the chart is a static SVG: values can only be estimated by eye against the axis, and the
explanations live in the legend's ⓘ tooltips, away from the numbers.

## Today (verified 2026-09-17)

- `burndown-chart.tsx` renders one `<svg role="img" aria-label={…}>` with no pointer handlers, no
  per-point `<title>` and no crosshair. Everything a non-visual reader gets is in that one long
  label (assembled in the same file) plus the text legend below the SVG.
- `burndown-geometry.ts` owns the pure geometry: `ChartModel`, `ChartPoint = {date, value}`,
  `scaleDate`, `scaleValue`, `buildChartModel`, and the marker-label layout helpers.
- `burndown-chart-panel.tsx` owns the two `SegmentedControl`s (orientation, unit). Both write
  device settings, so the report and the dashboard tile stay in step.
- `budget-forecast-tooltip.tsx` exports `TermTooltip` over `info-tooltip.tsx`'s `InfoTooltip`.
  `InfoTooltip` anchors its bubble to its own trigger element with a portal and a clamped
  `getBoundingClientRect` position; it cannot be pointed at an arbitrary coordinate.
- There is no floating-UI library in the dependency set, and the app hand-rolls its popovers over
  `popover-panel.tsx` / `use-popover-dismiss.ts`.

## Decisions

1. **The readout snaps to dates that carry data**, never to an arbitrary day. The stop set is the
   union of: every point of every drawn series, `model.today`, `model.planEnd`, each
   `model.bacMarkers` date, and `model.runOut` when present. Rationale: the actual and
   earned-value series hold one point per plan period, so a value between two points would be
   invented. The two forecast segments are straight lines, so their value at a stop is read along
   the segment (linear in calendar days between `from` and `to`), which is what the chart draws.
2. **One box lists every series present at that stop**, in the legend's order, each row carrying
   the series' colour swatch, its value in the current unit, and a one-line explanation reusing the
   wording the existing term tooltips already use.
3. **Keyboard and touch reach the same readout.** The chart gets a tab stop; `ArrowLeft`/
   `ArrowRight` step one stop, `Home`/`End` jump to the first/last, `Escape` and blur hide it. Tap
   shows it, tap outside hides it.
4. **Both surfaces get it** — the Budget report chart and the compact dashboard tile, since both
   mount the same component. The box is clamped inside the chart's own box.
5. **Print hides the readout.**
6. **One new display surface only.** `InfoTooltip`'s bubble styling is extracted into a shared
   `TooltipSurface` used by both the ⓘ tooltips and the readout, so the app does not gain a second
   hand-rolled tooltip look. No new interactive control primitive is introduced: the chart wrapper
   is the only focusable element added, and it carries no role that promises more than it does.

## Rows

A row renders only when that series exists at the stop. Order, top to bottom:

| Row | Source on `ChartModel` | Shown when |
|---|---|---|
| Plan | `planned` | a point exists at the stop |
| Budget | `bacSteps` (stepped) else `bacLine` | value resolvable at the stop |
| Budget at start of recording | `bacBaseline` | `bacSteps !== null` |
| Actual | `actual` | a point exists at the stop |
| Earned value | `evSegments` | a point exists at the stop; flagged `partial` when the point's segment is partial |
| At current pace | `pace` | stop is within `[pace.from.date, pace.to.date]`; flagged as a forecast |
| At current efficiency | `efficiency` | same rule against its own segment; flagged as a forecast |
| Budget change | `bacMarkers` entry on that date | a marker sits on the stop |
| Runs out | `runOut` | `runOut.date === stop` |

`bacMarkers` already sums every recorded change inside one period and joins the bucket names, so
the change row is one row per period, carrying that summed signed amount and those names. The
readout does not re-derive per-entry detail — the change table owns that.

The today stop additionally marks itself as today, so the reader can tell the actual/EV rows apart
from forecast rows at the boundary.

## Components

| File | Responsibility |
|---|---|
| `burndown-readout.ts` (new, pure, i18n-free) | `readoutStops(model): readonly string[]` — sorted, de-duplicated stop dates. `readoutAt(model, date): ReadoutRow[]` — the rows above, each `{kind, value, partial?, forecast?, label?, amount?}`. No formatting, no translation. |
| `use-chart-readout.ts` (new) | Owns the active stop index and the open flag; converts a pointer x within the plot rect to the nearest stop using the existing `scaleDate`; owns the key handling and the tap/outside-tap behaviour. Returns the stop, the rows' anchor coordinates and the handlers to spread. |
| `tooltip-surface.tsx` (new) | The bubble: portal, clamped position, palette-token styling — lifted verbatim from `InfoTooltip`, which then consumes it. No visual change to existing tooltips. |
| `chart-readout.tsx` (new) | Turns `ReadoutRow[]` into translated text inside `TooltipSurface`; owns the swatch per row kind and the polite announcement text. |
| `burndown-chart.tsx` (modify) | Adds the focusable wrapper, the vertical guide line, the per-series dots at the active stop, and mounts `ChartReadout`. The existing `aria-label` description stays as it is. |
| `i18n.ts` / `i18n.de.ts` | Row labels, "forecast", "partial", "today", the change sentence and the per-row explanation lines. DE edited only via a Node UTF-8 write against `\r\n` anchors. |

## Accessibility

- The wrapper is the single tab stop; the SVG keeps `role="img"` with its full description, so a
  screen-reader user who never presses an arrow key loses nothing.
- Stepping announces the stop's rows through a polite live region rendered as a DOM sibling of the
  chart, never nested inside an interactive element.
- The guide line, dots and box are `aria-hidden`; the announcement is the accessible channel.
- The wrapper's accessible name says what the arrows do, and the visible chart caption is not
  changed.
- Colour never carries a row's meaning on its own: every row has its label text, and the forecast
  and partial flags are words, not shades.

## Testing

- `burndown-readout.test.ts`: stop-set union incl. markers/today/run-out; a row appears only where
  its series exists; forecast interpolation inside a segment and absence outside it; partial EV
  flagged; a marker whose summed amount shows as zero yields no change row; hours vs euro unit.
- `use-chart-readout.test.ts`: pointer x → nearest stop at the plot edges; arrow/Home/End stepping
  clamps; Escape closes; blur closes.
- `chart-readout.test.tsx`: row order, the explanation line per row, the announcement text.
- `info-tooltip.test.tsx` stays green unchanged — the `TooltipSurface` extraction is behaviour
  preserving, and that is the assertion.
- e2e: hover the Reports cumulative chart, assert the box names a date and at least the actual row;
  keyboard-step it with the keyboard only.
- One axe scan of Reports with the readout open.
- Visual baselines must NOT change: the readout is hidden until hovered or focused. A changed
  baseline means the idle chart moved, which is a defect in the change.

## Out of scope

- Any change to what the chart draws, to the forecast maths, or to the change table.
- Dragging, zooming or brushing the chart.
- Per-entry budget-change detail in the readout.
