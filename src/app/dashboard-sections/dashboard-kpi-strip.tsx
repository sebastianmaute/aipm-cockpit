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

/** How many KPI cells render: the three fixed ones, plus SPI and/or CPI. */
export type KpiCellCount = 3 | 4 | 5;

/**
 * The strip's columns, per VISIBLE cell count (§581) — so no count ever leaves
 * an empty cell — and sized to the TILE, not the viewport (§585 made the tile
 * half width on xl, and a user may resize it). The wrapper below is the
 * `@container`; every variant here reads its content box.
 *
 * ★★ WHOLE LITERAL STRINGS — an interpolated class emits no CSS.
 *
 * ★ Each breakpoint is where n cells of 127px fit: DE's longest label
 * (`evmSpi`/`evmCpi`, 86px at `text-xs uppercase tracking-wide`) plus the
 * tile's 13px left padding+border, 4px clear, and the 24px hint icon + inset
 * in its corner — plus the 8px comfortable gap between cells. Measured in
 * Chromium, 2026-09-19; re-measure if `Tile` or a label changes.
 *   · 2 cells (262px) → `@2xs` (288px) · 3 (397px) → `@[25rem]` (400px) ·
 *     4 (532px) → `@[34rem]` (544px) · 5 (667px) → `@2xl` (672px).
 *   The two arbitrary sizes exist because the named ones miss real tiles: a
 *   half-width xl tile measures 409px of content at a 1280px viewport and
 *   569px at 1600px, just under `@md` (448px) and `@xl` (576px).
 * ★★ Five cells have no even split below one row, so between `@[25rem]` and
 * `@2xl` they sit 3 + 2 on a six-track grid (2 tracks each, the last two 3
 * each) — a full second row, not a gap. The `@2xl` resets must include the
 * `nth-last` one: it is more specific than a bare `*:` rule, so it would
 * otherwise keep the last two cells three tracks wide on the 5-column grid.
 */
export const KPI_STRIP_COLS: Record<KpiCellCount, string> = {
  3: "@[25rem]:grid-cols-3",
  4: "@2xs:grid-cols-2 @[34rem]:grid-cols-4",
  5: "@[25rem]:grid-cols-6 @[25rem]:*:col-span-2 @[25rem]:*:nth-last-[-n+2]:col-span-3 @2xl:grid-cols-5 @2xl:*:col-span-1 @2xl:*:nth-last-[-n+2]:col-span-1",
};

/** Standalone "at a glance" KPI card: completion % · overdue · open RAID,
 *  plus Effort SPI · Effort CPI whenever `model.evm.spi`/`model.evm.cpi` is
 *  non-null (spec C decision 8) — each is independent of the Budget module;
 *  `DashboardKpiStripProps` gains no new field.
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
  const cellCount = (3 + (showSpi ? 1 : 0) + (showCpi ? 1 : 0)) as KpiCellCount;
  return (
    <div className={`@container ${dc.kpiPad}`}>
      <div className={`grid grid-cols-1 ${KPI_STRIP_COLS[cellCount]} ${dc.kpiGap}`}>
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
