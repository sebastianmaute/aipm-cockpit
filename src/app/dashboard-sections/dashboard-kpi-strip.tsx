"use client";

import { KpiGradientBar, Tile } from "../report-table";
import { RagDot } from "../rag-dot";
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

/** How many KPI cells render: the four fixed ones, plus SPI and/or CPI. */
export type KpiCellCount = 4 | 5 | 6;

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
 *     4 (532px) → `@[34rem]` (544px) · 5 (667px) → `@2xl` (672px) ·
 *     6 (6 × 127 + 5 × 8) → `@4xl` (896px), the first named size above it
 *     (`@3xl` is 768px). That one is ARITHMETIC over the same per-cell figure,
 *     not a fresh measurement; `e2e/dashboard-grid.spec.ts`'s KPI-strip test
 *     is what checks the six-cell strip fits its tile.
 *   A class depends on the cell COUNT, never on which cells, so the 4- and
 *   5-cell entries kept their classes when R/A/G joined and the three-cell
 *   strip stopped existing.
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
  4: "@2xs:grid-cols-2 @[34rem]:grid-cols-4",
  5: "@[25rem]:grid-cols-6 @[25rem]:*:col-span-2 @[25rem]:*:nth-last-[-n+2]:col-span-3 @2xl:grid-cols-5 @2xl:*:col-span-1 @2xl:*:nth-last-[-n+2]:col-span-1",
  6: "@2xs:grid-cols-2 @[25rem]:grid-cols-3 @4xl:grid-cols-6",
};

/** Standalone "at a glance" KPI card: completion (with count) · R/A/G ·
 *  overdue · open RAID, plus Effort SPI · Effort CPI whenever
 *  `model.evm.spi`/`model.evm.cpi` is non-null (spec C decision 8) — each is
 *  independent of the Budget module; `DashboardKpiStripProps` gains no new
 *  field. The completion count and the R/A/G cell came from the retired
 *  Progress tile, so the landing page shows completion exactly once.
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
  const openTasks = onNavigate ? () => onNavigate("open-points") : undefined;
  const cellCount = (4 + (showSpi ? 1 : 0) + (showCpi ? 1 : 0)) as KpiCellCount;
  return (
    <div className={`@container ${dc.kpiPad}`}>
      <div className={`grid grid-cols-1 auto-rows-fr ${KPI_STRIP_COLS[cellCount]} ${dc.kpiGap}`}>
        <Tile fill
          label={noActiveScope ? t(lang, "dashboardNoActiveScope") : t(lang, "dashboardKpiComplete")}
          // Dropped with the bar and the trend: the hint explains how a
          // percentage is computed, and in this state the tile shows none.
          hint={noActiveScope ? undefined : t(lang, "dashboardCompleteHint")}
          value={noActiveScope
            ? t(lang, "dashboardAllCancelled", String(model.progress.total))
            : `${model.progress.percent}%`}
          bar={noActiveScope ? undefined : <KpiGradientBar percent={model.progress.percent} label={t(lang, "dashboardKpiComplete")} />}
          sub={noActiveScope ? undefined : t(lang, "dashboardCompletedOf", String(model.progress.completed), String(model.progress.inScope))}
          trend={noActiveScope ? undefined : <TrendArrow trend={trends.complete} metricLabel={t(lang, "dashboardKpiComplete")} unit="%" lang={lang} />}
          onActivate={openTasks}
          activateLabel={noActiveScope
            ? `${t(lang, "dashboardNoActiveScope")} – ${t(lang, "dashboardOpenTasksView")}`
            : `${t(lang, "dashboardKpiComplete")} – ${t(lang, "dashboardOpenTasksView")}`}
        />
        <Tile fill
          label="R / A / G" hint={t(lang, "dashboardRagSplitHint")}
          value={
            <span className="inline-flex items-center gap-2">
              <span className="inline-flex items-center gap-1"><RagDot level="R" />{model.progress.counts.R}</span>
              <span className="inline-flex items-center gap-1"><RagDot level="A" />{model.progress.counts.A}</span>
              <span className="inline-flex items-center gap-1"><RagDot level="G" />{model.progress.counts.G}</span>
              {/* ★ Conditional on > 0 — "✕ 0" on every healthy project is
                  noise. ★ The glyph is aria-hidden with an sr-only
                  companion: a bare "✕" announces inconsistently across
                  screen readers, and unlike the three RagDots it cannot
                  lean on the tile's own "R / A / G" label for meaning. */}
              {model.progress.outOfScope > 0 && (
                <span className="inline-flex items-center gap-1">
                  <span aria-hidden="true" className="text-muted-foreground">✕</span>
                  <span className="sr-only">{t(lang, "dashboardOutOfScopeCount")}</span>
                  {model.progress.outOfScope}
                </span>
              )}
            </span>
          }
          onActivate={openTasks}
          activateLabel={`R / A / G – ${t(lang, "dashboardOpenTasksView")}`}
        />
        <Tile fill
          label={t(lang, "dashboardKpiOverdue")}
          hint={t(lang, "dashboardKpiOverdueHint")}
          value={String(model.overdue.length)}
          trend={<TrendArrow trend={trends.overdue} metricLabel={t(lang, "dashboardKpiOverdue")} lang={lang} />}
          onActivate={openTasks}
          activateLabel={`${t(lang, "dashboardKpiOverdue")} – ${t(lang, "dashboardOpenTasksView")}`}
        />
        <Tile fill
          label={t(lang, "dashboardKpiOpenRaid")}
          hint={t(lang, "dashboardKpiOpenRaidHint")}
          value={String(model.openRaidCount)}
          trend={<TrendArrow trend={trends.openRaid} metricLabel={t(lang, "dashboardKpiOpenRaid")} lang={lang} />}
          onActivate={onNavigate ? () => onNavigate("raid") : undefined}
          activateLabel={`${t(lang, "dashboardKpiOpenRaid")} – ${t(lang, "dashboardOpenRaidView")}`}
        />
        {showSpi && (
          <Tile fill
            label={t(lang, "evmSpi")} hint={t(lang, "evmSpiHint")}
            value={model.evm.spi!.toFixed(2)}
            onActivate={openBudget}
            activateLabel={`${t(lang, "evmSpi")} – ${t(lang, "dashboardOpenBudgetView")}`}
          />
        )}
        {showCpi && (
          <Tile fill
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
