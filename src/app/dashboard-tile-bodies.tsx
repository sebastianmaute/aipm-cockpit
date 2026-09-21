"use client";

/**
 * The BODY of every arrangeable Dashboard tile, keyed by catalogue id.
 *
 * ★★ THE TILE CHROME OWNS THE FRAME AND THE TITLE. `dashboard-tile.tsx` draws
 * the border and renders `<h3>{t(lang, spec.labelKey)}</h3>`, and the catalogue's
 * label keys were chosen to MATCH the headings these cards used to carry
 * themselves (`dashboardBudgetBurn`, `dashboardMilestones`,
 * `dashboardChangesHeading`, `dashboardCompletionTrend`, `dashboardTrends` =
 * `navTrends`). So a body must NOT re-render its own `Section`/`Card` box or its
 * own heading — doing both stacks two identical `<h3>`s inside two nested
 * borders, and it also makes `getByText("Budget burn")` ambiguous in the panel's
 * own suite. The plan asked for the old JSX verbatim; that is the one place it
 * was wrong about the shipped components.
 *
 * ★★ THERE IS NO EXCEPTION, and this header claimed one. It read "`InsightsCard`
 * keeps its own `Card` + heading, because `insights-panel.tsx` renders it too" —
 * `insights-panel.tsx` renders its OWN list and only shares the
 * `insightsCardTitle` string, so `buildTileBodies` was and is the component's
 * sole call site (`grep -rn "InsightsCard" src --include="*.tsx" |
 * grep -v "\.test\."`). The card is unboxed and un-titled like every other body.
 *
 * ★ The ONE body that still carries a heading is `RaidRegisterCard`, and the
 * test is the TEXT, not the component: its "Top open RAID" differs from its
 * chrome title "RAID register", so it disambiguates. `InsightsCard`'s heading
 * was byte-identical to its chrome title in both dictionaries, so it went.
 *
 * ★ A PLAIN BUILDER, not a `use*` hook: it calls nothing, it only assembles JSX
 * from live render-scope values (same shape as `buildShellChrome`). It lives in
 * its own module so `dashboard-panel.tsx` stays clear of the 800-line ratchet.
 */

import type { ReactNode } from "react";
import { RagBadge } from "./rag-badge";
import { changeImpactRag } from "./change-log";
import { BurndownChartPanel } from "./burndown-chart-panel";
import { BurndownChainWarning } from "./budget-chain-warning";
import { VarianceSummary } from "./variance-summary";
import { MilestoneHorizonStrip } from "./milestone-horizon-strip";
import { Sparkline } from "./sparkline";
import { formatDayMonth } from "./forecast-format";
import { localeFor } from "./date-format";
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
  /** Currency label for the burn-down axis. EUR: the engine's burn-down series
   *  is `budgetHours × role.rates.external` and converts nothing — see the
   *  `currency` argument in `dashboard-panel.tsx`. */
  currency: string;
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
  const { lang, dc, model } = a;

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

    // ★★ Spec C decision 7: CHART-ONLY. The forecast headline, the Spent and
    // hours tiles, the FX rollup notice and the Effort SPI/CPI tiles all left:
    // the indices moved to the KPI tile (decision 8); the rest live on the
    // Budget view and report. `compact` still suppresses the change table. The
    // chain warning stays because it qualifies the chart it heads.
    burn: model.burndown ? (
      <>
        <BurndownChainWarning lang={lang} chain={model.bucketChain} />
        <BurndownChartPanel
          lang={lang}
          series={model.burndown}
          bundle={model.forecastBundle}
          today={model.chartDates.today}
          planEnd={model.chartDates.planEnd}
          currency={a.currency}
          compact
        />
      </>
    ) : (
      <p className="text-sm text-muted-foreground">{t(lang, "dashboardNoBudget")}</p>
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
        <CompletionTrendBody lang={lang} points={a.completionSeries} today={a.model.chartDates.today} />
      </ActivateBody>
    ) : null,
  };
}

/** The Completion trend line with the context that makes it a trend: the first
 *  and last values above it, and their dates below it ("Today" when the last
 *  point is today's figure). ★ The dates are the point of this component — a
 *  line with no time axis says nothing. The accessible name carries the same
 *  four facts, dated, for a screen reader. */
function CompletionTrendBody({ lang, points, today }: {
  lang: Lang;
  points: readonly CompletionPoint[];
  today: string;
}) {
  const first = points[0];
  const last = points[points.length - 1];
  const locale = localeFor(lang);
  const firstDate = formatDayMonth(first.date, locale);
  const lastDate = formatDayMonth(last.date, locale);
  const edge = "flex justify-between text-xs text-muted-foreground tabular-nums";
  return (
    <>
      <div className={`mb-1 ${edge}`} aria-hidden="true">
        <span>{first.percent}%</span>
        <span>{last.percent}%</span>
      </div>
      <Sparkline
        points={points}
        ariaLabel={t(lang, "dashboardCompletionTrendAria", last.percent, lastDate, first.percent, firstDate)}
      />
      <div className={`mt-1 ${edge}`} aria-hidden="true">
        <span>{firstDate}</span>
        <span>{last.date === today ? t(lang, "dashboardCompletionTrendToday") : lastDate}</span>
      </div>
    </>
  );
}

