"use client";

// Burn-down chart with its two switches (MR 3 addendum §5.1, §6). The switches
// write device settings through `useSettings` with FUNCTIONAL setters; instances
// sync through the settings listener registry, so the report and the tile agree
// and no stale copy can overwrite the choice (plan Ruling 18). Print shows the
// chosen view; the switches themselves do not print.
import { useMemo, type ReactNode } from "react";
import { type Lang, t } from "./i18n";
import { useSettings } from "./use-settings";
import { SegmentedControl } from "./segmented-control";
import { BurndownChart } from "./burndown-chart";
import { BudgetChangeTable } from "./budget-change-table";
import { buildChartModel, type ChartOrientation, type ChartUnit } from "./burndown-geometry";
import { isPaceAvailable } from "./budget-forecast";
import { splitVariance } from "./budget-history";
import type { BurndownSeries } from "./budget-burndown";
import type { ForecastBundle } from "./budget-forecast-bundle";

type PanelBundle = Pick<ForecastBundle, "eur" | "hours" | "evHistory" | "history">;

/** Either unit has a budget to draw. With neither, the switches could not reach
 *  a drawable chart, so only the "no budget" hint renders (the twin charts' rule). */
function hasAnyBudget(series: BurndownSeries): boolean {
  return series.totalBudgetValue > 0 || series.totalBudgetHours > 0;
}

/**
 * The recorded-change table in the displayed unit, or null when it has nothing
 * to show: no budget in either unit, no recorded history, or no change after the
 * baseline. ONE rule for the panel and `BurndownChangeTableBlock`, so a detached
 * table can never appear where the inline one would not.
 * The footer takes the PACE forecast's split, in the displayed unit (controller
 * ruling): the cards' primary figure, and the one the chart's own pace line
 * draws. Null when that forecast is unavailable — the recorded rows still stand
 * on their own.
 */
function changeTableFor({
  lang, series, bundle, unit, currency,
}: {
  lang: Lang; series: BurndownSeries; bundle: PanelBundle | null; unit: ChartUnit; currency: string;
}): ReactNode {
  const history = bundle ? bundle.history : null;
  if (!hasAnyBudget(series) || history === null || history.changes.length === 0) return null;
  const forecast = bundle ? bundle[unit] : null;
  const split = forecast !== null && isPaceAvailable(forecast.pace)
    ? splitVariance(
      unit === "eur" ? history.baseline.value : history.baseline.hours,
      unit === "eur" ? history.attributed.value : history.attributed.hours,
      forecast.facts.bac, forecast.pace.eac,
    )
    : null;
  return <BudgetChangeTable lang={lang} history={history} split={split} unit={unit} currency={currency} />;
}

