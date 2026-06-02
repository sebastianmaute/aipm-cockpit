"use client";

import { useMemo, useRef, useState } from "react";
import { ReportCard, Section, Tile } from "./report-table";
import { computeDashboard } from "./dashboard";
import { RegistersBand } from "./dashboard-sections/registers-band";
import { useWorkspace } from "./workspace-context";
import { loadActivityLog, type ActivityEntry } from "./activity-log";
import { type Lang, t } from "./i18n";
import { healthColorName, type Health } from "./health";
import type { Absence, BudgetBucket, RaidItem, ResourcePlan, Resource, Role, Task } from "./types";

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
  onOpenRaid?: (id: number) => void;
  onOpenTask?: (id: number) => void;
}

function OverrideSelect({
  lang, label, value, computed, onChange,
}: {
  lang: Lang;
  label: string;
  value: "R" | "A" | "G" | undefined;
  computed: Health | null;
  onChange: (v: "R" | "A" | "G" | undefined) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <select
        className="rounded border border-line bg-surface px-1.5 py-0.5 text-sm"
        value={value ?? ""}
        onChange={(e) => onChange((e.target.value || undefined) as "R" | "A" | "G" | undefined)}
      >
        <option value="">{computed ? t(lang, "dashboardComputedHint", healthColorName(computed, lang)) : t(lang, "dashboardScopeUnset")}</option>
        <option value="R">{healthColorName("R", lang)}</option>
        <option value="A">{healthColorName("A", lang)}</option>
        <option value="G">{healthColorName("G", lang)}</option>
      </select>
    </label>
  );
}

export function DashboardPanel(props: DashboardPanelProps) {
  const { lang, today, onOpenRaid, onOpenTask } = props;
  const { status, setStatus } = useWorkspace();
  const sizeRef = useRef<HTMLDivElement | null>(null);

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
        milestones: [], // TODO: wire real milestones in a later task
      }),
    [
      props.tasks, props.raid, props.budgets, props.plan,
      props.roles, props.resources, props.absences,
      props.workdayHours, props.holidaySet,
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
          <div className="text-2xl font-bold">
            {t(lang, "dashboardOverall")}: {healthColorName(model.overall.effective, lang)}
          </div>
          <OverrideSelect
            lang={lang}
            label={t(lang, "dashboardOverall")}
            value={status.ragOverride}
            computed={model.overall.computed}
            onChange={(v) => setStatus((s) => ({ ...s, ragOverride: v }))}
          />
          <OverrideSelect
            lang={lang}
            label={t(lang, "dashboardSubSchedule")}
            value={status.scheduleOverride}
            computed={model.schedule.computed}
            onChange={(v) => setStatus((s) => ({ ...s, scheduleOverride: v }))}
          />
          <OverrideSelect
            lang={lang}
            label={t(lang, "dashboardSubBudget")}
            value={status.budgetOverride}
            computed={model.budget.computed}
            onChange={(v) => setStatus((s) => ({ ...s, budgetOverride: v }))}
          />
          <OverrideSelect
            lang={lang}
            label={t(lang, "dashboardSubScope")}
            value={status.scopeOverride}
            computed={null}
            onChange={(v) => setStatus((s) => ({ ...s, scopeOverride: v }))}
          />
          <span className="ml-auto text-sm text-muted-foreground">
            {t(lang, "dashboardReportDate", today)}
          </span>
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
          </Section>
          <Section title={t(lang, "dashboardBudgetBurn")}>
            {model.burn ? (
              <div className="flex flex-wrap gap-2">
                <Tile
                  label={t(lang, "dashboardSubBudget")}
                  value={`${Math.round(model.burn.consumedValue)} / ${Math.round(model.burn.budgetValue)}`}
                />
                <Tile
                  label="h"
                  value={`${Math.round(model.burn.actualHours)} / ${Math.round(model.burn.budgetHours)}`}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t(lang, "dashboardNoBudget")}</p>
            )}
          </Section>
        </div>

        {/* RAID + upcoming tasks */}
        <RegistersBand lang={lang} topRaid={model.topRaid} overdue={model.overdue} dueSoon={model.dueSoon} onOpenRaid={onOpenRaid} onOpenTask={onOpenTask} />

        {/* Recent activity */}
        <Section title={t(lang, "dashboardRecentActivity")}>
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
