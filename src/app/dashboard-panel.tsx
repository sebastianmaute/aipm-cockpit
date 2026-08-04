"use client";

import { useMemo, useState } from "react";
import { ReportCard, Section, Tile } from "./report-table";
import { Card } from "./card";
import { buildDashboardInput, computeDashboard, hasNoActiveScope } from "./dashboard";
import { RaidRegisterCard, UpcomingCard } from "./dashboard-sections/registers-band";
import { DashboardKpiStrip } from "./dashboard-sections/dashboard-kpi-strip";
import { DashboardTopActions } from "./dashboard-sections/dashboard-top-actions";
import { useWorkspace } from "./workspace-context";
import { loadActivityLog, type ActivityEntry } from "./activity-log";
import { type Lang, t, localeFor, type TranslationKey } from "./i18n";
import { RagDot } from "./rag-dot";
import type { Health } from "./health";
import { ratioHealth } from "./budget-health";
import { changeImpactRag } from "./change-log";
import type { Absence, BudgetBucket, ChangeItem, ChangeStatus, Milestone, RaidItem, ResourcePlan, Resource, Role, Task } from "./types";
import { formatCurrency } from "./resource-cost";
import { RagBadge } from "./rag-badge";
import { BurndownCharts } from "./burndown-chart";
import { BurndownChainWarning } from "./budget-chain-warning";
import type { SuggestedAction } from "./next-actions/types";
import type { InsightActions } from "./insights/insight";
import { useResizable } from "./use-resizable";
import { PrintButton, ResetSizeButton } from "./task-manager-ui";
import { VarianceSummary } from "./variance-summary";
import type { VarianceRow, SnapshotRecord } from "./snapshot";
import { useLandingDelta } from "./use-landing-delta";
import { buildGreeting, type RagScope } from "./dashboard-delta";
import { DashboardDeltaStrip } from "./dashboard-delta-strip";
import { computeCompletionTrend } from "./completion-trend";
import { Sparkline } from "./sparkline";
import { bucketMilestonesByHorizon } from "./milestones";
import { MilestoneHorizonStrip } from "./milestone-horizon-strip";
import { computeCoaching, type SettingsSectionId } from "./dashboard-coaching";
import { INTERACTIVE } from "./interaction-styles";
import { EmptyState } from "./empty-state";
import { DashboardCoachingCard } from "./dashboard-coaching-card";
import { DashboardTipCard } from "./dashboard-tip-card";
import { DigestCardConnected } from "./digest/digest-card-connected";
import { densityClasses, type DashboardDensity } from "./dashboard-density";
import { type AppView } from "./nav-config";
import { NarrativeSummary, NarrativeEditor } from "./dashboard-sections/dashboard-narrative";
import { DashboardHero } from "./dashboard-sections/dashboard-hero";
import { InsightsCard } from "./dashboard-sections/insights-card";
import type { Insight, InsightEntityRef } from "./insights/insight";

interface DashboardPanelProps {
  lang: Lang;
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  budgets: readonly BudgetBucket[];
  plan: ResourcePlan;
  roles: readonly Role[];
  resources: readonly Resource[];
  absences: readonly Absence[];
  holidaySet: ReadonlySet<string>;
  workdayHours: number;
  today: string;
  milestones?: readonly Milestone[];
  changes?: readonly ChangeItem[];
  onOpenRaid?: (id: number) => void;
  onOpenTask?: (id: number) => void;
  onOpenMilestone?: (id: number) => void;
  showRaid?: boolean;
  showBudget?: boolean;
  showMilestones?: boolean;
  showChanges?: boolean;
  topActions?: readonly SuggestedAction[];
  onOpenAction?: (a: SuggestedAction) => void;
  variance?: readonly VarianceRow[];
  snapshots?: readonly SnapshotRecord[];
  tursoActive?: boolean;
  projectId?: string;
  isPopout?: boolean;
  onOpenChange?: (id: number) => void;
  onNavigate?: (view: AppView, section?: SettingsSectionId) => void;
  aiConfigured?: boolean;
  /** Per-device cockpit density (spacing only). Default "comfortable". Set via Settings → Appearance. */
  density?: DashboardDensity;
  /** Insights lifecycle callbacks (#6B SP1/SP2). Forwarded to InsightsCard. */
  insightActions?: InsightActions;
  /** Id of the insight (if any) whose AI recommendation is generating (#6B
   *  SP2) — forwarded to InsightsCard for a busy state. */
  insightGeneratingId?: number | null;
  insightAiEnabled?: boolean;
}

