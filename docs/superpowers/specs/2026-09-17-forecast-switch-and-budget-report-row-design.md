# Forecast card switch, RAG badge and the Budget report forecast row — design

**Status:** approved 2026-09-17. Spec B of three brainstormed together; A is
`2026-09-17-burndown-chart-hover-readout-design.md` (ships first), C is
`2026-09-17-dashboard-layout-rework-design.md`.

## Goal

The two forecast readings — "At current pace" and "At current efficiency" — stop competing for
attention side by side. The reader picks one with a switch, sees its health at a glance as a RAG
badge, and reads it beside the chart it explains rather than a screen apart from it.

## Today (verified 2026-09-17)

- `budget-forecast-cards.tsx` `ForecastCards` renders `PaceCard` and `EfficiencyCard` in
  `grid gap-3 sm:grid-cols-2`, with `GapLine` below when both forecasts are available. Titles come
  from `forecastPaceTitle` / `forecastEfficiencyTitle`; each figure row carries a `TermTooltip`.
- `budget-forecast-section.tsx` `ForecastSection` stacks: `ForecastBanners`, the optional
  `RateMixDetails` disclosure (it owns the disclosure's open state and the focus nonce), then
  `ForecastCards`.
- `budget-report-panel.tsx` mounts `ForecastSection` inside a `<Section title="forecastTitle">`,
  and `BurndownChartPanel` inside a separate `<Section title="budgetBurndownTitle">` followed by a
  caption.
- `BurndownChartPanel` lays out `flex flex-col gap-3 2xl:flex-row`: chart `min-w-0 flex-1`, change
  table `min-w-0 2xl:w-[30rem] 2xl:shrink-0`. Measured on the 1.8.0 branch: the table needs 469px
  and the chart 640px, so side by side needs roughly a 1512px viewport — hence the `2xl` gate.
- `paceVacHealth(vac, bac)` (`budget-forecast.ts`) returns `"G"` when VAC ≥ 0, `"R"` when the
  overrun reaches `PACE_VAC_RED_RATIO` of BAC, else `"A"`, and `null` when BAC ≤ 0. The dashboard
  already uses it for its Budget badge.
- `rag-badge.tsx` `RagBadge` renders the lettered R/A/G dot with `role="img"`.
- The chart's orientation and unit are device settings, read through `useSettings()`.

## Decisions

1. **One card at a time, chosen by a `SegmentedControl`** above the card, with the options
   "At current pace" and "At current efficiency". No new control is hand-rolled. See
   `## Implementation notes` for why the switch sits above the card rather than in its header.
2. **The choice is a device setting**, `settings.budgetForecastView: "pace" | "efficiency"`,
   defaulting to `"pace"`, stored alongside the existing chart-view setting. Printing therefore
   shows the chosen card, and the report and any other consumer stay in step.
3. **The selected card carries a `RagBadge`** after its title, from `paceVacHealth(vac, bac)`
   applied to that card's own VAC. No badge when the rule yields `null` or the forecast is
   unavailable.
4. **An unavailable forecast still opens.** Choosing efficiency with no earned value shows the
   card's existing unavailable copy — the switch never dead-ends.
5. **The chart keeps both forecast lines.** The switch picks a card, not a series; the spec-A
   readout keeps listing both.
6. **The Budget report merges the two sections into one "Forecast" section**, in this order:
   banners → rate-mix note → a row with the card column (30%, gap line under the card) and the
   chart column (70%: chain warning, chart, caption) → the recorded-change table at full width
   below the row.
7. **The change table never sits beside the row.** At 70% of even a wide viewport the chart is
   already near its 640px floor, so `BurndownChartPanel`'s `2xl:flex-row` table placement is not
   reachable in this context and the table goes full width below.
8. **The row stacks below `xl` (1280px)** into card-then-chart in one column.
9. **The dashboard tile is untouched here.** Spec C reduces that tile to the chart alone.

## Layout

```
Forecast
  banners
  ▸ rate mix
  ┌ card 30% ───────────┐ ┌ chart 70% ─────────────────────┐
  │ [pace|efficiency]   │ │ [burn-down|cumulative] [€|h]   │
  │ At current pace (A) │ │ chart                          │
  │ EAC / VAC / ETC     │ │ caption                        │
  │ runs out · burn rate│ └────────────────────────────────┘
  │ gap line            │
  └─────────────────────┘
  recorded-change table (full width)
```

The 30/70 split is expressed with the app's existing width classes on an `xl:flex-row` row
(`xl:w-[30%]` / `min-w-0 flex-1`), not with a new grid system.

## Components

| File | Change |
|---|---|
| `budget-forecast-cards.tsx` | `ForecastCards` takes the selected view and its setter, renders the `SegmentedControl` plus exactly one of `PaceCard`/`EfficiencyCard`, and puts `RagBadge` in that card's title. `GapLine` stays below, unchanged in content. |
| `budget-forecast-section.tsx` | Reads/writes `settings.budgetForecastView`; takes the chart element as a prop (or a `chartSlot`) so the panel keeps owning the chart's data wiring while this file owns the row. Keeps the rate-mix disclosure state it already owns. |
| `budget-report-panel.tsx` | Drops the separate burn-down `<Section>`, passes `BurndownChartPanel` into the forecast section, keeps the caption under the chart. |
| `burndown-chart-panel.tsx` | Gains a prop that suppresses the side-by-side table placement (table always below), so the Budget report can ask for the stacked arrangement without changing the dashboard tile's behaviour. |
| `settings-types.ts` (+ defaults, sanitiser) | The new device setting, defaulted and validated like `budgetChartView`. |
| `i18n.ts` / `i18n.de.ts` | Switch group label and its two option labels; the badge's accessible text comes from the existing `RagBadge` wording. DE edited only via a Node UTF-8 write against `\r\n` anchors. |

## Accessibility

- The `SegmentedControl` provides the pressed state and the non-colour pressed marker; no
  hand-rolled `aria-pressed` button.
- The switch's group needs an accessible name saying what it switches ("Forecast reading"), and
  each option's visible text must be contained in its accessible name (WCAG 2.5.3).
- `RagBadge`'s own label states the health in words, so the badge is never colour-only.
- Both cards' figures keep their `TermTooltip`s, rendered as DOM siblings, never nested inside a
  clickable element.
- The switch is `print:hidden`; the chosen card prints.

## Testing

- `budget-forecast-cards.test.tsx`: the switch renders both options; only the chosen card's body is
  in the DOM; the badge appears per RAG state (G/A/R) and is absent when `paceVacHealth` is `null`;
  the efficiency card's unavailable copy renders when chosen without earned value; the gap line's
  existing conditions are unchanged.
- A settings round-trip test for `budgetForecastView` (default, persistence, rejection of junk).
- `budget-report-panel` tests: one Forecast section, the row's order, the table below the row, the
  caption still under the chart.
- `burndown-chart-panel` test for the new stacked-only prop, and that the dashboard's default
  behaviour is unchanged.
- Toolbar/ordering assertions use the shared `src/test/toolbar-order.ts` helper where buttons are
  involved.
- Axe scan of Reports (the section's structure changes).
- The `reports-budget-history` visual baseline is expected to change and is refreshed
  deliberately, with the new capture eyeballed before commit. `reports-budget-changes` stays
  byte-identical — the change table's width context is unchanged (the same full section width as
  before this spec).

## Implementation notes

- The switch heads the card column, above the card, rather than living in the card's own header
  (amends Decision 1): `PaceCard` and `EfficiencyCard` are different components, so a control
  swapped along with the card would unmount on every change and drop keyboard focus.
- Only the `reports-budget-history` visual baseline changed; `reports-budget-changes` stayed
  byte-identical, because the recorded-change table's width context is the same full section width
  it had before this row existed (amends the Testing section, which originally expected both
  baselines to change).

## Out of scope

- Changing any forecast arithmetic, thresholds or the `PACE_VAC_RED_RATIO` bands.
- Changing what the chart draws.
- The dashboard (spec C).
