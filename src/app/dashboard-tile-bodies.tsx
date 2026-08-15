"use client";

/**
 * The BODY of every arrangeable Dashboard tile, keyed by catalogue id.
 *
 * ★★ THE TILE CHROME OWNS THE FRAME AND THE TITLE. `dashboard-tile.tsx` draws
 * the border and renders `<h3>{t(lang, spec.labelKey)}</h3>`, and the catalogue's
 * label keys were chosen to MATCH the headings these cards used to carry
 * themselves (`dashboardProgress`, `dashboardBudgetBurn`, `dashboardMilestones`,
 * `dashboardChangesHeading`, `dashboardCompletionTrend`, `dashboardTrends` =
 * `navTrends`). So a body must NOT re-render its own `Section`/`Card` box or its
 * own heading — doing both stacks two identical `<h3>`s inside two nested
 * borders, and it also makes `getByText("Budget burn")` ambiguous in the panel's
 * own suite. The plan asked for the old JSX verbatim; that is the one place it
 * was wrong about the shipped components.
 *
 * ★ ONE DOCUMENTED EXCEPTION: `InsightsCard` keeps its own `Card` + heading,
 * because `insights-panel.tsx` renders it too and would lose them. It therefore
 * still double-titles inside its tile — a follow-up, not something to fix by
 * forking the component here.
 *
 * ★ A PLAIN BUILDER, not a `use*` hook: it calls nothing, it only assembles JSX
 * from live render-scope values (same shape as `buildShellChrome`). It lives in
 * its own module so `dashboard-panel.tsx` stays clear of the 800-line ratchet.
 */

import type { ReactNode } from "react";
import { Tile } from "./report-table";
import { RagDot } from "./rag-dot";
import { RagBadge } from "./rag-badge";
import { ratioHealth } from "./budget-health";
import { changeImpactRag } from "./change-log";
import { BurndownCharts } from "./burndown-chart";
import { BurndownChainWarning } from "./budget-chain-warning";
import { VarianceSummary } from "./variance-summary";
import { MilestoneHorizonStrip } from "./milestone-horizon-strip";
import { Sparkline } from "./sparkline";
import { EmptyState } from "./empty-state";
import { INTERACTIVE } from "./interaction-styles";
import { DashboardKpiStrip } from "./dashboard-sections/dashboard-kpi-strip";
import { DashboardTopActions } from "./dashboard-sections/dashboard-top-actions";
import { RaidRegisterCard, UpcomingCard } from "./dashboard-sections/registers-band";
import { InsightsCard } from "./dashboard-sections/insights-card";
import { t, type Lang, type TranslationKey } from "./i18n";
import type { DashboardModel } from "./dashboard";
import type { DashboardTileId } from "./dashboard-tiles";
import type { DensityClasses } from "./dashboard-density";
import type { MetricKey, MetricTrend } from "./dashboard-trends";
import type { MilestoneHorizonBuckets } from "./milestones";
import type { CompletionPoint } from "./completion-trend";
import type { VarianceRow } from "./snapshot";
import type { SuggestedAction } from "./next-actions/types";
import type { Insight, InsightActions, InsightEntityRef } from "./insights/insight";
import type { AppView } from "./nav-config";
import type { ChangeStatus } from "./types";

const CHANGE_STATUS_KEY: Record<ChangeStatus, TranslationKey> = {
  Proposed: "changeStatusProposed",
  "Under Review": "changeStatusUnderReview",
  Approved: "changeStatusApproved",
  Rejected: "changeStatusRejected",
  Implemented: "changeStatusImplemented",
  Deferred: "changeStatusDeferred",
};

/** A card body that is also a jump-to-view button when `onActivate` is wired. */
function ActivateBody({
  onActivate, ariaLabel, className, children,
}: {
  onActivate?: () => void;
  ariaLabel: string;
  className: string;
  children: ReactNode;
}) {
  return onActivate ? (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onActivate}
      className={`block w-full rounded-md border border-transparent text-left hover:border-ui-dark-blue ${INTERACTIVE} ${className}`}
    >
      {children}
    </button>
  ) : (
    <div className={className}>{children}</div>
  );
}

