"use client";

import { useMemo, useRef, useState } from "react";
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
  const { status, setStatus } = useWorkspace();
  const sizeRef = useRef<HTMLDivElement | null>(null);

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

  // Derived-state pattern: track the last stored value we seeded from so we can
  // reset the draft when an external workspace reload changes status.narrative.
  const [prevStoredNarrative, setPrevStoredNarrative] = useState(status.narrative ?? "");
  const [draftNarrative, setDraftNarrative] = useState(status.narrative ?? "");

  const storedNarrative = status.narrative ?? "";
  if (storedNarrative !== prevStoredNarrative) {
    setPrevStoredNarrative(storedNarrative);
    setDraftNarrative(storedNarrative);
  }

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
  };

  return (
    <ReportCard lang={lang} sizeRef={sizeRef} onResetSize={() => undefined} title={t(lang, "navDashboard")}>
      <div className="space-y-4">
        {/* Overall band */}
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-surface p-4">
          <div className="flex items-center gap-2 text-2xl font-bold">
            <RagBadge value={model.overall.effective} lang={lang} />
            {t(lang, "dashboardOverall")}:{" "}
            <span className={model.overall.effective ? healthText[model.overall.effective] : ""}>
              {healthColorName(model.overall.effective, lang)}
            </span>
          </div>
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
          <span className="ml-auto text-sm text-muted-foreground">
            {t(lang, "dashboardReportDate", today)}
          </span>
          <p className="basis-full text-xs text-muted-foreground">
            {t(lang, "dashboardRagThresholds")}
          </p>
        </div>

        {/* Narrative */}
        <Section title={t(lang, "dashboardStatusSummary")}>
          <div className="flex items-stretch gap-2">
            <textarea
              className="min-h-24 min-w-0 flex-1 resize-none rounded-md border border-line bg-surface p-2 text-sm"
              placeholder={t(lang, "dashboardNarrativePlaceholder")}
              value={draftNarrative}
              onChange={(e) => setDraftNarrative(e.target.value)}
              onBlur={commitNarrative}
            />
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={commitNarrative}
                disabled={draftNarrative.trim() === (status.narrative ?? "")}
                className="rounded-md bg-AIPM-dark-blue px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 print:hidden"
              >
                {t(lang, "dashboardStatusSave")}
              </button>
              <button
                type="button"
                onClick={clearNarrative}
                onMouseDown={(e) => e.preventDefault()}
                disabled={(status.narrative ?? "") === "" && draftNarrative === ""}
                className="rounded-md border border-line bg-surface px-3 py-1 text-xs font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 print:hidden"
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
              {model.overdueMilestones.length + model.atRiskMilestones.length + model.dueSoonMilestones.length === 0 ? (
                <p className="text-sm text-muted-foreground">—</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {[...model.overdueMilestones, ...model.atRiskMilestones, ...model.dueSoonMilestones].map((m) => (
                    <li key={m.id}>
                      {props.onOpenMilestone ? (
                        <button
                          type="button"
                          className="rounded-md border border-transparent px-2 py-0.5 text-left text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted"
                          onClick={() => props.onOpenMilestone!()}
                        >
                          {model.atRiskMilestones.includes(m) ? "⚠ " : ""}{m.name} · {m.date}
                        </button>
                      ) : (
                        <span>{model.atRiskMilestones.includes(m) ? "⚠ " : ""}{m.name} · {m.date}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
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

        {/* Top actions + Recent activity (side-by-side on large screens) */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Top actions */}
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
          {/* Recent activity */}
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
      </div>
    </ReportCard>
  );
}
