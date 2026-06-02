"use client";

import { useMemo, useRef, useState } from "react";
import { ReportCard, Section, Tile } from "./report-table";
import { computeDashboard } from "./dashboard";
import { HealthPill } from "./dashboard-sections/health-pill";
import { RegistersBand } from "./dashboard-sections/registers-band";
import { useWorkspace } from "./workspace-context";
import { loadActivityLog, type ActivityEntry } from "./activity-log";
import { type Lang, t } from "./i18n";
import { healthColorName } from "./health";
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
}

export function DashboardPanel(props: DashboardPanelProps) {
  const { lang, today } = props;
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
      }),
    [
      props.tasks, props.raid, props.budgets, props.plan,
      props.roles, props.resources, props.absences,
      props.workdayHours, props.holidaySet,
      status, activity, today,
    ],
  );

  const onNarrative = (text: string) =>
    setStatus((s) => ({ ...s, narrative: text, narrativeUpdatedAt: new Date().toISOString() }));

  return (
    <ReportCard lang={lang} sizeRef={sizeRef} onResetSize={() => undefined} title={t(lang, "navDashboard")}>
      <div className="space-y-4">
        {/* Overall band */}
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-surface p-4">
          <div className="text-2xl font-bold">
            {healthColorName(model.overall.effective, lang)}
          </div>
          <HealthPill value={model.schedule.effective} label={t(lang, "dashboardSubSchedule")} lang={lang} />
          <HealthPill value={model.budget.effective} label={t(lang, "dashboardSubBudget")} lang={lang} />
          <HealthPill value={model.scope.effective} label={t(lang, "dashboardSubScope")} lang={lang} />
          <span className="ml-auto text-sm text-muted-foreground">
            {t(lang, "dashboardReportDate", today)}
          </span>
        </div>

        {/* Narrative */}
        <Section title={t(lang, "dashboardStatusSummary")}>
          <textarea
            className="min-h-24 w-full rounded-md border border-line bg-surface p-2 text-sm"
            placeholder={t(lang, "dashboardNarrativePlaceholder")}
            value={model.narrative.text}
            onChange={(e) => onNarrative(e.target.value)}
          />
          {model.narrative.updatedAt ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t(lang, "dashboardNarrativeUpdated", model.narrative.updatedAt.slice(0, 10))}
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
        <RegistersBand lang={lang} topRaid={model.topRaid} overdue={model.overdue} dueSoon={model.dueSoon} />

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
