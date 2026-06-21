"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ReportCard, Section, Tile } from "./report-table";
import { computeDashboard } from "./dashboard";
import { RegistersBand } from "./dashboard-sections/registers-band";
import { useWorkspace } from "./workspace-context";
import { loadActivityLog, type ActivityEntry } from "./activity-log";
import { type Lang, t, localeFor, type TranslationKey } from "./i18n";
import { healthColorName, healthText, type Health } from "./health";
import { ratioHealth } from "./budget-health";
import { changeImpactRag } from "./change-log";
import type { Absence, BudgetBucket, ChangeItem, ChangeStatus, Milestone, RaidItem, ResourcePlan, Resource, Role, Task } from "./types";
import { formatCurrency } from "./resource-cost";
import { RagBadge } from "./rag-badge";
import { BurndownCharts } from "./burndown-chart";
import { ActionRow } from "./action-row";
import type { SuggestedAction } from "./next-actions/types";
import { useResizable } from "./use-resizable";
import { VarianceSummary } from "./variance-summary";
import type { VarianceRow } from "./snapshot";
import { useLandingDelta } from "./use-landing-delta";
import { buildGreeting, type RagScope } from "./dashboard-delta";
import { DashboardDeltaStrip } from "./dashboard-delta-strip";
import { TrendArrow } from "./trend-arrow";
import { bucketMilestonesByHorizon } from "./milestones";
import { MilestoneHorizonStrip } from "./milestone-horizon-strip";
import { computeCoaching } from "./dashboard-coaching";
import { DashboardCoachingCard } from "./dashboard-coaching-card";
import type { AppView } from "./nav-config";

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
  onOpenMilestone?: () => void;
  showRaid?: boolean;
  showBudget?: boolean;
  showMilestones?: boolean;
  showChanges?: boolean;
  topActions?: readonly SuggestedAction[];
  onOpenAction?: (a: SuggestedAction) => void;
  showTrends?: boolean;
  onToggleTrends?: (show: boolean) => void;
  variance?: readonly VarianceRow[];
  tursoActive?: boolean;
  projectId?: string;
  isPopout?: boolean;
  onOpenChange?: () => void;
  onNavigate?: (view: AppView) => void;
  aiConfigured?: boolean;
}

const CHANGE_STATUS_KEY: Record<ChangeStatus, TranslationKey> = {
  Proposed: "changeStatusProposed",
  "Under Review": "changeStatusUnderReview",
  Approved: "changeStatusApproved",
  Rejected: "changeStatusRejected",
  Implemented: "changeStatusImplemented",
  Deferred: "changeStatusDeferred",
};

function OverrideSelect({
  lang, label, value, computed, effective, onChange,
}: {
  lang: Lang;
  label: string;
  value: "R" | "A" | "G" | undefined;
  computed: Health | null;
  effective: Health | null;
  onChange: (v: "R" | "A" | "G" | undefined) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-sm">
      <RagBadge value={effective} lang={lang} title={`${label}: ${effective ? healthColorName(effective, lang) : "—"}`} />
      <span className="font-medium">{label}</span>
      <select
        className="rounded border border-line bg-surface px-1.5 py-0.5 text-sm print:hidden"
        value={value ?? ""}
        onChange={(e) => onChange((e.target.value || undefined) as "R" | "A" | "G" | undefined)}
      >
        <option value="">{computed ? t(lang, "dashboardComputedHint", healthColorName(computed, lang)) : t(lang, "dashboardScopeUnset")}</option>
        <option value="R">{healthColorName("R", lang)}</option>
        <option value="A">{healthColorName("A", lang)}</option>
        <option value="G">{healthColorName("G", lang)}</option>
      </select>
      <span className="hidden text-muted-foreground print:inline">
        {effective ? healthColorName(effective, lang) : "—"}
      </span>
    </label>
  );
}