export interface TileBodyArgs {
  lang: Lang;
  dc: DensityClasses;
  model: DashboardModel;
  trends: Record<MetricKey, MetricTrend>;
  /** Formats a number in the plan's currency + the panel's locale. */
  money: (n: number) => string;
  currency: string;
  /** `hasNoActiveScope(model.progress)` — shared with the KPI card. */
  noActiveScope: boolean;
  completionSeries: readonly CompletionPoint[];
  milestoneBuckets: MilestoneHorizonBuckets;
  varianceRows: readonly VarianceRow[];
  allInsights: readonly Insight[];
  openInsightEntity: (ref: InsightEntityRef) => void;
  topActions?: readonly SuggestedAction[];
  showRaid: boolean;
  tursoActive: boolean;
  isPopout?: boolean;
  insightActions?: InsightActions;
  insightGeneratingId?: number | null;
  onCancelInsightRecommendation?: () => void;
  insightAiEnabled?: boolean;
  onNavigate?: (view: AppView) => void;
  onOpenRaid?: (id: number) => void;
  onOpenTask?: (id: number) => void;
  onOpenMilestone?: (id: number) => void;
  onOpenChange?: (id: number) => void;
  onOpenAction?: (a: SuggestedAction) => void;
}

/**
 * Every tile body the catalogue knows about. Gating is the CALLER's job — a body
 * is built here whether or not its tile currently renders, so the map stays a
 * pure function of the model.
 */
