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

import { memo, useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { type CalendarMode, monthWindow, resolveWindow, stepAnchor } from "./calendar-window";
import { type Lang, t } from "./i18n";
import { ResourceCalendar } from "./resource-calendar";
import { CalendarSeriesList } from "./calendar-series-list";
import type { CalendarEvent } from "./calendar-event";
import { buildMoveOccurrenceHandler } from "./calendar-event-move-handler";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { ResourceWorkload, WORKLOAD_COL_WIDTHS, type WorkloadCol } from "./resource-workload";
import { generatePeriods, displayCapacityHours, absencesForResource, convertUtilization } from "./resource-capacity";
import { periodCost } from "./resource-cost";
import {
  type Absence,
  DEFAULT_WEEK_HOURS,
  type Discipline,
  type Grade,
  type PlanGranularity,
  type RaidItem,
  type Resource,
  type ResourcePlan,
  type Role,
  type Shift,
  type Task,
  type WeekHours,
} from "./types";
import { effectivePersonEmail, effectivePersonName, resourceDisplayName } from "./resource-foundation";
import { useSettings } from "./use-settings";
import { useAllocPlan } from "./use-alloc-plan";
import { type ActivityKind } from "./activity-log";
import { type UndoStackApi } from "./undo/use-undo-stack";
import { useColumnResize } from "./use-column-resize";
import { ResetColWidthsButton, ResetSizeButton, PrintButton } from "./task-manager-ui";
import { EmptyState } from "./empty-state";
import { useResizable } from "./use-resizable";
import { useSortableFilter, type SortDir } from "./report-table";
import { FOCUS_RING, INTERACTIVE } from "./interaction-styles";
import { CalendarSyncControls } from "./calendar-sync-controls";
import { ViewCallout } from "./view-callout";
import {
  PLANNING_COL_WIDTHS,
  ROLLUP_COL_WIDTHS,
  type PlanningCol,
  type PlanSortKey,
  type RollupCol,
} from "./resources-panel-columns";
import { PlanningTable, type PlanRow } from "./resources-panel-rows";
import { PlanningToolbar, CalendarToolbar } from "./resources-panel-toolbar";

interface Props {
  lang: Lang;
  view: "workload" | "calendar" | "planning";
  tasks: readonly Task[];
  absences: readonly Absence[];
  shifts: readonly Shift[];
  raid: readonly RaidItem[];
  raidEnabled: boolean;
  resources: readonly Resource[];
  /** Resource-calendar timed events, optionally recurring. Threaded straight
   *  into the all-series list under the calendar grid — that list is the only
   *  consumer of this prop; the grid's own occurrence rendering lands in a
   *  later task. Optional (defaults to none) so the existing call site can
   *  wire it up separately without this task's addition breaking the build. */
  calendarEvents?: readonly CalendarEvent[];
  today: string;
  holidaySet: ReadonlySet<string>;
  onAddAbsence: (seed?: Partial<Absence>) => void;
  onEditAbsence: (absence: Absence) => void;
  /** Commit a drag/resize/reassign on the calendar grid. Threaded straight into
   *  `<ResourceCalendar>`; the caller owns the actual absence save (mirrors
   *  `onEditAbsence`). Omit in popouts — the panel itself gates it on
   *  `isPopout`, so a caller need not double-guard. */
  onMoveAbsence?: (id: number, patch: Partial<Absence>, kind: "move" | "reassign" | "resize") => void;
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
  setResources: Dispatch<SetStateAction<readonly Resource[]>>;
  plan: ResourcePlan;
  workdayHours: number;
  onSetUtilization: (resourceId: number, periodKey: string, value: number) => void;
  /** Over-allocation threshold percent (the alert's `workloadAllocatedPct`). */
  overAllocatedPct: number;
  /** Clear an unlinked workload row (blank matching assignee/owner strings). */
  onClearUnlinked?: (row: { display: string; email: string; firstName: string; lastName: string }) => void;
  /** Reassign a workload overdue task to a resource (null = unassign) (#24). */
  onReassignTask: (taskId: number, resource: Resource | null) => void;
  /** Reschedule a workload overdue task's due date (#24). */
  onRescheduleTask: (taskId: number, iso: string) => void;
  onSetAllUtilizationMode: (mode: "percent" | "hours") => void;
  onSetAbsenceOverride: (resourceId: number, periodKey: string, hours: number | null) => void;
  onSetPlanWindow: (startDate: string, endDate: string) => void;
  onEditResource: (resource: Resource) => void;
  onAddResource: (seed?: Partial<Resource>) => void;
  /** Open the calendar-event editor for a series from the all-series list.
   *  Omit in popouts — the panel itself gates it on `isPopout`, so a caller
   *  need not double-guard (mirrors `onMoveAbsence`). */
  onEditCalendarEvent?: (event: CalendarEvent) => void;
  /** Commit a change to a calendar event. Added ahead of the series editor's
   *  full save/create/delete wiring (Task 17 needs it for occurrence-drag
   *  only) — mirrors `onMoveAbsence`'s own precedent of landing before its
   *  caller-side handler did. Omit in popouts, same convention. */
  onSaveCalendarEvent?: (event: CalendarEvent) => void;
  /** Delete a calendar event series. Declared here (unused by this task —
   *  no delete control exists in the panel yet) purely so the type shape
   *  matches what the in-flight caller-side wiring (task-manager.tsx /
   *  workspace-section.tsx) already passes; the series editor modal is the
   *  actual consumer. Omit in popouts, same convention as its siblings. */
  onDeleteCalendarEvent?: (id: number) => void;
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
  onCaptureUndo?: UndoStackApi["capture"];
  logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void;
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
  calendarEvents = [],
  today,
  holidaySet,
  onAddAbsence,
  onEditAbsence,
  onMoveAbsence,
  onEditShift,
  roles,
  disciplines,
  grades,
  setResources,
  plan,
  workdayHours,
  onSetUtilization,
  overAllocatedPct,
  onClearUnlinked,
  onReassignTask,
  onRescheduleTask,
  onSetAllUtilizationMode,
  onSetAbsenceOverride,
  onSetPlanWindow,
  onEditResource,
  onAddResource,
  onEditCalendarEvent,
  onSaveCalendarEvent,
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
  onCaptureUndo,
  logActivity,
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

  const { ref: resRef, reset: resetResSize } = useResizable(`aipm-cockpit:${view}-size`);

  const [showRollup, setShowRollup] = useState(false);
  // Planning-only: hide external resources from the grid + rollup (view-local).
  const [hideExternal, setHideExternal] = useState(false);
  // View granularity controls how the planning grid is sliced for display.
  // It is independent of the plan's CANONICAL (entry) granularity, where
  // utilization is actually stored. Finer views derive from canonical data.
  // When the plan's canonical granularity changes, reset the view to match —
  // done during render (React's "adjusting state on prop change" pattern)
  // rather than in an effect, to avoid cascading renders.
  const [viewGranularity, setViewGranularity] = useState<PlanGranularity>(plan.granularity);
  const [prevPlanGranularity, setPrevPlanGranularity] = useState<PlanGranularity>(plan.granularity);

  // Per-device: include external resources in the calendar (default include).
  const { settings, setSettings } = useSettings();
  const includeExternals = settings.calendarIncludeExternals !== false;

  // AI-assisted allocation planning (Resources → Planning toolbar only). Called
  // unconditionally — its rendered output (button/modal) is planning-only, but
  // the hook itself must run every render regardless of `view`. `disciplines`/
  // `grades`/`setResources` come in as PROPS (not useWorkspace()) — this panel
  // is the only memo'd panel workspace-section renders, and a direct context
  // consumer would defeat that memo bailout on every unrelated workspace edit.
  const allocPlan = useAllocPlan({
    settings,
    isPopout: !!isPopout,
    lang,
    resources,
    setResources,
    roles,
    disciplines,
    grades,
    plan,
    absences,
    workdayHours,
    holidaySet,
    capture: onCaptureUndo,
    logActivity,
  });

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

  const resourcesById = useMemo(() => {
    const m = new Map<number, Resource>();
    for (const r of resources) m.set(r.id, r);
    return m;
  }, [resources]);

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
    // Resolve a task/absence/shift's person reference FK-first (mirrors
    // resource-workload-rows.ts `resolve`): a record carrying a `resourceId`
    // that resolves to a live directory resource is attributed to THAT
    // resource's row (keyed by its current name/email), so a stale cached
    // `assignee` string after a rename no longer forks a duplicate row. Only a
    // record with no resolvable FK falls back to name-keying.
    const upsertRef = (
      resourceId: number | null | undefined,
      rawAssignee: string,
      rawEmail: string | undefined,
    ): AssigneeRow | null =>
      upsert(
        effectivePersonName(rawAssignee, resourceId, resourcesById),
        effectivePersonEmail(rawEmail ?? "", resourceId, resourcesById),
      );

    // Tasks contribute the assignee + open/overdue counts.
    for (const task of tasks) {
      const row = upsertRef(task.resourceId, task.assignee, task.assigneeEmail);
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
      const row = upsertRef(a.resourceId, a.assignee, a.assigneeEmail);
      if (!row) continue;
      if (a.endDate < today) continue;
      if (horizon && a.startDate > horizon) continue;
      row.upcoming.push(a);
    }
    // Shifts contribute weekly-hours + ensure the assignee row exists.
    for (const s of shifts) {
      const row = upsertRef(s.resourceId, s.assignee, s.assigneeEmail);
      if (!row) continue;
      row.shift = s;
      row.weeklyHours = sumHours(s.hoursPerWeekday);
    }
    // Directory resources seed a row too, so a person added to the directory is
    // visible in the calendar even with zero tasks/absences/shifts yet (else the
    // grid is chicken-and-egg: no row to click to book their first absence).
    for (const r of resources) {
      upsert(resourceDisplayName(r), r.email);
    }
    for (const row of byKey.values()) {
      row.upcoming.sort((x, y) => x.startDate.localeCompare(y.startDate));
    }

    return Array.from(byKey.values()).sort((a, b) =>
      a.display.localeCompare(b.display),
    );
  }, [tasks, absences, shifts, resources, resourcesById, today]);

  // Planning grid: name filter + sortable cost/capacity headers. Hooks MUST run
  // unconditionally here (never inside the `view === "planning"` IIFE) to keep
  // the hook order stable across views.
  const [planFilter, setPlanFilter] = useState("");
  const [planSort, setPlanSort] = useState<{ key: PlanSortKey; dir: SortDir }>({ key: "assignee", dir: "asc" });
  // Planning grid + rollup only — they just map this list.
  // ★★ WORKLOAD MUST NOT USE IT: it takes the COMPLETE `resources` plus a
  // `hideExternal` flag and filters its BUILT rows. Feeding the builder a
  // filtered list re-surfaces the hidden person as an "Unlinked" row whose
  // Clear control deletes real data — see AGENTS.md `buildResourceWorkload`.
  const visibleResources = useMemo(
    () => (hideExternal ? resources.filter((r) => !r.isExternal) : resources),
    [resources, hideExternal],
  );
  const planRows = useMemo<PlanRow[]>(() => {
    const canonicalPeriods = generatePeriods(plan.startDate, plan.endDate, plan.granularity);
    const periods = generatePeriods(plan.startDate, plan.endDate, viewGranularity);
    return visibleResources.map((r) => {
      const resAbs = absencesForResource(absences, r);
      const totalHours = periods.reduce((sum, p) =>
        sum + displayCapacityHours(p, canonicalPeriods, r, resAbs, workdayHours, holidaySet, plan.granularity, viewGranularity), 0);
      const role = roles.find((x) => x.id === r.roleId);
      const cost = periodCost(totalHours, r.isExternal ? undefined : role);
      return { resource: r, name: resourceDisplayName(r), totalHours, cost, capacityDays: totalHours / workdayHours, internalCost: cost.internal, externalCost: cost.external, margin: cost.margin };
    });
  }, [visibleResources, absences, roles, plan.startDate, plan.endDate, plan.granularity, viewGranularity, workdayHours, holidaySet]);
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
      capacityHours: row.totalHours,
      capacityDays: row.capacityDays,
      internalCost: row.internalCost,
      externalCost: row.externalCost,
      margin: row.margin,
    };
    return values[k];
  }, []);
  const { sorted: planSorted, click: planClick } = useSortableFilter(planRows, planSort, setPlanSort, planFilter, getPlanValue);
  // Shared utilization mode for the planning toolbar's percent/hours segment —
  // the resources' mode when unanimous, else "percent".
  const utilizationMode: "percent" | "hours" =
    resources.length > 0 && resources.every((r) => r.utilizationMode === resources[0].utilizationMode)
      ? resources[0].utilizationMode
      : "percent";

  // Toolbar actions: calendar-only Outlook import + the Outlook sync controls
  // lead; then the trailing Print · reset-columns (planning/workload only) ·
  // reset-size group. The Outlook block used to sit BETWEEN the two resets,
  // splitting a group that reads as one everywhere else. Shared by the
  // workload/planning header and (for calendar, which has NO heading) the
  // calendar control row.
  const headerActions = (
    <div className="flex items-center gap-2 print:hidden">
      {view === "calendar" && onImportOutlookCalendar && (
        <button
          type="button"
          onClick={onImportOutlookCalendar}
          className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-ui-dark-blue hover:bg-surface-muted dark:text-ui-light-grey ${INTERACTIVE}`}
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
      <PrintButton lang={lang} />
      {(view === "planning" || view === "workload") && (
        <ResetColWidthsButton
          onClick={view === "planning" ? resetPlanningAndRollup : workload.resetColWidths}
          lang={lang}
        />
      )}
      <ResetSizeButton onClick={resetResSize} lang={lang} />
    </div>
  );

  // Shared by the planning control row and the workload header — the same
  // filter drives both views' resource list.
  const hideExternalToggle = (
    <label className="flex items-center gap-1.5 text-xs text-foreground">
      <input
        type="checkbox"
        checked={hideExternal}
        aria-label={t(lang, "planningHideExternal")}
        onChange={(e) => setHideExternal(e.target.checked)}
        className={`align-middle ${FOCUS_RING}`}
      />
      <span>{t(lang, "planningHideExternal")}</span>
    </label>
  );

  // The header count sits inches from the Hide-external toggle, so it has to
  // track it. Filter a COPY: `rows` also feeds the calendar, which has its own
  // separate includeExternals setting and must not be double-filtered.
  const externalRowKeys = useMemo(
    () =>
      new Set(
        resources.filter((r) => r.isExternal).map((r) => resourceDisplayName(r).trim().toLowerCase()),
      ),
    [resources],
  );
  const workloadRowCount = hideExternal
    ? rows.filter((r) => !externalRowKeys.has(r.key)).length
    : rows.length;

  // Header: title + count. WORKLOAD ONLY (planning has its own control row,
  // calendar none) — so no view guards inside; the sole call site carries it.
  const renderWorkloadHeader = () => (
    <header className="mb-2 flex shrink-0 items-center justify-between gap-2">
      <h2 className="text-lg font-medium text-foreground">
        {t(lang, "resourcesViewWorkload")}
        {workloadRowCount > 0 && (
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {t(lang, "tasksCount", workloadRowCount)}
          </span>
        )}
      </h2>
      <div className="flex items-center gap-3 print:hidden">
        {hideExternalToggle}
        {headerActions}
      </div>
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
      {view === "workload" && renderWorkloadHeader()}
      {isEmpty && view !== "planning" && (
        <EmptyState title={t(lang, "resourcesEmpty")} />
      )}
      {view === "planning" && (
        <>
          <PlanningToolbar
            lang={lang}
            planStartDate={plan.startDate}
            planEndDate={plan.endDate}
            onSetPlanWindow={onSetPlanWindow}
            viewGranularity={viewGranularity}
            onSetViewGranularity={setViewGranularity}
            utilizationMode={utilizationMode}
            onSetAllUtilizationMode={onSetAllUtilizationMode}
            hideExternalToggle={hideExternalToggle}
            aiPlanButton={allocPlan.button}
            headerActions={headerActions}
            planFilter={planFilter}
            onPlanFilter={setPlanFilter}
          />
          {allocPlan.modal}
          <PlanningTable
            lang={lang}
            plan={plan}
            viewGranularity={viewGranularity}
            rows={planSorted}
            absences={absences}
            workdayHours={workdayHours}
            holidaySet={holidaySet}
            onEditResource={onEditResource}
            onSetUtilization={onSetUtilization}
            onSetAbsenceOverride={onSetAbsenceOverride}
            planColWidths={planning.colWidths}
            planSort={planSort}
            planClick={planClick}
            planStartResize={planningStartResize}
            showRollup={showRollup}
            onToggleRollup={() => setShowRollup((v) => !v)}
            rollupColWidths={rollup.colWidths}
            rollupStartResize={rollupStartResize}
            visibleResources={visibleResources}
          />
        </>
      )}
      {view === "workload" && !isEmpty && (
        <ResourceWorkload
          lang={lang}
          hideExternal={hideExternal}
          resources={resources}
          tasks={tasks}
          absences={absences}
          shifts={shifts}
          raid={raid}
          raidEnabled={raidEnabled}
          today={today}
          onEditResource={onEditResource}
          onAddResource={onAddResource}
          onClearUnlinked={onClearUnlinked}
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
          <CalendarToolbar
            lang={lang}
            calendarMode={calendarMode}
            onCalendarMode={handleCalendarMode}
            winStartDate={calendarWin.startDate}
            winEndDate={calendarWin.endDate}
            onCalendarPrev={() => setCalendarAnchor((a) => stepAnchor(a, calendarMode === "week" ? "week" : "month", -1))}
            onCalendarNext={() => setCalendarAnchor((a) => stepAnchor(a, calendarMode === "week" ? "week" : "month", 1))}
            onCalendarToday={() => setCalendarAnchor(today)}
            calendarFrom={calendarFrom}
            onCalendarFrom={setCalendarFrom}
            calendarTo={calendarTo}
            onCalendarTo={setCalendarTo}
            onCalendarCustomToday={() => {
              const w = monthWindow(today);
              setCalendarFrom(w.startDate);
              setCalendarTo(w.endDate);
            }}
            includeExternals={includeExternals}
            onToggleIncludeExternals={(checked) => setSettings((s) => ({ ...s, calendarIncludeExternals: checked }))}
            headerActions={headerActions}
          />
          <ResourceCalendar
            lang={lang}
            includeExternals={includeExternals}
            rows={rows}
            absences={absences}
            today={today}
            holidaySet={holidaySet}
            onAddAbsence={onAddAbsence}
            onEditAbsence={onEditAbsence}
            onMoveAbsence={isPopout ? undefined : onMoveAbsence}
            resources={resources}
            onEditResource={onEditResource}
            onAddResource={onAddResource}
            startDate={calendarWin.startDate}
            endDate={calendarWin.endDate}
            calendarEvents={calendarEvents}
            onMoveOccurrence={
              isPopout || !onSaveCalendarEvent
                ? undefined
                : buildMoveOccurrenceHandler(calendarEvents, onSaveCalendarEvent)
            }
          />
          <CalendarSeriesList
            lang={lang}
            events={calendarEvents}
            today={today}
            onEdit={isPopout ? undefined : onEditCalendarEvent}
          />
        </>
      )}
    </section>
  );
}

export const ResourcesPanel = memo(ResourcesPanelInner);
