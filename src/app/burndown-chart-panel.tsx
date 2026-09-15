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
import { buildChartModel, type ChartOrientation, type ChartUnit } from "./burndown-geometry";
import type { BurndownSeries } from "./budget-burndown";
import type { ForecastBundle } from "./budget-forecasts";

export function BurndownChartPanel({
  lang, series, bundle, today, planEnd, currency,
}: {
  lang: Lang; series: BurndownSeries; bundle: Pick<ForecastBundle, "eur" | "hours" | "evHistory"> | null;
  today: string; planEnd: string; currency: string;
}) {
  const { settings, setSettings } = useSettings();
  const orientation: ChartOrientation = settings.budgetChartView ?? "burndown";
  const unit: ChartUnit = settings.budgetChartUnit ?? "eur";
  const model = useMemo(
    () => buildChartModel({
      series, unit, orientation, today, planEnd,
      forecast: bundle ? bundle[unit] : null,
      evHistory: bundle ? bundle.evHistory : null,
    }),
    [series, unit, orientation, today, planEnd, bundle],
  );
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
      <BurndownChart lang={lang} currency={currency} model={model} unit={unit} orientation={orientation} periods={series.periods} />
    </div>
  );
}