export function DashboardPanel(props: DashboardPanelProps) {
  const { lang, today, onOpenRaid, onOpenTask, topActions, onOpenAction } = props;
  const { showRaid = true, showBudget = true, showMilestones = true, showChanges = true } = props;
  const showTrends = props.showTrends !== false;
  const varianceRows = props.variance ?? [];
  const { status, setStatus } = useWorkspace();
  const { ref: sizeRef, reset: resetSize } = useResizable("lop-app:dashboard-size");

  const locale = localeFor(lang);
  const money = (n: number) => formatCurrency(n, props.plan.currency || "EUR", locale);

  const [activity] = useState<ActivityEntry[]>(() => loadActivityLog());

  const model = useMemo(
    () =>
      computeDashboard({
        tasks: props.tasks,
        raid: showRaid ? props.raid : [],
        budgets: showBudget ? props.budgets : [],
        plan: props.plan,
        roles: props.roles,
        resources: props.resources,
        absences: props.absences,
        workdayHours: props.workdayHours,
        holidaySet: props.holidaySet,
        status,
        activity,
        today,
        milestones: showMilestones ? (props.milestones ?? []) : [],
        changes: showChanges ? (props.changes ?? []) : [],
      }),
    [
      props.tasks, props.raid, props.budgets, props.plan,
      props.roles, props.resources, props.absences,
      props.workdayHours, props.holidaySet,
      props.milestones, props.changes,
      showRaid, showBudget, showMilestones, showChanges,
      status, activity, today,
    ],
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

  // Derived-state pattern: track the last stored value we seeded from so we can
  // reset the draft when an external workspace reload changes status.narrative.
  const [prevStoredNarrative, setPrevStoredNarrative] = useState(status.narrative ?? "");
  const [draftNarrative, setDraftNarrative] = useState(status.narrative ?? "");

  const storedNarrative = status.narrative ?? "";
  if (storedNarrative !== prevStoredNarrative) {
    setPrevStoredNarrative(storedNarrative);
    setDraftNarrative(storedNarrative);
  }

  // Autogrow: keep the status textarea sized to its content. Applied on input
  // and whenever the draft value changes (e.g. external reload / Clear).
  const narrativeRef = useRef<HTMLTextAreaElement | null>(null);
  const resizeNarrative = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(() => {
    if (narrativeRef.current) resizeNarrative(narrativeRef.current);
  }, [draftNarrative]);

  const commitNarrative = () => {
    const trimmed = draftNarrative.trim();
    if (trimmed === (status.narrative ?? "")) return;
    setStatus((s) => ({ ...s, narrative: trimmed, narrativeUpdatedAt: new Date().toISOString() }));
  };

  const clearNarrative = () => {
    setDraftNarrative("");
    if ((status.narrative ?? "") !== "") {
      setStatus((s) => ({ ...s, narrative: "", narrativeUpdatedAt: new Date().toISOString() }));
    }
    // Reset the box back to its default (min-h-24) resting height immediately so it
    // never stays stuck at a previously-grown tall height. The useEffect([draftNarrative])
    // pass re-measures after the cleared value lands in the DOM; this handler call just
    // avoids any tall-flash window before that runs.
    if (narrativeRef.current) resizeNarrative(narrativeRef.current);
  };

  return (
    <ReportCard lang={lang} sizeRef={sizeRef} onResetSize={resetSize} title={t(lang, "navDashboard")}>
      <div className="space-y-4">
        {/* Landing: greeting + since-you-last-looked */}
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
          onOpenMilestone={props.onOpenMilestone}
          onOpenChange={props.onOpenChange}
        />

        {/* First-open coaching — self-hides once the project has any task */}
        <DashboardCoachingCard lang={lang} ctas={coachingCtas} onNavigate={props.onNavigate ?? (() => {})} />

        {/* At-a-glance KPI strip with trend arrows vs the last visit */}
        <div className="grid grid-cols-3 gap-2">
          <Tile
            label={t(lang, "dashboardKpiComplete")}
            value={`${model.progress.percent}%`}
            trend={<TrendArrow trend={trends.complete} metricLabel={t(lang, "dashboardKpiComplete")} lang={lang} />}
          />
          <Tile
            label={t(lang, "dashboardKpiOverdue")}
            value={String(model.overdue.length)}
            trend={<TrendArrow trend={trends.overdue} metricLabel={t(lang, "dashboardKpiOverdue")} lang={lang} />}
          />
          <Tile
            label={t(lang, "dashboardKpiOpenRaid")}
            value={String(model.openRaidCount)}
            trend={<TrendArrow trend={trends.openRaid} metricLabel={t(lang, "dashboardKpiOpenRaid")} lang={lang} />}
          />
        </div>

        {/* Top actions — promoted to the top so the PM sees what needs them first */}
        {topActions && topActions.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
              {t(lang, "dashboardTopActions")}
            </h3>
            <div className="flex flex-col gap-2">
              {topActions.map((a) => (
                <ActionRow key={a.id} lang={lang} action={a} onOpen={onOpenAction ?? (() => {})} />
              ))}
            </div>
          </section>
        )}

        {/* Overall band */}
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-surface p-4">
          <div className="flex items-center gap-2 text-2xl font-bold">
            <RagBadge value={model.overall.effective} lang={lang} />
            {t(lang, "dashboardOverall")}:{" "}
            <span className={model.overall.effective ? healthText[model.overall.effective] : ""}>
              {healthColorName(model.overall.effective, lang)}
            </span>
          </div>
          <details className="basis-full print:hidden">
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
              {t(lang, "dashboardAdjustHealth")}
            </summary>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <OverrideSelect
                lang={lang}
                label={t(lang, "dashboardOverall")}
                value={status.ragOverride}
                computed={model.overall.computed}
                effective={model.overall.effective}
                onChange={(v) => setStatus((s) => ({ ...s, ragOverride: v }))}
              />
              <OverrideSelect
                lang={lang}
                label={t(lang, "dashboardSubSchedule")}
                value={status.scheduleOverride}
                computed={model.schedule.computed}
                effective={model.schedule.effective}
                onChange={(v) => setStatus((s) => ({ ...s, scheduleOverride: v }))}
              />
              {showBudget && (
                <OverrideSelect
                  lang={lang}
                  label={t(lang, "dashboardSubBudget")}
                  value={status.budgetOverride}
                  computed={model.budget.computed}
                  effective={model.budget.effective}
                  onChange={(v) => setStatus((s) => ({ ...s, budgetOverride: v }))}
                />
              )}
              {showChanges && (
                <OverrideSelect
                  lang={lang}
                  label={t(lang, "dashboardSubScope")}
                  value={status.scopeOverride}
                  computed={null}
                  effective={model.scope.effective}
                  onChange={(v) => setStatus((s) => ({ ...s, scopeOverride: v }))}
                />
              )}
            </div>
          </details>
          {props.onToggleTrends && (
            <button
              type="button"
              aria-label={t(lang, showTrends ? "dashboardHideTrends" : "dashboardShowTrends")}
              aria-pressed={showTrends}
              title={t(lang, showTrends ? "dashboardHideTrends" : "dashboardShowTrends")}
              onClick={() => props.onToggleTrends?.(!showTrends)}
              className="ml-auto rounded-md border border-line bg-surface px-2 py-1 text-xs text-muted-foreground hover:bg-surface-muted print:hidden"
            >
              {t(lang, showTrends ? "dashboardHideTrends" : "dashboardShowTrends")}
            </button>
          )}
          <span className={`${props.onToggleTrends ? "" : "ml-auto "}text-sm text-muted-foreground`}>
            {t(lang, "dashboardReportDate", today)}
          </span>
          <p className="basis-full text-xs text-muted-foreground">
            {t(lang, "dashboardRagThresholds")}
          </p>
        </div>

        {/* Narrative */}
        <Section title={t(lang, "dashboardStatusSummary")}>
          <div>
            <textarea
              ref={narrativeRef}
              className="min-h-24 w-full resize-none rounded-md border border-line bg-surface p-2 text-sm"
              placeholder={t(lang, "dashboardNarrativePlaceholder")}
              value={draftNarrative}
              onChange={(e) => setDraftNarrative(e.target.value)}
              onInput={(e) => resizeNarrative(e.currentTarget)}
              onBlur={commitNarrative}
            />
            <div className="mt-2 flex justify-end gap-2 print:hidden">
              <button
                type="button"
                onClick={commitNarrative}
                disabled={draftNarrative.trim() === (status.narrative ?? "")}
                className="rounded-md bg-AIPM-dark-blue px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t(lang, "dashboardStatusSave")}
              </button>
              <button
                type="button"
                onClick={clearNarrative}
                onMouseDown={(e) => e.preventDefault()}
                disabled={(status.narrative ?? "") === "" && draftNarrative === ""}
                className="rounded-md border border-line bg-surface px-3 py-1 text-xs font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t(lang, "dashboardStatusClear")}
              </button>
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {status.narrativeUpdatedAt
              ? t(lang, "dashboardNarrativeUpdated", status.narrativeUpdatedAt.slice(0, 10))
              : ""}
          </p>
        </Section>

        {/* Progress + Budget burn */}
        <div className="grid gap-4 md:grid-cols-2">
          <Section title={t(lang, "dashboardProgress")} boxed>
            <div className="flex flex-wrap gap-2">
              <Tile
                label={t(lang, "dashboardPercentComplete", String(model.progress.percent))}
                value={t(lang, "dashboardCompletedOf", String(model.progress.completed), String(model.progress.total))}
              />
              <Tile
                label="R / A / G"
                value={
                  <span>
                    <span className={healthText.R}>{model.progress.counts.R}</span>
                    {" / "}
                    <span className={healthText.A}>{model.progress.counts.A}</span>
                    {" / "}
                    <span className={healthText.G}>{model.progress.counts.G}</span>
                  </span>
                }
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t(lang, "dashboardProgressCaption")}</p>
          </Section>
          {showBudget && (
            <Section title={t(lang, "dashboardBudgetBurn")} boxed>
              {model.burn ? (
                <div className="flex flex-wrap gap-2">
                  <Tile
                    label={t(lang, "dashboardSubBudget")}
                    value={`${money(model.burn.consumedValue)} / ${money(model.burn.budgetValue)}`}
                    rag={<RagBadge value={ratioHealth(model.burn.consumedValue, model.burn.budgetValue)} lang={lang} title={t(lang, "dashboardSubBudget")} />}
                  />
                  <Tile
                    label="h"
                    value={`${Math.round(model.burn.actualHours)} / ${Math.round(model.burn.budgetHours)}`}
                    rag={<RagBadge value={ratioHealth(model.burn.actualHours, model.burn.budgetHours)} lang={lang} title="h" />}
                  />
                  <Tile
                    label={t(lang, "evmCpi")}
                    value={model.evm.cpi != null ? model.evm.cpi.toFixed(2) : "—"}
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t(lang, "dashboardNoBudget")}</p>
              )}
              {model.evm.coverage.withEstimate > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Tile label={t(lang, "evmSpi")} value={model.evm.spi != null ? model.evm.spi.toFixed(2) : "—"} />
                  <Tile label={t(lang, "evmCpi")} value={model.evm.cpi != null ? model.evm.cpi.toFixed(2) : "—"} />
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">{t(lang, "evmNoEstimates")}</p>
              )}
              {model.burndown ? (
                <div className="mt-3">
                  <BurndownCharts series={model.burndown} lang={lang} currency={props.plan.currency || "EUR"} />
                </div>
              ) : null}
              {model.burn ? (
                <p className="mt-2 text-xs text-muted-foreground">{t(lang, "dashboardBurnCaption")}</p>
              ) : null}
            </Section>
          )}
        </div>

        {/* RAID + upcoming tasks + Milestones */}
        <RegistersBand
          lang={lang}
          topRaid={model.topRaid}
          overdue={model.overdue}
          dueSoon={model.dueSoon}
          onOpenRaid={onOpenRaid}
          onOpenTask={onOpenTask}
          showRaid={showRaid}
        />

        {/* Milestones + Changes (side-by-side on large screens) */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {showMilestones && (
            <Section title={t(lang, "dashboardMilestones")} boxed>
              <MilestoneHorizonStrip lang={lang} buckets={milestoneBuckets} onOpenMilestone={props.onOpenMilestone} />
            </Section>
          )}
          {showChanges && (
            <Section title={t(lang, "dashboardChangesHeading")} boxed>
              <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                {t(lang, "dashboardChangesPending", String(model.changes.pending))}
              </p>
              {model.topChanges.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t(lang, "dashboardChangesEmpty")}</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {model.topChanges.map((c) => (
                    <li key={c.id} className="flex items-center gap-2">
                      <RagBadge value={changeImpactRag(c.impact)} lang={lang} />
                      <span className="text-muted-foreground">#{c.id}</span>
                      <span className="font-medium">{c.title}</span>
                      <span className="text-muted-foreground">· {t(lang, CHANGE_STATUS_KEY[c.status])}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}
        </div>

        {/* Trends widget (toggled from the top toolbar) */}
        {showTrends ? (
          <div className="rounded-lg border border-line bg-surface p-4">
            <h3 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
              {t(lang, "navTrends")}
            </h3>
            {!props.tursoActive ? (
              <p className="text-sm text-muted-foreground">{t(lang, "trendsRequireTurso")}</p>
            ) : varianceRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t(lang, "dashboardTrendsNoBaseline")}</p>
            ) : (
              <VarianceSummary variance={varianceRows} lang={lang} />
            )}
          </div>
        ) : null}

        {/* Recent activity (Top actions now lives at the top of the panel) */}
        <Section title={t(lang, "dashboardRecentActivity")} boxed>
          {model.recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t(lang, "dashboardEmpty")}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {model.recentActivity.map((e) => (
                <li key={e.id} className="text-muted-foreground">
                  {e.timestamp.slice(0, 10)} · {e.kind}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </ReportCard>
  );
}