const CHANGE_STATUS_KEY: Record<ChangeStatus, TranslationKey> = {
  Proposed: "changeStatusProposed",
  "Under Review": "changeStatusUnderReview",
  Approved: "changeStatusApproved",
  Rejected: "changeStatusRejected",
  Implemented: "changeStatusImplemented",
  Deferred: "changeStatusDeferred",
};

export function DashboardPanel(props: DashboardPanelProps) {
  const { lang, today, onOpenRaid, onOpenTask, topActions, onOpenAction } = props;
  const { showRaid = true, showBudget = true, showMilestones = true, showChanges = true } = props;
  const density: DashboardDensity = props.density ?? "comfortable";
  const dc = densityClasses(density);
  const varianceRows = props.variance ?? [];
  const { status, setStatus, insights } = useWorkspace();
  const { ref: sizeRef, reset: resetSize } = useResizable("aipm-cockpit:dashboard-size");

  const locale = localeFor(lang);
  const money = (n: number) => formatCurrency(n, props.plan.currency || "EUR", locale);

  const [activity] = useState<ActivityEntry[]>(() => loadActivityLog());

  const model = useMemo(
    () =>
      computeDashboard(
        buildDashboardInput(
          {
            tasks: props.tasks,
            raid: showRaid ? props.raid : [],
            budgets: showBudget ? props.budgets : [],
            plan: props.plan,
            roles: props.roles,
            resources: props.resources,
            absences: props.absences,
            milestones: showMilestones ? props.milestones : [],
            changes: showChanges ? props.changes : [],
          },
          {
            workdayHours: props.workdayHours,
            holidaySet: props.holidaySet,
            status,
            activity,
            today,
          },
        ),
      ),
    [
      props.tasks, props.raid, props.budgets, props.plan,
      props.roles, props.resources, props.absences,
      props.workdayHours, props.holidaySet,
      props.milestones, props.changes,
      showRaid, showBudget, showMilestones, showChanges,
      status, activity, today,
    ],
  );

  // Completion-trend sparkline (slice #6). Snapshot-preferred, activity-log
  // fallback. Deps hoisted to scalars (exhaustive-deps bans obj.member/.length
  // in the array).
  const snapshots = props.snapshots ?? [];
  const snapCount = snapshots.length;
  const activityCount = activity.length;
  const currentDone = model.progress.completed;
  // inScope, NOT total: the sparkline's last point is anchored on these counts
  // and renders directly beneath the completion tile, so it must divide by the
  // same denominator the tile's percentage does.
  const currentTotal = model.progress.inScope;
  // Shared with the at-a-glance KPI card, which renders the SAME metric — see
  // hasNoActiveScope. Re-deriving it here is how the two cards once disagreed.
  const noActiveScope = hasNoActiveScope(model.progress);
  const completionSeries = useMemo(
    () =>
      computeCompletionTrend({ snapshots, activity, currentDone, currentTotal, today }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapCount, activityCount, currentDone, currentTotal, today],
  );

  // Landing cockpit: greeting + "since you last looked" delta.
  const currentRag: Record<RagScope, Health | null> = {
    overall: model.overall.effective,
    schedule: model.schedule.effective,
    budget: model.budget.effective,
    scope: model.scope.effective,
  };
  const currentMetrics = {
    complete: model.progress.percent,
    overdue: model.overdue.length,
    openRaid: model.openRaidCount,
  };
  const { delta, trends } = useLandingDelta({
    projectId: props.projectId ?? "default",
    currentRag,
    currentMetrics,
    overdue: model.overdue,
    today,
    isPopout: props.isPopout ?? false,
  });
  // Hour captured once (lazy) to keep `new Date()` out of the render body.
  const [greetHour] = useState(() => new Date().getHours());
  const milestonesSoon =
    model.overdueMilestones.length + model.atRiskMilestones.length + model.dueSoonMilestones.length;
  const greeting = buildGreeting(greetHour, { needsYou: topActions?.length ?? 0, milestonesSoon });
  // Representative task for the strip's task chips (first overdue, else first
  // due-soon). undefined ⇒ the strip downgrades those chips to info-only spans.
  const repTaskId = model.overdue[0]?.id ?? model.dueSoon[0]?.id;

  // Forward "what's coming" milestone horizon for the dashboard strip.
  const milestoneBuckets = useMemo(
    () =>
      bucketMilestonesByHorizon(
        showMilestones ? (props.milestones ?? []) : [],
        new Map(props.tasks.map((t) => [t.id, t] as const)),
        today,
        props.holidaySet,
      ),
    [showMilestones, props.milestones, props.tasks, today, props.holidaySet],
  );

  // First-open coaching CTAs (self-hide once any task exists). Counts hoisted to
  // locals so the dep array stays scalar (exhaustive-deps rejects a `?.length`
  // member expression in the array).
  const taskCount = props.tasks.length;
  const milestoneCount = props.milestones?.length ?? 0;
  const budgetCount = props.budgets.length;
  const aiConfigured = props.aiConfigured ?? false;
  const coachingCtas = useMemo(
    () => computeCoaching({ taskCount, milestoneCount, budgetCount, showMilestones, showBudget, aiConfigured }),
    [taskCount, milestoneCount, budgetCount, showMilestones, showBudget, aiConfigured],
  );

  // Insights review card (#6B SP1). Insights live in the live workspace state
  // (mirrors `status`); the card self-hides when none are active, and the
  // masonry wrapper is gated on the same count to avoid a dead cardGap margin.
  const allInsights: readonly Insight[] = insights ?? [];
  const activeInsightCount = allInsights.filter(
    (i) => i.status === "active" || i.status === "acknowledged",
  ).length;
  const openInsightEntity = (ref: InsightEntityRef) => {
    switch (ref.view) {
      case "milestones": props.onOpenMilestone?.(ref.id); break;
      case "raid": onOpenRaid?.(ref.id); break;
      case "changes": props.onOpenChange?.(ref.id); break;
      case "open-points": onOpenTask?.(ref.id); break;
      default: props.onNavigate?.(ref.view); break;
    }
  };

  return (
    <ReportCard
      lang={lang}
      sizeRef={sizeRef}
      onResetSize={resetSize}
      hideToolbar
    >
      <div className={dc.outer}>
        {/* Landing: greeting + since-you-last-looked. The heading is removed; the
            Print + Reset-size controls are stacked to the RIGHT of this first box. */}
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <DashboardDeltaStrip
              lang={lang}
              delta={delta}
              greeting={greeting}
              onOpenTask={
            // onOpenTask opens a SPECIFIC task editor by id, so only wire it
            // when a representative task exists — otherwise the strip renders
            // the chip as a non-interactive span (no dead -1 click). RAID/
            // milestone/change handlers route to the VIEW (ignore the id), so
            // they stay wired unconditionally below.
            onOpenTask && repTaskId !== undefined ? () => onOpenTask(repTaskId) : undefined
          }
              onOpenRaid={onOpenRaid ? () => onOpenRaid(model.topRaid[0]?.id ?? -1) : undefined}
              onOpenMilestone={props.onOpenMilestone ? () => props.onOpenMilestone!(-1) : undefined}
              onOpenChange={props.onOpenChange ? () => props.onOpenChange!(-1) : undefined}
            />
          </div>
          <div className="flex shrink-0 flex-col gap-2 print:hidden">
            <PrintButton lang={lang} />
            <ResetSizeButton onClick={resetSize} lang={lang} />
          </div>
        </div>

        {/* Tier 0 — read-only status narrative summary (self-hides when empty) */}
        <NarrativeSummary lang={lang} status={status} />

        {/* First-open coaching — self-hides once the project has any task */}
        <DashboardCoachingCard lang={lang} ctas={coachingCtas} onNavigate={props.onNavigate ?? (() => {})} />

        {/* Tip of the day — dismissable, rotates daily (per-device) */}
        <DashboardTipCard lang={lang} dc={dc} isPopout={props.isPopout} />

        {/* Weekly status digest — self-hides until enabled (Settings) + generated */}
        <DigestCardConnected
          lang={lang}
          dc={dc}
          model={model}
          raid={props.raid}
          projectId={props.projectId ?? "default"}
          isPopout={props.isPopout ?? false}
        />

        {/* Tier 1 — hero: Overall RAG band + Adjust-health disclosure */}
        <DashboardHero
          lang={lang}
          today={today}
          model={model}
          status={status}
          setStatus={setStatus}
          showBudget={showBudget}
          showChanges={showChanges}
        />

        {/* Masonry — variable-height cards pack via column-fill: balance.
            Order = priority-first (top of column 1 = most important). */}
        <div className={`columns-1 lg:columns-2 xl:columns-3 ${dc.sectionGap}`}>
          <div className={`break-inside-avoid ${dc.cardGap}`}>
            <DashboardKpiStrip lang={lang} model={model} trends={trends} onNavigate={props.onNavigate} dc={dc} />
          </div>
          {topActions?.length ? (
            <div className={`break-inside-avoid ${dc.cardGap}`}>
              <DashboardTopActions lang={lang} topActions={topActions} onOpenAction={onOpenAction} dc={dc} />
            </div>
          ) : null}
          {activeInsightCount > 0 ? (
            <div className={`break-inside-avoid ${dc.cardGap}`}>
              <InsightsCard
                insights={allInsights}
                lang={lang}
                dc={dc}
                actions={props.insightActions}
                generatingId={props.insightGeneratingId}
                aiEnabled={props.insightAiEnabled}
                onOpen={openInsightEntity}
                isPopout={props.isPopout}
              />
            </div>
          ) : null}
          {showRaid && (
            <div className={`break-inside-avoid ${dc.cardGap}`}>
              <RaidRegisterCard lang={lang} topRaid={model.topRaid} onOpenRaid={onOpenRaid} showRaid={showRaid} />
            </div>
          )}
          <div className={`break-inside-avoid ${dc.cardGap}`}>
            <UpcomingCard lang={lang} overdue={model.overdue} dueSoon={model.dueSoon} onOpenTask={onOpenTask} />
          </div>
          <div className={`break-inside-avoid ${dc.cardGap}`}>
            <Section title={t(lang, "dashboardProgress")} boxed>
              <div className="flex flex-wrap gap-2">
                <Tile
                  label={noActiveScope
                    ? t(lang, "dashboardNoActiveScope")
                    : t(lang, "dashboardPercentComplete", String(model.progress.percent))}
                  value={noActiveScope
                    ? t(lang, "dashboardAllCancelled", String(model.progress.total))
                    : t(lang, "dashboardCompletedOf", String(model.progress.completed), String(model.progress.inScope))}
                  onActivate={props.onNavigate ? () => props.onNavigate!("open-points") : undefined}
                  activateLabel={noActiveScope
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
                    </span>
                  }
                  onActivate={props.onNavigate ? () => props.onNavigate!("open-points") : undefined}
                  activateLabel={`R / A / G – ${t(lang, "dashboardOpenTasksView")}`}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{t(lang, "dashboardProgressCaption")}</p>
            </Section>
          </div>
          {/* Trends — masonry card after Progress; Turso-only. Clicking jumps to the Trends view. */}
          {props.tursoActive ? (
            <div className={`break-inside-avoid ${dc.cardGap}`}>
              {(() => {
                const trendsBody = (
                  <>
                    <h3 className="mb-2 text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
                      {t(lang, "navTrends")}
                    </h3>
                    {varianceRows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t(lang, "dashboardTrendsNoBaseline")}</p>
                    ) : (
                      <VarianceSummary variance={varianceRows} lang={lang} />
                    )}
                  </>
                );
                return props.onNavigate ? (
                  <button
                    type="button"
                    aria-label={t(lang, "dashboardOpenTrendsView")}
                    onClick={() => props.onNavigate!("trends")}
                    className={`block w-full rounded-lg border border-line bg-surface text-left shadow-[var(--shadow-card)] hover:border-ui-dark-blue ${INTERACTIVE} ${dc.cardPad}`}
                  >
                    {trendsBody}
                  </button>
                ) : (
                  <Card boxed className={dc.cardPad}>
                    {trendsBody}
                  </Card>
                );
              })()}
            </div>
          ) : null}
          {showBudget && (
            <div className={`break-inside-avoid ${dc.cardGap}`}>
              <Section title={t(lang, "dashboardBudgetBurn")} boxed>
                {model.burn ? (
                  <div className="flex flex-wrap gap-2">
                    <Tile
                      label={t(lang, "dashboardSubBudget")} hint={t(lang, "dashboardBudgetHint")}
                      value={`${money(model.burn.consumedValue)} / ${money(model.burn.budgetValue)}`}
                      rag={<RagBadge value={ratioHealth(model.burn.consumedValue, model.burn.budgetValue)} lang={lang} title={t(lang, "dashboardSubBudget")} />}
                      onActivate={props.onNavigate ? () => props.onNavigate!("budget") : undefined}
                      activateLabel={`${t(lang, "dashboardSubBudget")} – ${t(lang, "dashboardOpenBudgetView")}`}
                    />
                    <Tile
                      label="h" hint={t(lang, "dashboardHoursHint")}
                      value={`${Math.round(model.burn.actualHours)} / ${Math.round(model.burn.budgetHours)}`}
                      rag={<RagBadge value={ratioHealth(model.burn.actualHours, model.burn.budgetHours)} lang={lang} title="h" />}
                      onActivate={props.onNavigate ? () => props.onNavigate!("budget") : undefined}
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
                      onActivate={props.onNavigate ? () => props.onNavigate!("budget") : undefined}
                      activateLabel={`${t(lang, "evmSpi")} – ${t(lang, "dashboardOpenBudgetView")}`}
                    />
                    <Tile
                      label={t(lang, "evmCpi")} hint={t(lang, "evmCpiHint")}
                      value={model.evm.cpi != null ? model.evm.cpi.toFixed(2) : "—"}
                      onActivate={props.onNavigate ? () => props.onNavigate!("budget") : undefined}
                      activateLabel={`${t(lang, "evmCpi")} – ${t(lang, "dashboardOpenBudgetView")}`}
                    />
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">{t(lang, "evmNoEstimates")}</p>
                )}
                {model.burndown ? (
                  <div className="mt-3">
                    <BurndownChainWarning lang={lang} chain={model.bucketChain} />
                    <BurndownCharts series={model.burndown} lang={lang} currency={props.plan.currency || "EUR"} />
                  </div>
                ) : null}
                {model.burn ? (
                  <p className="mt-2 text-xs text-muted-foreground">{t(lang, "dashboardBurnCaption")}</p>
                ) : null}
              </Section>
            </div>
          )}
          {showMilestones && (
            <div className={`break-inside-avoid ${dc.cardGap}`}>
              <Section title={t(lang, "dashboardMilestones")} boxed>
                <MilestoneHorizonStrip lang={lang} buckets={milestoneBuckets} onOpenMilestone={props.onOpenMilestone} />
              </Section>
            </div>
          )}
          {showChanges && (
            <div className={`break-inside-avoid ${dc.cardGap}`}>
              <Section title={t(lang, "dashboardChangesHeading")} boxed>
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
                          {props.onOpenChange ? (
                            <button
                              type="button"
                              aria-label={t(lang, "dashboardOpenChangeItem", c.title)}
                              onClick={() => props.onOpenChange!(c.id)}
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
              </Section>
            </div>
          )}
          {/* Completion-trend sparkline — self-hides without >= 2 points, and
              is suppressed outright when there is no active scope. It renders
              directly beneath the completion tile, so an all-cancelled project
              would otherwise show a flat 0% trajectory under a tile reading
              "No active scope": the same one-screen disagreement the
              at-a-glance KPI card had to be fixed for. ★ "Beneath" is reading
              order, not adjacency — this is a `column-fill: balance` multicolumn
              flow, so which cards sit next to which depends on the viewport and
              nothing here can promise a neighbour.
              ★ The snapshot-fed series does NOT go to
              zero on its own — `fromSnapshots` reads each record's stored
              `pctComplete` and never consults `inScope` — so this is a real
              suppression on that path, not a no-op dressed up as a guard. */}
          {completionSeries.length >= 2 && !noActiveScope && (
            <div className={`break-inside-avoid ${dc.cardGap}`}>
              {(() => {
                const sparkBody = (
                  <>
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        {t(lang, "dashboardCompletionTrend")}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {t(lang, "dashboardCompletionTrendPoints", completionSeries.length)}
                      </span>
                    </div>
                    <Sparkline
                      points={completionSeries}
                      ariaLabel={t(
                        lang,
                        "dashboardCompletionTrendAria",
                        completionSeries[completionSeries.length - 1].percent,
                        completionSeries[0].percent,
                        completionSeries.length,
                      )}
                    />
                  </>
                );
                const trendView = props.tursoActive ? "trends" : "open-points";
                return props.onNavigate ? (
                  <button
                    type="button"
                    aria-label={t(lang, props.tursoActive ? "dashboardOpenTrendsView" : "dashboardOpenTasksView")}
                    onClick={() => props.onNavigate!(trendView)}
                    className={`block w-full rounded border border-line bg-surface text-left shadow-[var(--shadow-card)] hover:border-ui-dark-blue ${INTERACTIVE} ${dc.cardPad}`}
                  >
                    {sparkBody}
                  </button>
                ) : (
                  <div className={`rounded border border-line bg-surface shadow-[var(--shadow-card)] ${dc.cardPad}`}>{sparkBody}</div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Tier 3 — folded status-summary editor */}
        <NarrativeEditor lang={lang} status={status} setStatus={setStatus} />
      </div>
    </ReportCard>
  );
}
