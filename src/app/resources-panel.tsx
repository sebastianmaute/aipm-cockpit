"use client";

// Resource Planner panel — view shell hosting four tabs.
//
// Four views, switchable via a single SegmentedControl in the header:
//   - "directory" — address-book table (one row per Resource); the name opens
//                   the edit modal, discipline/grade are inline selects.
//                   Rendered by the sibling <ResourceDirectory /> component.
//   - "workload"  — per-assignee stats table (open/overdue counts + upcoming
//                   absences), aggregated from tasks/absences/shifts.
//   - "calendar"  — 30-day grid (rows × days). Rendered by <ResourceCalendar />.
//   - "planning"  — per-period utilization grid (resources × periods) with a
//                   planning-window (start/end date) + granularity (week/month)
//                   control row above the table.
//
// The "workload" view aggregates per assignee: trim + lowercase the assignee
// name so "Alex Example" and "Alex Example" land in the same row; display uses the
// first observed original casing.

import { memo, useMemo, useState } from "react";
import { localeFor } from "./date-format";
import { type Lang, t } from "./i18n";
import { ResourceCalendar } from "./resource-calendar";
import { ResourceDirectory } from "./resource-directory";
import { ResourceWorkload } from "./resource-workload";
import { SegmentedControl } from "./segmented-control";
import { generatePeriods, displayCapacityHours, absencesForResource, absenceWorkdays } from "./resource-capacity";
import { periodCost, formatCurrency } from "./resource-cost";
import {
  type Absence,
  DEFAULT_WEEK_HOURS,
  type Discipline,
  type Grade,
  type Resource,
  type ResourcePlan,
  type Role,
  type Shift,
  type Task,
  type WeekHours,
} from "./types";
import { resourceDisplayName } from "./resource-foundation";

interface Props {
  lang: Lang;
  tasks: readonly Task[];
  absences: readonly Absence[];
  shifts: readonly Shift[];
  resources: readonly Resource[];
  today: string;
  holidaySet: ReadonlySet<string>;
  onAddAbsence: (seed?: Partial<Absence>) => void;
  onEditAbsence: (absence: Absence) => void;
  /** Open the shift modal for a row. `existingShift` is the shift to edit,
   *  or null when the row has no shift yet (modal opens in create mode
   *  pre-filled with the row's assignee). */
  onEditShift: (
    existingShift: Shift | null,
    assignee: { display: string; email: string },
  ) => void;
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
  onManageRoles: () => void;
  onOpenReport: () => void;
  onAssignRole: (resourceId: number, disciplineId: number, gradeId: number) => void;
  plan: ResourcePlan;
  workdayHours: number;
  onSetUtilization: (resourceId: number, periodKey: string, value: number) => void;
  onSetUtilizationMode: (resourceId: number, mode: "percent" | "hours") => void;
  onSetAbsenceOverride: (resourceId: number, periodKey: string, hours: number | null) => void;
  onSetPlanWindow: (startDate: string, endDate: string) => void;
  onSetPlanGranularity: (granularity: "week" | "month") => void;
  onEditResource: (resource: Resource) => void;
  onAddResource: (seed?: Partial<Resource>) => void;
  onOpenAddressBook?: () => void;
}

function GearIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
      <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.53 1.53 0 01-2.29.95c-1.37-.84-2.94.73-2.1 2.1.54.88.07 2.04-.95 2.29-1.56.38-1.56 2.6 0 2.98.99.24 1.49 1.41.95 2.29-.84 1.37.73 2.94 2.1 2.1.88-.54 2.04-.07 2.29.95.38 1.56 2.6 1.56 2.98 0a1.53 1.53 0 012.29-.95c1.37.84 2.94-.73 2.1-2.1a1.53 1.53 0 01.95-2.29c1.56-.38 1.56-2.6 0-2.98a1.53 1.53 0 01-.95-2.29c.84-1.37-.73-2.94-2.1-2.1a1.53 1.53 0 01-2.29-.95zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
    </svg>
  );
}
function ReportIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
      <path d="M15.5 2A1.5 1.5 0 0117 3.5v13A1.5 1.5 0 0115.5 18h-11A1.5 1.5 0 013 16.5v-13A1.5 1.5 0 014.5 2h11zM7 14a1 1 0 10-2 0 1 1 0 002 0zm0-3.5a1 1 0 10-2 0 1 1 0 002 0zM14 6.5A.5.5 0 0013.5 6h-7a.5.5 0 000 1h7a.5.5 0 00.5-.5z" />
    </svg>
  );
}

type View = "directory" | "workload" | "calendar" | "planning";

