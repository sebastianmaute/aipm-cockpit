"use client";

// Burn-down chart with its two switches (MR 3 addendum §5.1, §6). The switches
// write device settings through `useSettings` with FUNCTIONAL setters; instances
// sync through the settings listener registry, so the report and the tile agree
// and no stale copy can overwrite the choice (plan Ruling 18). Print shows the
// chosen view; the switches themselves do not print.
import { useMemo } from "react";
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

export function BurndownChartPanel({
  lang, series, bundle, today, planEnd, currency, compact = false,
}: {
  lang: Lang; series: BurndownSeries; bundle: Pick<ForecastBundle, "eur" | "hours" | "evHistory" | "history"> | null;
  today: string; planEnd: string; currency: string;
  /** True inside the dashboard tile, which stays HALF the pane's width even on
   *  a desktop viewport — the `md:` breakpoint below reads the VIEWPORT, not
   *  the tile's own (much narrower) box, so a plain `md:flex-row` still turns
   *  side-by-side there and squeezes the chart. Compact always stacks. */
  compact?: boolean;
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
  // The footer takes the PACE forecast's split, in the displayed unit
  // (controller ruling): the cards' primary figure, and the one the chart's own
  // pace line draws. Null when that forecast is unavailable — the recorded rows
  // still stand on their own.
  const forecast = bundle ? bundle[unit] : null;
  const split = history !== null && forecast !== null && isPaceAvailable(forecast.pace)
    ? splitVariance(
      unit === "eur" ? history.baseline.value : history.baseline.hours,
      unit === "eur" ? history.attributed.value : history.attributed.hours,
      forecast.facts.bac, forecast.pace.eac,
    )
    : null;
  const changeTable = history !== null && history.changes.length > 0
    ? <BudgetChangeTable lang={lang} history={history} split={split} unit={unit} currency={currency} />
    : null;
  // No budget in EITHER unit: the switches could not reach a drawable chart,
  // so only the "no budget" hint renders (the twin charts' rule). With one unit
  // empty the switches stay, so the other unit remains reachable.
  if (!(series.totalBudgetValue > 0) && !(series.totalBudgetHours > 0)) {
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
      {/* The table stacks BELOW the chart on a narrow pane and sits beside it
          from md up; `min-w-0` keeps the svg column shrinkable inside the row.
          `compact` (the dashboard tile) forces the stacked layout regardless
          of viewport width — see the prop doc above. */}
      <div className={`flex flex-col gap-3${compact ? "" : " md:flex-row"}`}>
        <div className="min-w-0 flex-1">
          <BurndownChart lang={lang} currency={currency} model={model} unit={unit} orientation={orientation} periods={series.periods} />
        </div>
        {changeTable && <div className={`min-w-0${compact ? "" : " md:w-80 md:shrink-0"}`}>{changeTable}</div>}
      </div>
    </div>
  );
}
