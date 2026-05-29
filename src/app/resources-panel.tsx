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
  type PlanGranularity,
  type Resource,
  type ResourcePlan,
  type Role,
  type Shift,
  type Task,
  type WeekHours,
} from "./types";
import { resourceDisplayName } from "./resource-foundation";
import { useColumnResize } from "./use-column-resize";
import { ColumnResizeHandle, ResetColWidthsButton } from "./task-manager-ui";

const PLANNING_COL_WIDTHS = {
  assignee: 160,
  period: 100,
  capacityDays: 110,
  internalCost: 120,
  externalCost: 120,
  margin: 100,
} as const;
type PlanningCol = keyof typeof PLANNING_COL_WIDTHS;

const ROLLUP_COL_WIDTHS = {
  assignee: 160,
  period: 100,
} as const;
type RollupCol = keyof typeof ROLLUP_COL_WIDTHS;

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
  onSetAllUtilizationMode: (mode: "percent" | "hours") => void;
  onSetAbsenceOverride: (resourceId: number, periodKey: string, hours: number | null) => void;
  onSetPlanWindow: (startDate: string, endDate: string) => void;
  onEditResource: (resource: Resource) => void;
  onAddResource: (seed?: Partial<Resource>) => void;
  onOpenAddressBook?: () => void;
  onImportOutlook?: () => void;
  onImportOutlookCalendar?: () => void;
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
  onSetAllUtilizationMode,
  onSetAbsenceOverride,
  onSetPlanWindow,
  onEditResource,
  onAddResource,
  onOpenAddressBook,
  onImportOutlook,
  onImportOutlookCalendar,
}: Props) {
  const planning = useColumnResize<PlanningCol>("planning", PLANNING_COL_WIDTHS);
  const rollup = useColumnResize<RollupCol>("rollup", ROLLUP_COL_WIDTHS);
  const planningStartResize = planning.startColResize as (col: string, e: React.MouseEvent) => void;
  const rollupStartResize = rollup.startColResize as (col: string, e: React.MouseEvent) => void;
  const resetPlanningAndRollup = () => {
    planning.resetColWidths();
    rollup.resetColWidths();
  };

  const [view, setView] = useState<View>("directory");
  const [showRollup, setShowRollup] = useState(false);
  // View granularity controls how the planning grid is sliced for display.
  // It is independent of the plan's CANONICAL (entry) granularity, where
  // utilization is actually stored. Finer views derive from canonical data.
  // When the plan's canonical granularity changes, reset the view to match —
  // done during render (React's "adjusting state on prop change" pattern)
  // rather than in an effect, to avoid cascading renders.
  const [viewGranularity, setViewGranularity] = useState<PlanGranularity>(plan.granularity);
  const [prevPlanGranularity, setPrevPlanGranularity] = useState<PlanGranularity>(plan.granularity);
  if (prevPlanGranularity !== plan.granularity) {
    setPrevPlanGranularity(plan.granularity);
    setViewGranularity(plan.granularity);
  }

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
      <h2 className="text-lg font-medium text-foreground">
        {t(lang, "tabResources")}
        {rows.length > 0 && (
          <span className="ml-2 text-sm font-normal text-muted-foreground">
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
        {view === "planning" && (
          <ResetColWidthsButton onClick={resetPlanningAndRollup} lang={lang} />
        )}
        <button
          type="button"
          onClick={onManageRoles}
          title={t(lang, "resourcesManageRolesHint")}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey"
        >
          <GearIcon />
          {t(lang, "resourcesManageRoles")}
        </button>
        <button
          type="button"
          onClick={onOpenReport}
          title={t(lang, "resourcesOpenReportHint")}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey"
        >
          <ReportIcon />
          {t(lang, "resourcesOpenReport")}
        </button>
        <button
          type="button"
          onClick={() => onAddAbsence()}
          title={t(lang, "resourcesAddAbsenceHint")}
          className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90"
        >
          {t(lang, "resourcesAddAbsence")}
        </button>
        {view === "calendar" && onImportOutlookCalendar && (
          <button
            type="button"
            onClick={onImportOutlookCalendar}
            className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey"
          >
            {t(lang, "outlookCalImportButton")}
          </button>
        )}
      </div>
    </header>
  );

  const showToggle = true;
  const isEmpty = rows.length === 0 && resources.length === 0;

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface p-4 dark:border-line">
      {renderHeader(showToggle)}
      {isEmpty && view !== "planning" && view !== "directory" && (
        <div className="mt-3 flex-1 rounded-md border border-dashed border-line p-6 text-center text-sm text-muted-foreground">
          {t(lang, "resourcesEmpty")}
        </div>
      )}
      {view === "planning" && (() => {
        // CANONICAL (entry) periods — where utilization is stored & edited.
        const canonicalPeriods = generatePeriods(plan.startDate, plan.endDate, plan.granularity);
        // VIEW periods — how the grid is currently sliced for display.
        const periods = generatePeriods(plan.startDate, plan.endDate, viewGranularity);
        // When the view is finer than the entry granularity, cells are derived
        // (read-only): you edit at the entry granularity, finer views borrow.
        // `derived` = the view granularity differs from the entry/canonical granularity,
        // so cells are read-only borrowed values (you edit at the entry granularity).
        const derived = viewGranularity !== plan.granularity;
        return (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-1">
                <span>{t(lang, "resourcesPlanStart")}</span>
                <input type="date" aria-label={t(lang, "resourcesPlanStart")} value={plan.startDate}
                  title={t(lang, "resourcesPlanStartHint")}
                  onChange={(e) => onSetPlanWindow(e.target.value, plan.endDate)}
                  className="rounded border border-line px-1.5 py-0.5 dark:bg-surface" />
              </label>
              <label className="flex items-center gap-1">
                <span>{t(lang, "resourcesPlanEnd")}</span>
                <input type="date" aria-label={t(lang, "resourcesPlanEnd")} value={plan.endDate}
                  title={t(lang, "resourcesPlanEndHint")}
                  onChange={(e) => onSetPlanWindow(plan.startDate, e.target.value)}
                  className="rounded border border-line px-1.5 py-0.5 dark:bg-surface" />
              </label>
              <SegmentedControl<"week" | "month">
                value={viewGranularity}
                ariaLabel={t(lang, "resourcesViewPlanning")}
                title={t(lang, "resourcesGranularityHint")}
                options={[
                  { value: "month", label: t(lang, "resourcesGranularityMonth") },
                  { value: "week", label: t(lang, "resourcesGranularityWeek") },
                ]}
                onChange={setViewGranularity}
              />
              <SegmentedControl<"percent" | "hours">
                value={
                  resources.length > 0 && resources.every((r) => r.utilizationMode === resources[0].utilizationMode)
                    ? resources[0].utilizationMode
                    : "percent"
                }
                ariaLabel={t(lang, "resourcesUtilModeHint")}
                title={t(lang, "resourcesUtilModeHint")}
                options={[
                  { value: "percent", label: t(lang, "resourcesUtilModePercent") },
                  { value: "hours", label: t(lang, "resourcesUtilModeHours") },
                ]}
                onChange={onSetAllUtilizationMode}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded-md border border-line">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th
                    className="relative px-3 py-2 font-medium"
                    style={{ width: planning.colWidths.assignee, minWidth: planning.colWidths.assignee }}
                  >
                    {t(lang, "assignee")}
                    <ColumnResizeHandle col="assignee" onMouseDown={planningStartResize} />
                  </th>
                  {periods.map((p) => (
                    <th
                      key={p.key}
                      className="relative px-3 py-2 text-right font-medium tabular-nums"
                      style={{ width: planning.colWidths.period, minWidth: planning.colWidths.period }}
                    >
                      {p.key}
                      <ColumnResizeHandle col="period" onMouseDown={planningStartResize} />
                    </th>
                  ))}
                  <th
                    className="relative px-3 py-2 text-right font-medium"
                    style={{ width: planning.colWidths.capacityDays, minWidth: planning.colWidths.capacityDays }}
                    title={t(lang, "resourcesCapacityDaysHint")}
                  >
                    {t(lang, "resourcesCapacityDays")}
                    <ColumnResizeHandle col="capacityDays" onMouseDown={planningStartResize} />
                  </th>
                  <th
                    className="relative px-3 py-2 text-right font-medium"
                    style={{ width: planning.colWidths.internalCost, minWidth: planning.colWidths.internalCost }}
                    title={t(lang, "resourcesInternalCostHint")}
                  >
                    {t(lang, "resourcesInternalCost")}
                    <ColumnResizeHandle col="internalCost" onMouseDown={planningStartResize} />
                  </th>
                  <th
                    className="relative px-3 py-2 text-right font-medium"
                    style={{ width: planning.colWidths.externalCost, minWidth: planning.colWidths.externalCost }}
                    title={t(lang, "resourcesExternalCostHint")}
                  >
                    {t(lang, "resourcesExternalCost")}
                    <ColumnResizeHandle col="externalCost" onMouseDown={planningStartResize} />
                  </th>
                  <th
                    className="relative px-3 py-2 text-right font-medium"
                    style={{ width: planning.colWidths.margin, minWidth: planning.colWidths.margin }}
                    title={t(lang, "resourcesMarginHint")}
                  >
                    {t(lang, "resourcesMargin")}
                    <ColumnResizeHandle col="margin" onMouseDown={planningStartResize} />
                  </th>
                </tr>
              </thead>
              {(() => {
                const loc = localeFor(lang);
                const totals = { days: 0, internal: 0, external: 0, margin: 0 };
                const rowsJsx = resources.map((r) => {
                  const resAbs = absencesForResource(absences, r);
                  const totalHours = periods.reduce((sum, p) =>
                    sum + displayCapacityHours(p, canonicalPeriods, r, resAbs, workdayHours, holidaySet, plan.granularity, viewGranularity), 0);
                  const role = roles.find((x) => x.id === r.roleId);
                  const cost = periodCost(totalHours, role);
                  totals.days += totalHours / workdayHours;
                  totals.internal += cost.internal;
                  totals.external += cost.external;
                  totals.margin += cost.margin;
                  return (
                    <tr key={r.id}>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => onEditResource(r)}
                          title={resourceDisplayName(r)}
                          className="rounded-md border border-transparent px-2 py-0.5 text-left font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-AIPM-green dark:text-AIPM-light-grey"
                        >
                          {resourceDisplayName(r)}
                        </button>
                      </td>
                      {periods.map((p) => {
                        // In a derived (finer) view, mirror the engine's borrow
                        // rule: show the containing canonical period's stored
                        // utilization; there is no fine-grained value to edit.
                        const owner = derived
                          ? canonicalPeriods.find((c) => c.start <= p.start && p.start <= c.end)
                          : undefined;
                        const cellValue = derived
                          ? (owner ? (r.utilization[owner.key] ?? "") : "")
                          : (r.utilization[p.key] ?? "");
                        return (
                        <td key={p.key} className="px-3 py-2 text-right align-top">
                          <input type="number" min={0} step={r.utilizationMode === "percent" ? 5 : 1}
                            aria-label={`Utilization for ${resourceDisplayName(r)} in ${p.key}`}
                            title={t(lang, "resourcesUtilizationHint")}
                            value={cellValue}
                            readOnly={derived}
                            onChange={(e) => { if (!derived) onSetUtilization(r.id, p.key, Number(e.target.value) || 0); }}
                            className={`w-16 rounded border border-line px-1 py-0.5 text-right tabular-nums dark:bg-surface${derived ? " bg-surface-muted opacity-60" : ""}`} />
                          <input type="number" min={0} step={1}
                            aria-label={`Absence override for ${resourceDisplayName(r)} in ${p.key}`}
                            title={t(lang, "resourcesAbsenceOverrideHint")}
                            value={derived ? "" : (r.absenceOverride?.[p.key] ?? "")}
                            placeholder={derived ? "" : String(absenceWorkdays(resAbs, p.start, p.end, holidaySet) * workdayHours)}
                            readOnly={derived}
                            onChange={(e) => { if (!derived) onSetAbsenceOverride(r.id, p.key, e.target.value === "" ? null : Number(e.target.value)); }}
                            className={`mt-0.5 w-16 rounded border border-AIPM-purple/40 px-1 py-0.5 text-right text-[10px] tabular-nums text-AIPM-purple dark:border-AIPM-purple/50 dark:bg-surface dark:text-AIPM-purple${derived ? " bg-surface-muted opacity-60" : ""}`} />
                        </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{(totalHours / workdayHours).toFixed(1)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(cost.internal, plan.currency, loc)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(cost.external, plan.currency, loc)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(cost.margin, plan.currency, loc)}</td>
                    </tr>
                  );
                });
                return (
                  <>
                    <tbody className="divide-y divide-line">{rowsJsx}</tbody>
                    <tfoot className="border-t border-line">
                      <tr className="font-semibold">
                        <td className="px-3 py-2">{t(lang, "resourcesTotal")}</td>
                        <td className="px-3 py-2" colSpan={periods.length} />
                        <td className="px-3 py-2 text-right tabular-nums">{totals.days.toFixed(1)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totals.internal, plan.currency, loc)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totals.external, plan.currency, loc)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totals.margin, plan.currency, loc)}</td>
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
                  className="rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey">
                  {showRollup ? t(lang, "resourcesRollupHide") : t(lang, "resourcesRollupShow")}
                </button>
                {showRollup && (
                  <div className="mt-2 overflow-auto rounded-md border border-line">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th
                            className="relative px-3 py-2 font-medium"
                            style={{ width: rollup.colWidths.assignee, minWidth: rollup.colWidths.assignee }}
                          >
                            {t(lang, "assignee")}
                            <ColumnResizeHandle col="assignee" onMouseDown={rollupStartResize} />
                          </th>
                          {rollupPeriods.map((rp) => (
                            <th
                              key={rp.key}
                              className="relative px-3 py-2 text-right font-medium tabular-nums"
                              style={{ width: rollup.colWidths.period, minWidth: rollup.colWidths.period }}
                            >
                              {rp.key}
                              <ColumnResizeHandle col="period" onMouseDown={rollupStartResize} />
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {resources.map((r) => {
                          const resAbs2 = absencesForResource(absences, r);
                          return (
                            <tr key={r.id}>
                              <td className="px-3 py-2 font-medium text-foreground">{resourceDisplayName(r)}</td>
                              {rollupPeriods.map((rp) => (
                                <td key={rp.key} className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                                  {(displayCapacityHours(rp, canonicalPeriods, r, resAbs2, workdayHours, holidaySet, plan.granularity, other) / workdayHours).toFixed(1)}
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
          onImportOutlook={onImportOutlook}
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
          resources={resources}
          onEditResource={onEditResource}
          onAddResource={onAddResource}
        />
      )}
    </section>
  );
}

export const ResourcesPanel = memo(ResourcesPanelInner);