interface AssigneeRow {
  key: string;          // case-folded join key
  display: string;      // first observed original casing
  email: string;        // first non-empty email observed
  openCount: number;
  overdueCount: number;
  upcoming: Absence[];  // sorted by startDate asc, within 60-day window
  shift: Shift | null;  // matching shift (case-folded join), or null = default
  weeklyHours: number;  // sum of hoursPerWeekday — uses DEFAULT_WEEK_HOURS when shift is null
}

function sumHours(h: WeekHours): number {
  return h.reduce((a, b) => a + (b || 0), 0);
}

const DEFAULT_WEEKLY_HOURS_TOTAL = sumHours(DEFAULT_WEEK_HOURS);

function ResourcesPanelInner({
  lang,
  tasks,
  absences,
  shifts,
  resources,
  today,
  holidaySet,
  onAddAbsence,
  onEditAbsence,
  onEditShift,
  roles,
  disciplines,
  grades,
  onManageRoles,
  onOpenReport,
  onAssignRole,
  plan,
  workdayHours,
  onSetUtilization,
  onSetAbsenceOverride,
  onSetPlanWindow,
  onSetPlanGranularity,
  onEditResource,
  onAddResource,
  onOpenAddressBook,
}: Props) {
  const [view, setView] = useState<View>("directory");
  const [showRollup, setShowRollup] = useState(false);

  const rows = useMemo<AssigneeRow[]>(() => {
    const byKey = new Map<string, AssigneeRow>();
    const upsert = (
      rawAssignee: string,
      rawEmail: string | undefined,
    ): AssigneeRow | null => {
      const trimmed = rawAssignee.trim();
      if (!trimmed) return null;
      const key = trimmed.toLowerCase();
      let row = byKey.get(key);
      if (!row) {
        row = {
          key,
          display: trimmed,
          email: rawEmail?.trim() ?? "",
          openCount: 0,
          overdueCount: 0,
          upcoming: [],
          shift: null,
          weeklyHours: DEFAULT_WEEKLY_HOURS_TOTAL,
        };
        byKey.set(key, row);
      } else if (!row.email && rawEmail) {
        row.email = rawEmail.trim();
      }
      return row;
    };

    // Tasks contribute the assignee + open/overdue counts.
    for (const task of tasks) {
      const row = upsert(task.assignee, task.assigneeEmail);
      if (!row) continue;
      if (!task.completedDate) {
        row.openCount++;
        if (task.dueDate && task.dueDate < today) row.overdueCount++;
      }
    }

    // Absences contribute upcoming (next 60 days) + ensure the assignee
    // exists even if they have no tasks yet.
    const horizon = (() => {
      const d = new Date(today);
      if (Number.isNaN(d.valueOf())) return null;
      d.setUTCDate(d.getUTCDate() + 60);
      return d.toISOString().slice(0, 10);
    })();
    for (const a of absences) {
      const row = upsert(a.assignee, a.assigneeEmail);
      if (!row) continue;
      if (a.endDate < today) continue;
      if (horizon && a.startDate > horizon) continue;
      row.upcoming.push(a);
    }
    // Shifts contribute weekly-hours + ensure the assignee row exists.
    for (const s of shifts) {
      const row = upsert(s.assignee, s.assigneeEmail);
      if (!row) continue;
      row.shift = s;
      row.weeklyHours = sumHours(s.hoursPerWeekday);
    }
    for (const row of byKey.values()) {
      row.upcoming.sort((x, y) => x.startDate.localeCompare(y.startDate));
    }

    return Array.from(byKey.values()).sort((a, b) =>
      a.display.localeCompare(b.display),
    );
  }, [tasks, absences, shifts, today]);

  // Header: title + (when there are rows) view-toggle + "+ Add absence".
  const renderHeader = (showToggle: boolean) => (
    <header className="mb-3 flex shrink-0 items-baseline justify-between gap-2">
      <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
        {t(lang, "tabResources")}
        {rows.length > 0 && (
          <span className="ml-2 text-sm font-normal text-AIPM-medium-grey">
            {t(lang, "tasksCount", rows.length)}
          </span>
        )}
      </h2>
      <div className="flex items-center gap-3">
        {showToggle && (
          <SegmentedControl<View>
            value={view}
            ariaLabel={t(lang, "tabResources")}
            title={t(lang, "resourcesViewHint")}
            options={[
              { value: "directory", label: t(lang, "resourcesViewDirectory") },
              { value: "workload", label: t(lang, "resourcesViewWorkload") },
              { value: "calendar", label: t(lang, "resourcesViewCalendar") },
              { value: "planning", label: t(lang, "resourcesViewPlanning") },
            ]}
            onChange={(v) => setView(v)}
          />
        )}
        <button
          type="button"
          onClick={onManageRoles}
          title={t(lang, "resourcesManageRolesHint")}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-light-grey dark:hover:bg-zinc-800"
        >
          <GearIcon />
          {t(lang, "resourcesManageRoles")}
        </button>
        <button
          type="button"
          onClick={onOpenReport}
          title={t(lang, "resourcesOpenReportHint")}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-light-grey dark:hover:bg-zinc-800"
        >
          <ReportIcon />
          {t(lang, "resourcesOpenReport")}
        </button>
        <button
          type="button"
          onClick={() => onAddAbsence()}
          title={t(lang, "resourcesAddAbsenceHint")}
          className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-AIPM-dark-blue/90"
        >
          {t(lang, "resourcesAddAbsence")}
        </button>
      </div>
    </header>
  );

  const showToggle = true;
  const isEmpty = rows.length === 0 && resources.length === 0;

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      {renderHeader(showToggle)}
      {isEmpty && view !== "planning" && view !== "directory" && (
        <div className="mt-3 flex-1 rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-AIPM-medium-grey dark:border-zinc-800">
          {t(lang, "resourcesEmpty")}
        </div>
      )}
      {view === "planning" && (() => {
        const periods = generatePeriods(plan.startDate, plan.endDate, plan.granularity);
        return (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-1">
                <span>{t(lang, "resourcesPlanStart")}</span>
                <input type="date" aria-label={t(lang, "resourcesPlanStart")} value={plan.startDate}
                  title={t(lang, "resourcesPlanStartHint")}
                  onChange={(e) => onSetPlanWindow(e.target.value, plan.endDate)}
                  className="rounded border border-zinc-300 px-1.5 py-0.5 dark:border-zinc-700 dark:bg-zinc-900" />
              </label>
              <label className="flex items-center gap-1">
                <span>{t(lang, "resourcesPlanEnd")}</span>
                <input type="date" aria-label={t(lang, "resourcesPlanEnd")} value={plan.endDate}
                  title={t(lang, "resourcesPlanEndHint")}
                  onChange={(e) => onSetPlanWindow(plan.startDate, e.target.value)}
                  className="rounded border border-zinc-300 px-1.5 py-0.5 dark:border-zinc-700 dark:bg-zinc-900" />
              </label>
              <SegmentedControl<"week" | "month">
                value={plan.granularity}
                ariaLabel={t(lang, "resourcesViewPlanning")}
                title={t(lang, "resourcesGranularityHint")}
                options={[
                  { value: "month", label: t(lang, "resourcesGranularityMonth") },
                  { value: "week", label: t(lang, "resourcesGranularityWeek") },
                ]}
                onChange={onSetPlanGranularity}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            <table className="text-left text-xs">
              <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900">
                <tr>
                  <th className="px-2 py-1.5 text-left">{t(lang, "assignee")}</th>
                  {periods.map((p) => (
                    <th key={p.key} className="px-2 py-1.5 text-right tabular-nums">{p.key}</th>
                  ))}
                  <th className="px-2 py-1.5 text-right" title={t(lang, "resourcesCapacityDaysHint")}>{t(lang, "resourcesCapacityDays")}</th>
                  <th className="px-2 py-1.5 text-right" title={t(lang, "resourcesInternalCostHint")}>{t(lang, "resourcesInternalCost")}</th>
                  <th className="px-2 py-1.5 text-right" title={t(lang, "resourcesExternalCostHint")}>{t(lang, "resourcesExternalCost")}</th>
                  <th className="px-2 py-1.5 text-right" title={t(lang, "resourcesMarginHint")}>{t(lang, "resourcesMargin")}</th>
                </tr>
              </thead>
              {(() => {
                const loc = localeFor(lang);
                const totals = { days: 0, internal: 0, external: 0, margin: 0 };
                const rowsJsx = resources.map((r) => {
                  const resAbs = absencesForResource(absences, r);
                  const totalHours = periods.reduce((sum, p) =>
                    sum + displayCapacityHours(p, periods, r, resAbs, workdayHours, holidaySet, plan.granularity, plan.granularity), 0);
                  const role = roles.find((x) => x.id === r.roleId);
                  const cost = periodCost(totalHours, role);
                  totals.days += totalHours / workdayHours;
                  totals.internal += cost.internal;
                  totals.external += cost.external;
                  totals.margin += cost.margin;
                  return (
                    <tr key={r.id}>
                      <td className="px-2 py-1 font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">{resourceDisplayName(r)}</td>
                      {periods.map((p) => (
                        <td key={p.key} className="px-1 py-1 text-right align-top">
                          <input type="number" min={0} step={r.utilizationMode === "percent" ? 5 : 1}
                            aria-label={`Utilization for ${resourceDisplayName(r)} in ${p.key}`}
                            title={t(lang, "resourcesUtilizationHint")}
                            value={r.utilization[p.key] ?? ""}
                            onChange={(e) => onSetUtilization(r.id, p.key, Number(e.target.value) || 0)}
                            className="w-16 rounded border border-zinc-300 px-1 py-0.5 text-right tabular-nums dark:border-zinc-700 dark:bg-zinc-900" />
                          <input type="number" min={0} step={1}
                            aria-label={`Absence override for ${resourceDisplayName(r)} in ${p.key}`}
                            title={t(lang, "resourcesAbsenceOverrideHint")}
                            value={r.absenceOverride?.[p.key] ?? ""}
                            placeholder={String(absenceWorkdays(resAbs, p.start, p.end, holidaySet) * workdayHours)}
                            onChange={(e) => onSetAbsenceOverride(r.id, p.key, e.target.value === "" ? null : Number(e.target.value))}
                            className="mt-0.5 w-16 rounded border border-amber-200 px-1 py-0.5 text-right text-[10px] tabular-nums text-amber-700 dark:border-amber-900/50 dark:bg-zinc-900 dark:text-amber-400" />
                        </td>
                      ))}
                      <td className="px-2 py-1 text-right tabular-nums font-medium">{(totalHours / workdayHours).toFixed(1)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatCurrency(cost.internal, plan.currency, loc)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatCurrency(cost.external, plan.currency, loc)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatCurrency(cost.margin, plan.currency, loc)}</td>
                    </tr>
                  );
                });
                return (
                  <>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{rowsJsx}</tbody>
                    <tfoot className="border-t border-zinc-300 dark:border-zinc-700">
                      <tr className="font-semibold">
                        <td className="px-2 py-1.5">{t(lang, "resourcesTotal")}</td>
                        <td className="px-1 py-1.5" colSpan={periods.length} />
                        <td className="px-2 py-1.5 text-right tabular-nums">{totals.days.toFixed(1)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(totals.internal, plan.currency, loc)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(totals.external, plan.currency, loc)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(totals.margin, plan.currency, loc)}</td>
                      </tr>
                    </tfoot>
                  </>
                );
              })()}
            </table>
          </div>
          {(() => {
            const other: "week" | "month" = plan.granularity === "month" ? "week" : "month";
            const rollupPeriods = generatePeriods(plan.startDate, plan.endDate, other);
            return (
              <div className="mt-3">
                <button type="button" onClick={() => setShowRollup((v) => !v)}
                  title={t(lang, "resourcesRollupHint")}
                  className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-light-grey">
                  {showRollup ? t(lang, "resourcesRollupHide") : t(lang, "resourcesRollupShow")}
                </button>
                {showRollup && (
                  <div className="mt-2 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
                    <table className="text-left text-xs">
                      <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900">
                        <tr>
                          <th className="px-2 py-1.5 text-left">{t(lang, "assignee")}</th>
                          {rollupPeriods.map((rp) => (
                            <th key={rp.key} className="px-2 py-1.5 text-right tabular-nums">{rp.key}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {resources.map((r) => {
                          const resAbs2 = absencesForResource(absences, r);
                          return (
                            <tr key={r.id}>
                              <td className="px-2 py-1 font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">{resourceDisplayName(r)}</td>
                              {rollupPeriods.map((rp) => (
                                <td key={rp.key} className="px-2 py-1 text-right tabular-nums text-AIPM-medium-grey">
                                  {(displayCapacityHours(rp, periods, r, resAbs2, workdayHours, holidaySet, plan.granularity, other) / workdayHours).toFixed(1)}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}
          </>
        );
      })()}
      {view === "directory" && (
        <ResourceDirectory
          lang={lang}
          resources={resources}
          roles={roles}
          disciplines={disciplines}
          grades={grades}
          onAssignRole={onAssignRole}
          onEditResource={onEditResource}
          onAddResource={onAddResource}
          onOpenAddressBook={onOpenAddressBook}
        />
      )}
      {view === "workload" && !isEmpty && (
        <ResourceWorkload
          lang={lang}
          resources={resources}
          tasks={tasks}
          absences={absences}
          shifts={shifts}
          today={today}
          onEditResource={onEditResource}
          onAddResource={onAddResource}
          onEditAbsence={onEditAbsence}
          onEditShift={onEditShift}
        />
      )}
      {view === "calendar" && (
        <ResourceCalendar
          lang={lang}
          rows={rows}
          absences={absences}
          today={today}
          holidaySet={holidaySet}
          onAddAbsence={onAddAbsence}
          onEditAbsence={onEditAbsence}
        />
      )}
    </section>
  );
}

export const ResourcesPanel = memo(ResourcesPanelInner);
