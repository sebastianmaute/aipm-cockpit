"use client";

import { KpiGradientBar, Tile } from "../report-table";
import { type Lang, t } from "../i18n";
import { TrendArrow } from "../trend-arrow";
import type { DashboardModel } from "../dashboard";
import type { MetricKey, MetricTrend } from "../dashboard-trends";
import type { DensityClasses } from "../dashboard-density";
import type { AppView } from "../nav-config";

interface DashboardKpiStripProps {
  lang: Lang;
  model: DashboardModel;
  trends: Record<MetricKey, MetricTrend>;
  onNavigate?: (view: AppView) => void;
  dc: DensityClasses;
}

/** Standalone "at a glance" KPI card: completion % · overdue · open RAID.
 *  Extracted from DashboardHero so it can be a first-class masonry item. */
export function DashboardKpiStrip({ lang, model, trends, onNavigate, dc }: DashboardKpiStripProps) {
  return (
    <div className={`rounded-lg border border-line bg-surface ${dc.cardPad} shadow-[var(--shadow-card)]`}>
      <div className={`grid grid-cols-1 sm:grid-cols-3 ${dc.kpiGap}`}>
        <Tile
          label={t(lang, "dashboardKpiComplete")}
          hint={t(lang, "dashboardKpiCompleteHint")}
          value={`${model.progress.percent}%`}
          bar={<KpiGradientBar percent={model.progress.percent} label={t(lang, "dashboardKpiComplete")} />}
          trend={<TrendArrow trend={trends.complete} metricLabel={t(lang, "dashboardKpiComplete")} unit="%" lang={lang} />}
          onActivate={onNavigate ? () => onNavigate("open-points") : undefined}
          activateLabel={`${t(lang, "dashboardKpiComplete")} – ${t(lang, "dashboardOpenTasksView")}`}
        />
        <Tile
          label={t(lang, "dashboardKpiOverdue")}
          hint={t(lang, "dashboardKpiOverdueHint")}
          value={String(model.overdue.length)}
          trend={<TrendArrow trend={trends.overdue} metricLabel={t(lang, "dashboardKpiOverdue")} lang={lang} />}
          onActivate={onNavigate ? () => onNavigate("open-points") : undefined}
          activateLabel={`${t(lang, "dashboardKpiOverdue")} – ${t(lang, "dashboardOpenTasksView")}`}
        />
        <Tile
          label={t(lang, "dashboardKpiOpenRaid")}
          hint={t(lang, "dashboardKpiOpenRaidHint")}
          value={String(model.openRaidCount)}
          trend={<TrendArrow trend={trends.openRaid} metricLabel={t(lang, "dashboardKpiOpenRaid")} lang={lang} />}
          onActivate={onNavigate ? () => onNavigate("raid") : undefined}
          activateLabel={`${t(lang, "dashboardKpiOpenRaid")} – ${t(lang, "dashboardOpenRaidView")}`}
        />
      </div>
    </div>
  );
}