export function BurndownChartPanel({
  lang, series, bundle, today, planEnd, currency, compact = false, detachChangeTable = false,
}: {
  lang: Lang; series: BurndownSeries; bundle: PanelBundle | null;
  today: string; planEnd: string; currency: string;
  /** True inside the dashboard tile. Spec §5.2 — "the dashboard tile shows the
   *  headline only", with D7 naming "tile carries the split too" as the
   *  REJECTED alternative — so the recorded-change table and its variance
   *  footer are suppressed here and the tile keeps the chart alone (its markers
   *  kept by D7, its EV line by §5.1). The report pane passes nothing and
   *  gets both. Suppressing rather than merely narrowing is also what the tile's
   *  box wants: it is one cell of `ArrangementGrid`'s
   *  `lg:grid-cols-2 xl:grid-cols-4` grid, so at its default `w: 1` (the `burn`
   *  row of `DASHBOARD_TILES`) it is a HALF of the pane at `lg` and a QUARTER at
   *  `xl`, while this panel's `2xl:` breakpoint reads the VIEWPORT, not that box. */
  compact?: boolean;
  /** True when the CALLER places the recorded-change table itself, through
   *  `BurndownChangeTableBlock`. The Budget report does: the panel sits in its
   *  forecast row's 70% column, where the `2xl` side-by-side placement below is
   *  unreachable, and the spec puts the table full width under the whole row
   *  (forecast-switch spec B, Decisions 6 and 7). Default false — the dashboard
   *  tile (`compact`) and any other caller are unchanged. */
  detachChangeTable?: boolean;
}) {
  const { settings, setSettings } = useSettings();
  const orientation: ChartOrientation = settings.budgetChartView ?? "burndown";
  const unit: ChartUnit = settings.budgetChartUnit ?? "eur";
  const history = bundle ? bundle.history : null;
  const model = useMemo(
    () => buildChartModel({
      series, unit, orientation, today, planEnd,
      forecast: bundle ? bundle[unit] : null,
      evHistory: bundle ? bundle.evHistory : null,
      history,
    }),
    [series, unit, orientation, today, planEnd, bundle, history],
  );
  // Spec §5.2: headline only in the tile — see the `compact` prop doc. A
  // detached table is the caller's to place — see `detachChangeTable`.
  const changeTable = compact || detachChangeTable
    ? null
    : changeTableFor({ lang, series, bundle, unit, currency });
  // No budget in EITHER unit: only the "no budget" hint renders. With one unit
  // empty the switches stay, so the other unit remains reachable.
  if (!hasAnyBudget(series)) {
    return <BurndownChart lang={lang} currency={currency} model={model} unit={unit} orientation={orientation} periods={series.periods} />;
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <SegmentedControl<ChartOrientation>
          value={orientation}
          options={[
            { value: "burndown", label: t(lang, "burndownViewBurndown") },
            { value: "cumulative", label: t(lang, "burndownViewCumulative") },
          ]}
          onChange={(v) => setSettings((s) => ({ ...s, budgetChartView: v }))}
          ariaLabel={t(lang, "burndownViewLabel")}
        />
        <SegmentedControl<ChartUnit>
          value={unit}
          options={[
            { value: "eur", label: t(lang, "burndownUnitEur") },
            { value: "hours", label: t(lang, "burndownUnitHours") },
          ]}
          onChange={(v) => setSettings((s) => ({ ...s, budgetChartUnit: v }))}
          ariaLabel={t(lang, "burndownUnitLabel")}
        />
      </div>
      {/* The table sits BELOW the chart, at full width, and moves beside it
          only from `2xl` (1536px viewport) up, where both fit. Measured in
          Chromium on the seeded Reports pane: the table's natural width is
          469px (every figure and date is no-wrap), so its column is 30rem
          (480px) and it never scrolls there; the row is about 380px narrower
          than the viewport, which leaves the chart 664px at 1536. Below 640px
          the chart's 8px labels render smaller than 8px, and at `xl` (1280)
          it would get only 408px. `min-w-0` keeps the svg column shrinkable.
          No `compact` or `detachChangeTable` branch here: either builds no
          `changeTable` at all, so the row holds the chart alone and the
          breakpoint has nothing to place beside it. */}
      <div className="flex flex-col gap-3 2xl:flex-row">
        <div className="min-w-0 flex-1">
          <BurndownChart lang={lang} currency={currency} model={model} unit={unit} orientation={orientation} periods={series.periods} />
        </div>
        {changeTable && <div className="min-w-0 2xl:w-[30rem] 2xl:shrink-0">{changeTable}</div>}
      </div>
    </div>
  );
}

/**
 * The recorded-change table on its own, for a caller that places it outside the
 * panel — the Budget report mounts it full width below its forecast row, with the
 * panel's `detachChangeTable` set. Reads the chart unit from the same device
 * setting as the panel's unit switch, so the two always show one unit.
 */
export function BurndownChangeTableBlock({
  lang, series, bundle, currency,
}: {
  lang: Lang; series: BurndownSeries; bundle: PanelBundle | null; currency: string;
}) {
  const { settings } = useSettings();
  const unit: ChartUnit = settings.budgetChartUnit ?? "eur";
  return changeTableFor({ lang, series, bundle, unit, currency });
}
