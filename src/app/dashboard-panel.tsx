"use client";

import { useMemo, useRef, useState } from "react";
import { ReportCard, Section, Tile } from "./report-table";
import { computeDashboard } from "./dashboard";
import { RegistersBand } from "./dashboard-sections/registers-band";
import { useWorkspace } from "./workspace-context";
import { loadActivityLog, type ActivityEntry } from "./activity-log";
import { type Lang, t, localeFor } from "./i18n";
import { healthColorName, healthText, type Health } from "./health";
import type { Absence, BudgetBucket, Milestone, RaidItem, ResourcePlan, Resource, Role, Task } from "./types";
import { formatCurrency } from "./resource-cost";
import { RagBadge } from "./rag-badge";
import { BurndownCharts } from "./burndown-chart";

interface DashboardPanelProps {
  lang: Lang;
  tasks: Task[];
  raid: RaidItem[];
  budgets: BudgetBucket[];
  plan: ResourcePlan;
  roles: Role[];
  resources: Resource[];
  absences: Absence[];
  holidaySet: ReadonlySet<string>;
  workdayHours: number;
  today: string;
  milestones?: Milestone[];
  onOpenRaid?: (id: number) => void;
  onOpenTask?: (id: number) => void;
  onOpenMilestone?: () => void;
}

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
  const { lang, today, onOpenRaid, onOpenTask } = props;
  const { status, setStatus } = useWorkspace();
  const sizeRef = useRef<HTMLDivElement | null>(null);

  const locale = localeFor(lang);
  const money = (n: number) => formatCurrency(n, props.plan.currency || "EUR", locale);

  const [activity] = useState<ActivityEntry[]>(() => loadActivityLog());

  const model = useMemo(
    () =>
      computeDashboard({
        tasks: props.tasks,
        raid: props.raid,
        budgets: props.budgets,
        plan: props.plan,
        roles: props.roles,
        resources: props.resources,
        absences: props.absences,
        workdayHours: props.workdayHours,
        holidaySet: props.holidaySet,
        status,
        activity,
        today,
        milestones: props.milestones ?? [],
      }),
    [
      props.tasks, props.raid, props.budgets, props.plan,
      props.roles, props.resources, props.absences,
      props.workdayHours, props.holidaySet,
      props.milestones,
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
          <OverrideSelect
            lang={lang}
            label={t(lang, "dashboardSubBudget")}
            value={status.budgetOverride}
            computed={model.budget.computed}
            effective={model.budget.effective}
            onChange={(v) => setStatus((s) => ({ ...s, budgetOverride: v }))}
          />
          <OverrideSelect
            lang={lang}
            label={t(lang, "dashboardSubScope")}
            value={status.scopeOverride}
            computed={null}
            effective={model.scope.effective}
            onChange={(v) => setStatus((s) => ({ ...s, scopeOverride: v }))}
          />
          <span className="ml-auto text-sm text-muted-foreground">
            {t(lang, "dashboardReportDate", today)}
          </span>
          <p className="basis-full text-xs text-muted-foreground">
            {t(lang, "dashboardRagThresholds")}
          </p>
        </div>

        {/* Narrative */}
        <Section title={t(lang, "dashboardStatusSummary")}>
          <textarea
            className="min-h-24 w-full rounded-md border border-line bg-surface p-2 text-sm"
            placeholder={t(lang, "dashboardNarrativePlaceholder")}
            value={draftNarrative}
            onChange={(e) => setDraftNarrative(e.target.value)}
            onBlur={commitNarrative}
          />
          {status.narrativeUpdatedAt ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t(lang, "dashboardNarrativeUpdated", status.narrativeUpdatedAt.slice(0, 10))}
            </p>
          ) : null}
        </Section>

        {/* Progress + Budget burn */}
        <div className="grid gap-4 md:grid-cols-2">
          <Section title={t(lang, "dashboardProgress")}>
            <div className="flex flex-wrap gap-2">
              <Tile
                label={t(lang, "dashboardPercentComplete", String(model.progress.percent))}
                value={t(lang, "dashboardCompletedOf", String(model.progress.completed), String(model.progress.total))}
              />
              <Tile label="R / A / G" value={`${model.progress.counts.R} / ${model.progress.counts.A} / ${model.progress.counts.G}`} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t(lang, "dashboardProgressCaption")}</p>
          </Section>
          <Section title={t(lang, "dashboardBudgetBurn")}>
            {model.burn ? (
              <div className="flex flex-wrap gap-2">
                <Tile
                  label={t(lang, "dashboardSubBudget")}
                  value={`${money(model.burn.consumedValue)} / ${money(model.burn.budgetValue)}`}
                />
                <Tile
                  label="h"
                  value={`${Math.round(model.burn.actualHours)} / ${Math.round(model.burn.budgetHours)}`}
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
            <p className="mt-2 text-xs text-muted-foreground">{t(lang, "dashboardBurnCaption")}</p>
          </Section>
        </div>

        {/* RAID + upcoming tasks */}
        <RegistersBand
          lang={lang}
          topRaid={model.topRaid}
          overdue={model.overdue}
          dueSoon={model.dueSoon}
          onOpenRaid={onOpenRaid}
          onOpenTask={onOpenTask}
          overdueMilestones={model.overdueMilestones}
          atRiskMilestones={model.atRiskMilestones}
          dueSoonMilestones={model.dueSoonMilestones}
          onOpenMilestone={props.onOpenMilestone}
        />

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
    </ReportCard>
  );
}