export function buildTileBodies(a: TileBodyArgs): Partial<Record<DashboardTileId, ReactNode>> {
  const { lang, dc, model, money } = a;
  const openTasks = a.onNavigate ? () => a.onNavigate!("open-points") : undefined;
  const openBudget = a.onNavigate ? () => a.onNavigate!("budget") : undefined;

  return {
    kpi: (
      <DashboardKpiStrip lang={lang} model={model} trends={a.trends} onNavigate={a.onNavigate} dc={dc} />
    ),

    topActions: (
      <DashboardTopActions lang={lang} topActions={a.topActions} onOpenAction={a.onOpenAction} dc={dc} />
    ),

    insights: (
      <InsightsCard
        insights={a.allInsights}
        lang={lang}
        dc={dc}
        actions={a.insightActions}
        generatingId={a.insightGeneratingId}
        onCancelGenerate={a.onCancelInsightRecommendation}
        aiEnabled={a.insightAiEnabled}
        onOpen={a.openInsightEntity}
        isPopout={a.isPopout}
      />
    ),

    raid: (
      <RaidRegisterCard lang={lang} topRaid={model.topRaid} onOpenRaid={a.onOpenRaid} showRaid={a.showRaid} />
    ),

    upcoming: (
      <UpcomingCard lang={lang} overdue={model.overdue} dueSoon={model.dueSoon} onOpenTask={a.onOpenTask} />
    ),

    progress: (
      <>
        <div className="flex flex-wrap gap-2">
          <Tile
            label={a.noActiveScope
              ? t(lang, "dashboardNoActiveScope")
              : t(lang, "dashboardPercentComplete", String(model.progress.percent))}
            value={a.noActiveScope
              ? t(lang, "dashboardAllCancelled", String(model.progress.total))
              : t(lang, "dashboardCompletedOf", String(model.progress.completed), String(model.progress.inScope))}
            onActivate={openTasks}
            activateLabel={a.noActiveScope
              ? `${t(lang, "dashboardNoActiveScope")} – ${t(lang, "dashboardOpenTasksView")}`
              : `${t(lang, "dashboardPercentComplete", String(model.progress.percent))} – ${t(lang, "dashboardOpenTasksView")}`}
          />
          <Tile
            label="R / A / G" hint={t(lang, "dashboardRagHint")}
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
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t(lang, "dashboardProgressCaption")}</p>
      </>
    ),

    // Turso-only. Clicking jumps to the Trends view.
    trends: (
      <ActivateBody
        onActivate={a.onNavigate ? () => a.onNavigate!("trends") : undefined}
        ariaLabel={t(lang, "dashboardOpenTrendsView")}
        className={dc.cardPad}
      >
        {a.varianceRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(lang, "dashboardTrendsNoBaseline")}</p>
        ) : (
          <VarianceSummary variance={a.varianceRows} lang={lang} />
        )}
      </ActivateBody>
    ),

    burn: (
      <>
        {model.burn ? (
          <div className="flex flex-wrap gap-2">
            <Tile
              label={t(lang, "dashboardSubBudget")} hint={t(lang, "dashboardBudgetHint")}
              value={`${money(model.burn.consumedValue)} / ${money(model.burn.budgetValue)}`}
              rag={<RagBadge value={ratioHealth(model.burn.consumedValue, model.burn.budgetValue)} lang={lang} title={t(lang, "dashboardSubBudget")} />}
              onActivate={openBudget}
              activateLabel={`${t(lang, "dashboardSubBudget")} – ${t(lang, "dashboardOpenBudgetView")}`}
            />
            <Tile
              label="h" hint={t(lang, "dashboardHoursHint")}
              value={`${Math.round(model.burn.actualHours)} / ${Math.round(model.burn.budgetHours)}`}
              rag={<RagBadge value={ratioHealth(model.burn.actualHours, model.burn.budgetHours)} lang={lang} title="h" />}
              onActivate={openBudget}
              activateLabel={`${t(lang, "resourcesUtilModeHours")} – ${t(lang, "dashboardOpenBudgetView")}`}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t(lang, "dashboardNoBudget")}</p>
        )}
        {model.evm.coverage.withEstimate > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <Tile
              label={t(lang, "evmSpi")} hint={t(lang, "evmSpiHint")}
              value={model.evm.spi != null ? model.evm.spi.toFixed(2) : "—"}
              onActivate={openBudget}
              activateLabel={`${t(lang, "evmSpi")} – ${t(lang, "dashboardOpenBudgetView")}`}
            />
            <Tile
              label={t(lang, "evmCpi")} hint={t(lang, "evmCpiHint")}
              value={model.evm.cpi != null ? model.evm.cpi.toFixed(2) : "—"}
              onActivate={openBudget}
              activateLabel={`${t(lang, "evmCpi")} – ${t(lang, "dashboardOpenBudgetView")}`}
            />
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">{t(lang, "evmNoEstimates")}</p>
        )}
        {model.burndown ? (
          <div className="mt-3">
            <BurndownChainWarning lang={lang} chain={model.bucketChain} />
            <BurndownCharts series={model.burndown} lang={lang} currency={a.currency} />
          </div>
        ) : null}
        {model.burn ? (
          <p className="mt-2 text-xs text-muted-foreground">{t(lang, "dashboardBurnCaption")}</p>
        ) : null}
      </>
    ),

    milestones: (
      <MilestoneHorizonStrip lang={lang} buckets={a.milestoneBuckets} onOpenMilestone={a.onOpenMilestone} />
    ),

    changes: (
      <>
        <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
          {t(lang, "dashboardChangesPending", String(model.changes.pending))}
        </p>
        {model.topChanges.length === 0 ? (
          <EmptyState compact title={t(lang, "dashboardChangesEmpty")} />
        ) : (
          <ul className="space-y-1 text-sm">
            {model.topChanges.map((c) => {
              const content = (
                <>
                  <RagBadge value={changeImpactRag(c.impact)} lang={lang} />
                  <span className="text-muted-foreground">#{c.id}</span>
                  <span className="font-medium">{c.title}</span>
                  <span className="text-muted-foreground">· {t(lang, CHANGE_STATUS_KEY[c.status])}</span>
                </>
              );
              return (
                <li key={c.id}>
                  {a.onOpenChange ? (
                    <button
                      type="button"
                      aria-label={t(lang, "dashboardOpenChangeItem", c.title)}
                      onClick={() => a.onOpenChange!(c.id)}
                      className={`flex w-full items-center gap-2 rounded-md border border-transparent px-1 py-0.5 text-left hover:border-ui-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
                    >
                      {content}
                    </button>
                  ) : (
                    <span className="flex items-center gap-2">{content}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </>
    ),

    // ★ Gated on `>= 2 points AND active scope` — see `hasCompletionTrend` in
    // the panel. An all-cancelled project would otherwise show a flat 0%
    // trajectory beside a completion tile reading "No active scope". The
    // snapshot-fed series does NOT go to zero on its own (`fromSnapshots` reads
    // each record's stored `pctComplete` and never consults `inScope`), so the
    // suppression is real on that path, not a guard dressed up as one.
    completionTrend: a.completionSeries.length >= 2 ? (
      <ActivateBody
        onActivate={a.onNavigate ? () => a.onNavigate!(a.tursoActive ? "trends" : "open-points") : undefined}
        ariaLabel={t(lang, a.tursoActive ? "dashboardOpenTrendsView" : "dashboardOpenTasksView")}
        className={dc.cardPad}
      >
        <div className="mb-1 flex items-baseline justify-end">
          <span className="text-xs text-muted-foreground tabular-nums">
            {t(lang, "dashboardCompletionTrendPoints", a.completionSeries.length)}
          </span>
        </div>
        <Sparkline
          points={a.completionSeries}
          ariaLabel={t(
            lang,
            "dashboardCompletionTrendAria",
            a.completionSeries[a.completionSeries.length - 1].percent,
            a.completionSeries[0].percent,
            a.completionSeries.length,
          )}
        />
      </ActivateBody>
    ) : null,
  };
}
