"use client";

// Resource Planner panel — view shell hosting workload / calendar / planning.
//
// The active view is passed in as a `view` prop (driven by workspace-section).
// Directory is no longer owned by this panel — it lives in its own view.
//
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

import { memo, useCallback, useMemo, useState } from "react";
import { localeFor, shortDateRangeIso } from "./date-format";
import { type CalendarMode, monthWindow, resolveWindow, stepAnchor } from "./calendar-window";
import { type Lang, t } from "./i18n";
import { ResourceCalendar } from "./resource-calendar";
import { INNER_TABLE_CLASS, VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { ResourceWorkload, WORKLOAD_COL_WIDTHS, type WorkloadCol } from "./resource-workload";
import { SegmentedControl } from "./segmented-control";
import { generatePeriods, displayCapacityHours, absencesForResource, absenceWorkdays, convertUtilization } from "./resource-capacity";
import { periodCost, formatCurrency } from "./resource-cost";
import {
  type Absence,
  DEFAULT_WEEK_HOURS,
  type PlanGranularity,
  type RaidItem,
  type Resource,
  type ResourcePlan,
  type Role,
  type Shift,
  type Task,
  type WeekHours,
} from "./types";
import { resourceDisplayName } from "./resource-foundation";
import { useColumnResize } from "./use-column-resize";
import { ColumnResizeHandle, ResetColWidthsButton, ResetSizeButton, PrintButton } from "./task-manager-ui";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { useResizable } from "./use-resizable";
import { RagBadge } from "./rag-badge";
import { marginAmountHealth } from "./budget-health";
import { useSortableFilter, TableFilter, SortHeaderButton, type SortDir } from "./report-table";
import { InfoTooltip } from "./info-tooltip";
import { FOCUS_RING, TRANSITION, INTERACTIVE } from "./interaction-styles";
import { CalendarSyncControls } from "./calendar-sync-controls";
import { ViewCallout } from "./view-callout";

const PLANNING_COL_WIDTHS = {
  assignee: 160,
  period: 100,
  capacityDays: 110,
  internalCost: 120,
  externalCost: 120,
  margin: 100,
} as const;
type PlanningCol = keyof typeof PLANNING_COL_WIDTHS;
type PlanSortKey = "assignee" | "capacityDays" | "internalCost" | "externalCost" | "margin";

const ROLLUP_COL_WIDTHS = {
  assignee: 160,
  period: 100,
} as const;
type RollupCol = keyof typeof ROLLUP_COL_WIDTHS;

interface Props {
  lang: Lang;
  view: "workload" | "calendar" | "planning";
  tasks: readonly Task[];
  absences: readonly Absence[];
  shifts: readonly Shift[];
  raid: readonly RaidItem[];
  raidEnabled: boolean;
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
  plan: ResourcePlan;
  workdayHours: number;
  onSetUtilization: (resourceId: number, periodKey: string, value: number) => void;
  /** Over-allocation threshold percent (the alert's `workloadAllocatedPct`). */
  overAllocatedPct: number;
  /** Reassign a workload overdue task to a resource (null = unassign) (#24). */
  onReassignTask: (taskId: number, resource: Resource | null) => void;
  /** Reschedule a workload overdue task's due date (#24). */
  onRescheduleTask: (taskId: number, iso: string) => void;
  onSetAllUtilizationMode: (mode: "percent" | "hours") => void;
  onSetAbsenceOverride: (resourceId: number, periodKey: string, hours: number | null) => void;
  onSetPlanWindow: (startDate: string, endDate: string) => void;
  onEditResource: (resource: Resource) => void;
  onAddResource: (seed?: Partial<Resource>) => void;
  onImportOutlookCalendar?: () => void;
  /** M365 configured — gates the calendar toggle/button (hidden otherwise). */
  m365Configured?: boolean;
  /** Absence Outlook write-back (SP4). Absent in popouts. */
  calendarEnabled?: boolean;
  onToggleCalendar?: (enabled: boolean) => void;
  onPushCalendar?: () => void;
  calendarPushBusy?: boolean;
  onPullCalendar?: () => void;
  calendarPullBusy?: boolean;
  showHints?: boolean;
  isPopout?: boolean;
  onLearnMore?: (conceptId: string) => void;
}

type AssigneeRow = {
  key: string;          // case-folded join key
  display: string;      // first observed original casing
  email: string;        // first non-empty email observed
  openCount: number;
  overdueCount: number;
  upcoming: Absence[];  // sorted by startDate asc, within 60-day window
  shift: Shift | null;  // matching shift (case-folded join), or null = default
  weeklyHours: number;  // sum of hoursPerWeekday — uses DEFAULT_WEEK_HOURS when shift is null
};

function sumHours(h: WeekHours): number {
  return h.reduce((a, b) => a + (b || 0), 0);
}

const DEFAULT_WEEKLY_HOURS_TOTAL = sumHours(DEFAULT_WEEK_HOURS);

function ResourcesPanelInner({
  lang,
  view,
  tasks,
  absences,
  shifts,
  raid,
  raidEnabled,
  resources,
  today,
  holidaySet,
  onAddAbsence,
  onEditAbsence,
  onEditShift,
  roles,
  plan,
  workdayHours,
  onSetUtilization,
  overAllocatedPct,
  onReassignTask,
  onRescheduleTask,
  onSetAllUtilizationMode,
  onSetAbsenceOverride,
  onSetPlanWindow,
  onEditResource,
  onAddResource,
  onImportOutlookCalendar,
  m365Configured,
  calendarEnabled,
  onToggleCalendar,
  onPushCalendar,
  calendarPushBusy,
  onPullCalendar,
  calendarPullBusy,
  showHints,
  isPopout,
  onLearnMore,
}: Props) {
  const planning = useColumnResize<PlanningCol>("planning", PLANNING_COL_WIDTHS);
  const rollup = useColumnResize<RollupCol>("rollup", ROLLUP_COL_WIDTHS);
  const workload = useColumnResize<WorkloadCol>("workload", WORKLOAD_COL_WIDTHS);
  const planningStartResize = planning.startColResize as (col: string, e: React.MouseEvent) => void;
  const rollupStartResize = rollup.startColResize as (col: string, e: React.MouseEvent) => void;
  const resetPlanningAndRollup = () => {
    planning.resetColWidths();
    rollup.resetColWidths();
  };

  const { ref: resRef, reset: resetResSize } = useResizable(`lop-app:${view}-size`);

  const [showRollup, setShowRollup] = useState(false);
  // View granularity controls how the planning grid is sliced for display.
  // It is independent of the plan's CANONICAL (entry) granularity, where
  // utilization is actually stored. Finer views derive from canonical data.
  // When the plan's canonical granularity changes, reset the view to match —
  // done during render (React's "adjusting state on prop change" pattern)
  // rather than in an effect, to avoid cascading renders.
  const [viewGranularity, setViewGranularity] = useState<PlanGranularity>(plan.granularity);
  const [prevPlanGranularity, setPrevPlanGranularity] = useState<PlanGranularity>(plan.granularity);

  const [calendarMode, setCalendarMode] = useState<CalendarMode>("month");
  const [calendarAnchor, setCalendarAnchor] = useState<string>(today);
  const [calendarFrom, setCalendarFrom] = useState<string>(() => monthWindow(today).startDate);
  const [calendarTo, setCalendarTo] = useState<string>(() => monthWindow(today).endDate);
  const calendarWin = resolveWindow(calendarMode, calendarAnchor, calendarFrom, calendarTo);

  const handleCalendarMode = (mode: CalendarMode) => {
    if (mode === "custom") {
      setCalendarFrom(calendarWin.startDate);
      setCalendarTo(calendarWin.endDate);
    }
    setCalendarMode(mode);
  };

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

  // Planning grid: name filter + sortable cost/capacity headers. Hooks MUST run
  // unconditionally here (never inside the `view === "planning"` IIFE) to keep
  // the hook order stable across views.
  const [planFilter, setPlanFilter] = useState("");
  const [planSort, setPlanSort] = useState<{ key: PlanSortKey; dir: SortDir }>({ key: "assignee", dir: "asc" });
  const planRows = useMemo(() => {
    const canonicalPeriods = generatePeriods(plan.startDate, plan.endDate, plan.granularity);
    const periods = generatePeriods(plan.startDate, plan.endDate, viewGranularity);
    return resources.map((r) => {
      const resAbs = absencesForResource(absences, r);
      const totalHours = periods.reduce((sum, p) =>
        sum + displayCapacityHours(p, canonicalPeriods, r, resAbs, workdayHours, holidaySet, plan.granularity, viewGranularity), 0);
      const role = roles.find((x) => x.id === r.roleId);
      const cost = periodCost(totalHours, role);
      return { resource: r, name: resourceDisplayName(r), totalHours, cost, capacityDays: totalHours / workdayHours, internalCost: cost.internal, externalCost: cost.external, margin: cost.margin };
    });
  }, [resources, absences, roles, plan.startDate, plan.endDate, plan.granularity, viewGranularity, workdayHours, holidaySet]);
  // Near-term (period[0]) utilization for the workload over-allocation editor —
  // MIRRORS next-actions-workload.ts (same canonical-granularity slice[0] + the
  // convert-to-percent), so the inline editor targets the SAME period the
  // over-allocation alert flags.
  const nearTerm = useMemo(() => {
    const periods = generatePeriods(plan.startDate, plan.endDate, plan.granularity);
    const key = periods.length > 0 ? periods[0].key : null;
    const pctByResource = new Map<number, number>();
    if (key) {
      for (const r of resources) {
        const pct = convertUtilization(r.utilization, r.utilizationMode, "percent", periods, workdayHours, holidaySet);
        // Store the RAW percent (not rounded) so the cell's over-allocation
        // highlight compares identically to the alert (next-actions-workload).
        pctByResource.set(r.id, pct[key] ?? 0);
      }
    }
    return { key, pctByResource };
  }, [resources, plan.startDate, plan.endDate, plan.granularity, workdayHours, holidaySet]);
  const getPlanValue = useCallback((row: typeof planRows[number], k: PlanSortKey): string | number => {
    const values: Record<PlanSortKey, string | number> = {
      assignee: row.name,
      capacityDays: row.capacityDays,
      internalCost: row.internalCost,
      externalCost: row.externalCost,
      margin: row.margin,
    };
    return values[k];
  }, []);
  const { sorted: planSorted, click: planClick } = useSortableFilter(planRows, planSort, setPlanSort, planFilter, getPlanValue);

  // Toolbar actions: planning-only ResetColWidths; calendar-only Outlook import;
  // always Print + ResetSize. Shared by the workload/planning header and (for
  // calendar, which has NO heading) the calendar control row.
  const headerActions = (
    <div className="flex items-center gap-2 print:hidden">
      <PrintButton lang={lang} />
      {(view === "planning" || view === "workload") && (
        <ResetColWidthsButton
          onClick={view === "planning" ? resetPlanningAndRollup : workload.resetColWidths}
          lang={lang}
        />
      )}
      {view === "calendar" && onImportOutlookCalendar && (
        <button
          type="button"
          onClick={onImportOutlookCalendar}
          className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey ${INTERACTIVE}`}
        >
          {t(lang, "outlookCalImportButton")}
        </button>
      )}
      <CalendarSyncControls
        lang={lang}
        entityLabelKey="calendarSyncEntityAbsence"
        m365Configured={m365Configured}
        isPopout={isPopout}
        calendarEnabled={calendarEnabled}
        onToggleCalendar={onToggleCalendar}
        onPushCalendar={onPushCalendar}
        calendarPushBusy={calendarPushBusy}
        onPullCalendar={onPullCalendar}
        calendarPullBusy={calendarPullBusy}
      />
      <ResetSizeButton onClick={resetResSize} lang={lang} />
    </div>
  );

  // Header: title + count. Calendar drops it (the actions move into its control
  // row), so this renders only for workload/planning.
  const renderHeader = () => (
    <header className="mb-2 flex shrink-0 items-center justify-between gap-2">
      <h2 className="text-lg font-medium text-foreground">
        {t(lang, view === "workload" ? "resourcesViewWorkload" : "resourcesViewPlanning")}
        {rows.length > 0 && (
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {t(lang, "tasksCount", rows.length)}
          </span>
        )}
      </h2>
      {headerActions}
    </header>
  );

  const isEmpty = rows.length === 0 && resources.length === 0;

  // Calendar shares Workload's full resizable pane (was the half-size centered
  // pane, which made it visibly smaller than every sibling resource view).
  const paneClass = VIEW_PANE_RESIZABLE_CLASS;

  return (
    <section ref={resRef} className={`print-root print-landscape ${paneClass}`}>
      {onLearnMore && (
        <ViewCallout view={view} lang={lang} showHints={showHints !== false} isPopout={!!isPopout} onLearnMore={onLearnMore} />
      )}
      {view === "workload" && renderHeader()}
      {isEmpty && view !== "planning" && (
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
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs print:hidden">
              <label className="flex items-center gap-1">
                <span className="flex items-center gap-1">{t(lang, "resourcesPlanStart")}<InfoTooltip text={t(lang, "resourcesPlanStartHint")} /></span>
                <input type="date" aria-label={t(lang, "resourcesPlanStart")} value={plan.startDate}
                  onChange={(e) => onSetPlanWindow(e.target.value, plan.endDate)}
                  className={`rounded border border-line px-2 py-1.5 text-sm dark:bg-surface ${FOCUS_RING} ${TRANSITION}`} />
              </label>
              <label className="flex items-center gap-1">
                <span className="flex items-center gap-1">{t(lang, "resourcesPlanEnd")}<InfoTooltip text={t(lang, "resourcesPlanEndHint")} /></span>
                <input type="date" aria-label={t(lang, "resourcesPlanEnd")} value={plan.endDate}
                  onChange={(e) => onSetPlanWindow(plan.startDate, e.target.value)}
                  className={`rounded border border-line px-2 py-1.5 text-sm dark:bg-surface ${FOCUS_RING} ${TRANSITION}`} />
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
              <div className="ml-auto">{headerActions}</div>
            </div>
            <div className="print:hidden">
              <TableFilter lang={lang} value={planFilter} onChange={setPlanFilter} placeholderKey="planningFilterResource" />
            </div>
            <div className={INNER_TABLE_CLASS}>
            <table className="w-full text-left text-sm">
              <thead className={TABLE_HEAD_CLASS}>
                <tr>
                  <th
                    className="relative px-3 py-2 font-medium"
                    style={{ width: planning.colWidths.assignee, minWidth: planning.colWidths.assignee }}
                  >
                    <SortHeaderButton label={t(lang, "assignee")} active={planSort.key === "assignee" && planSort.dir !== "off"} dir={planSort.dir} onClick={() => planClick("assignee")} />
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
                  >
                    <SortHeaderButton label={t(lang, "resourcesCapacityDays")} active={planSort.key === "capacityDays" && planSort.dir !== "off"} dir={planSort.dir} onClick={() => planClick("capacityDays")} />
                    <InfoTooltip text={t(lang, "resourcesCapacityDaysHint")} />
                    <ColumnResizeHandle col="capacityDays" onMouseDown={planningStartResize} />
                  </th>
                  <th
                    className="relative px-3 py-2 text-right font-medium"
                    style={{ width: planning.colWidths.internalCost, minWidth: planning.colWidths.internalCost }}
                  >
                    <SortHeaderButton label={t(lang, "resourcesInternalCost")} active={planSort.key === "internalCost" && planSort.dir !== "off"} dir={planSort.dir} onClick={() => planClick("internalCost")} />
                    <InfoTooltip text={t(lang, "resourcesInternalCostHint")} />
                    <ColumnResizeHandle col="internalCost" onMouseDown={planningStartResize} />
                  </th>
                  <th
                    className="relative px-3 py-2 text-right font-medium"
                    style={{ width: planning.colWidths.externalCost, minWidth: planning.colWidths.externalCost }}
                  >
                    <SortHeaderButton label={t(lang, "resourcesExternalCost")} active={planSort.key === "externalCost" && planSort.dir !== "off"} dir={planSort.dir} onClick={() => planClick("externalCost")} />
                    <InfoTooltip text={t(lang, "resourcesExternalCostHint")} />
                    <ColumnResizeHandle col="externalCost" onMouseDown={planningStartResize} />
                  </th>
                  <th
                    className="relative px-3 py-2 text-right font-medium"
                    style={{ width: planning.colWidths.margin, minWidth: planning.colWidths.margin }}
                  >
                    <SortHeaderButton label={t(lang, "resourcesMargin")} active={planSort.key === "margin" && planSort.dir !== "off"} dir={planSort.dir} onClick={() => planClick("margin")} />
                    <InfoTooltip text={t(lang, "resourcesMarginHint")} />
                    <ColumnResizeHandle col="margin" onMouseDown={planningStartResize} />
                  </th>
                </tr>
              </thead>
              {(() => {
                const loc = localeFor(lang);
                const totals = planSorted.reduce((acc, row) => ({
                  days: acc.days + row.capacityDays,
                  internal: acc.internal + row.internalCost,
                  external: acc.external + row.externalCost,
                  margin: acc.margin + row.margin,
                }), { days: 0, internal: 0, external: 0, margin: 0 });
                const rowsJsx = planSorted.map((row) => {
                  const r = row.resource;
                  const cost = row.cost;
                  const totalHours = row.totalHours;
                  const resAbs = absencesForResource(absences, r);
                  return (
                    <tr key={r.id} onClick={() => onEditResource(r)} className="cursor-pointer hover:bg-surface-muted">
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onEditResource(r); }}
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
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => { if (!derived) onSetUtilization(r.id, p.key, Number(e.target.value) || 0); }}
                            className={`w-16 rounded border border-line px-1 py-0.5 text-right tabular-nums dark:bg-surface ${FOCUS_RING} ${TRANSITION}${derived ? " bg-surface-muted opacity-60" : ""}`} />
                          <input type="number" min={0} step={1}
                            aria-label={`Absence override for ${resourceDisplayName(r)} in ${p.key}`}
                            title={t(lang, "resourcesAbsenceOverrideHint")}
                            value={derived ? "" : (r.absenceOverride?.[p.key] ?? "")}
                            placeholder={derived ? "" : String(absenceWorkdays(resAbs, p.start, p.end, holidaySet) * workdayHours)}
                            readOnly={derived}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => { if (!derived) onSetAbsenceOverride(r.id, p.key, e.target.value === "" ? null : Number(e.target.value)); }}
                            className={`mt-0.5 w-16 rounded border border-AIPM-purple/40 px-1 py-0.5 text-right text-sm tabular-nums text-AIPM-purple dark:border-AIPM-purple/50 dark:bg-surface dark:text-AIPM-purple ${FOCUS_RING} ${TRANSITION}${derived ? " bg-surface-muted opacity-60" : ""}`} />
                        </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{(totalHours / workdayHours).toFixed(1)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(cost.internal, plan.currency, loc)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(cost.external, plan.currency, loc)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className="inline-flex items-center justify-end gap-1.5">
                          {formatCurrency(cost.margin, plan.currency, loc)}
                          <RagBadge value={marginAmountHealth(cost.margin, cost.external)} lang={lang} title={t(lang, "resourcesMargin")} />
                        </span>
                      </td>
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
                        <td className="px-3 py-2 text-right tabular-nums">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            {formatCurrency(totals.margin, plan.currency, loc)}
                            <RagBadge value={marginAmountHealth(totals.margin, totals.external)} lang={lang} title={t(lang, "resourcesMargin")} />
                          </span>
                        </td>
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
                  className={`rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey print:hidden ${INTERACTIVE}`}>
                  {showRollup ? t(lang, "resourcesRollupHide") : t(lang, "resourcesRollupShow")}
                </button>
                {showRollup && (
                  <div className="mt-2 overflow-auto rounded-md border border-line pr-2">
                    <table className="w-full text-left text-sm">
                      <thead className={TABLE_HEAD_CLASS}>
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
      {view === "workload" && !isEmpty && (
        <ResourceWorkload
          lang={lang}
          resources={resources}
          tasks={tasks}
          absences={absences}
          shifts={shifts}
          raid={raid}
          raidEnabled={raidEnabled}
          today={today}
          onEditResource={onEditResource}
          onAddResource={onAddResource}
          onEditAbsence={onEditAbsence}
          onEditShift={onEditShift}
          nearTermPeriodKey={nearTerm.key}
          nearTermPctByResource={nearTerm.pctByResource}
          overAllocatedPct={overAllocatedPct}
          onSetUtilization={onSetUtilization}
          onReassignTask={onReassignTask}
          onRescheduleTask={onRescheduleTask}
          colResize={workload}
        />
      )}
      {view === "calendar" && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs print:hidden">
            <SegmentedControl<CalendarMode>
              value={calendarMode}
              ariaLabel={t(lang, "resourcesViewCalendar")}
              title={t(lang, "resourcesViewCalendar")}
              options={[
                { value: "month", label: t(lang, "resourcesGranularityMonth") },
                { value: "week", label: t(lang, "resourcesGranularityWeek") },
                { value: "custom", label: t(lang, "calendarModeCustom") },
              ]}
              onChange={handleCalendarMode}
            />
            {calendarMode !== "custom" && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={t(lang, "calendarPrev")}
                  title={t(lang, "calendarPrev")}
                  onClick={() => setCalendarAnchor((a) => stepAnchor(a, calendarMode === "week" ? "week" : "month", -1))}
                  className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
                >
                  ◀
                </button>
                <span className="min-w-[8rem] text-center font-medium text-foreground tabular-nums">
                  {calendarMode === "week"
                    ? shortDateRangeIso(calendarWin.startDate, calendarWin.endDate, lang)
                    : new Date(`${calendarWin.startDate}T00:00:00Z`).toLocaleDateString(localeFor(lang), { month: "long", year: "numeric", timeZone: "UTC" })}
                </span>
                <button
                  type="button"
                  aria-label={t(lang, "calendarNext")}
                  title={t(lang, "calendarNext")}
                  onClick={() => setCalendarAnchor((a) => stepAnchor(a, calendarMode === "week" ? "week" : "month", 1))}
                  className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
                >
                  ▶
                </button>
                <button
                  type="button"
                  aria-label={t(lang, "calendarToday")}
                  title={t(lang, "calendarToday")}
                  onClick={() => setCalendarAnchor(today)}
                  className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
                >
                  {t(lang, "calendarToday")}
                </button>
              </div>
            )}
            {calendarMode === "custom" && (
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1">
                  <span>{t(lang, "calendarFrom")}</span>
                  <input
                    type="date"
                    aria-label={t(lang, "calendarFrom")}
                    value={calendarFrom}
                    onChange={(e) => setCalendarFrom(e.target.value)}
                    className={`rounded border border-line px-2 py-1.5 text-sm dark:bg-surface ${FOCUS_RING} ${TRANSITION}`}
                  />
                </label>
                <label className="flex items-center gap-1">
                  <span>{t(lang, "calendarTo")}</span>
                  <input
                    type="date"
                    aria-label={t(lang, "calendarTo")}
                    value={calendarTo}
                    onChange={(e) => setCalendarTo(e.target.value)}
                    className={`rounded border border-line px-2 py-1.5 text-sm dark:bg-surface ${FOCUS_RING} ${TRANSITION}`}
                  />
                </label>
                <button
                  type="button"
                  aria-label={t(lang, "calendarToday")}
                  title={t(lang, "calendarToday")}
                  onClick={() => {
                    const w = monthWindow(today);
                    setCalendarFrom(w.startDate);
                    setCalendarTo(w.endDate);
                  }}
                  className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
                >
                  {t(lang, "calendarToday")}
                </button>
              </div>
            )}
            <div className="ml-auto">{headerActions}</div>
          </div>
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
            startDate={calendarWin.startDate}
            endDate={calendarWin.endDate}
          />
        </>
      )}
    </section>
  );
}

export const ResourcesPanel = memo(ResourcesPanelInner);
