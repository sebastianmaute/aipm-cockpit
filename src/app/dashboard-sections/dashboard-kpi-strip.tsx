"use client";

import { KpiGradientBar, Tile } from "../report-table";
import { type Lang, t } from "../i18n";
import { TrendArrow } from "../trend-arrow";
import { hasNoActiveScope, type DashboardModel } from "../dashboard";
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

/** Standalone "at a glance" KPI card: completion % · overdue · open RAID,
 *  plus Effort SPI · Effort CPI whenever `model.evm.spi`/`model.evm.cpi` is
 *  non-null (spec C decision 8) — each is independent of the Budget module
 *  (see the SPI/CPI visibility ruling above); `DashboardKpiStripProps` gains
 *  no new field.
 *
 *  ★ NO BOX OF ITS OWN — the arrangeable tile chrome (`dashboard-tile.tsx`)
 *  draws the border and the title ("At a glance"). A `Card boxed` here would
 *  nest a second bordered surface inside the first. */
export function DashboardKpiStrip({ lang, model, trends, onNavigate, dc }: DashboardKpiStripProps) {
  const noActiveScope = hasNoActiveScope(model.progress);
  // ★ Spec C decision 8, user's ruling: each index is shown whenever IT can
  // move a value the user sees — never gated on the Budget module. SPI feeds
  // the Schedule RAG and CPI feeds the Budget RAG (`dashboard.ts`
  // `evmIndexHealth`) from `model.evm`, which is computed over `tasks` alone
  // and is never gated on `showBudget`; the Budget RAG it moves also reaches
  // the delta strip, the AI snapshot tool, Trends and the Portfolio health
  // table with the Budget module off. No estimate → the index is `null` → no
  // badge for it to explain, so the tile is simply absent (never "—").
  const showSpi = model.evm.spi !== null;
  const showCpi = model.evm.cpi !== null;
  const openBudget = onNavigate ? () => onNavigate("budget") : undefined;
  // ★★ Whole literal class strings — an interpolated grid-cols emits no CSS.
  // Up to five tiles fit one row from `lg`, at the tile's default width (it
  // can be narrowed).
  const cols = showSpi || showCpi ? "sm:grid-cols-3 lg:grid-cols-5" : "sm:grid-cols-3";
  return (
    <div className={dc.cardPad}>
      <div className={`grid grid-cols-1 ${cols} ${dc.kpiGap}`}>
        <Tile
          label={noActiveScope ? t(lang, "dashboardNoActiveScope") : t(lang, "dashboardKpiComplete")}
          // Dropped with the bar and the trend: the hint explains how a
          // percentage is computed, and in this state the tile shows none.
          hint={noActiveScope ? undefined : t(lang, "dashboardKpiCompleteHint")}
          value={noActiveScope
            ? t(lang, "dashboardAllCancelled", String(model.progress.total))
            : `${model.progress.percent}%`}
          bar={noActiveScope ? undefined : <KpiGradientBar percent={model.progress.percent} label={t(lang, "dashboardKpiComplete")} />}
          trend={noActiveScope ? undefined : <TrendArrow trend={trends.complete} metricLabel={t(lang, "dashboardKpiComplete")} unit="%" lang={lang} />}
          onActivate={onNavigate ? () => onNavigate("open-points") : undefined}
          activateLabel={noActiveScope
            ? `${t(lang, "dashboardNoActiveScope")} – ${t(lang, "dashboardOpenTasksView")}`
            : `${t(lang, "dashboardKpiComplete")} – ${t(lang, "dashboardOpenTasksView")}`}
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
        {showSpi && (
          <Tile
            label={t(lang, "evmSpi")} hint={t(lang, "evmSpiHint")}
            value={model.evm.spi!.toFixed(2)}
            onActivate={openBudget}
            activateLabel={`${t(lang, "evmSpi")} – ${t(lang, "dashboardOpenBudgetView")}`}
          />
        )}
        {showCpi && (
          <Tile
            label={t(lang, "evmCpi")} hint={t(lang, "evmCpiHint")}
            value={model.evm.cpi!.toFixed(2)}
            onActivate={openBudget}
            activateLabel={`${t(lang, "evmCpi")} – ${t(lang, "dashboardOpenBudgetView")}`}
          />
        )}
      </div>
    </div>
  );
}
