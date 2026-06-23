// src/app/gantt-chrome.tsx — presentational chrome for the Gantt chart:
// the filter/sort toolbar, the month/day time-axis header, and the
// dependency/connector arrow overlay. All pure (no local state); GanttPanel
// owns the data + handlers and passes them in.
import { type Lang, t } from "./i18n";
import { FOCUS_RING, INTERACTIVE, TRANSITION } from "./interaction-styles";
import { PrintButton, ResetSizeButton } from "./task-manager-ui";
import { PRIORITIES, type Milestone, type Priority, type Task } from "./types";
import {
  addDays,
  DAY_WIDTH_PX,
  diffDays,
  EDGE_STROKE_MUTED,
  edgeKey,
  fmtDay,
  type GanttPrefs,
  type GanttSort,
  type GanttStatusFilter,
  HEADER_HEIGHT_PX,
  HEADER_ROW_HEIGHT_PX,
  LEFT_GUTTER_PX,
  parseISO,
  ROW_HEIGHT_PX,
} from "./gantt-engine";

export function GanttToolbar({
  lang,
  prefs,
  assigneeOptions,
  filtersActive,
  onAddTask,
  onAddMilestone,
  resetGanttSize,
  setSearch,
  setStatusFilter,
  setPriorityFilter,
  setAssigneeFilter,
  setSort,
  resetFilters,
  toggleCriticalPath,
}: {
  lang: Lang;
  prefs: GanttPrefs;
  assigneeOptions: readonly string[];
  filtersActive: boolean;
  onAddTask?: () => void;
  onAddMilestone?: () => void;
  resetGanttSize: () => void;
  setSearch: (search: string) => void;
  setStatusFilter: (status: GanttStatusFilter) => void;
  setPriorityFilter: (priority: Priority | "All") => void;
  setAssigneeFilter: (assignee: string) => void;
  setSort: (sort: GanttSort) => void;
  resetFilters: () => void;
  toggleCriticalPath: () => void;
}) {
  return (
    <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2 print:hidden">
      {onAddTask && (
        <button
          type="button"
          onClick={onAddTask}
          aria-label={t(lang, "addTaskButton")}
          title={t(lang, "addTaskButton")}
          className={`rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90 ${INTERACTIVE}`}
        >
          + {t(lang, "addTaskButton")}
        </button>
      )}
      {onAddMilestone && (
        <button
          type="button"
          onClick={onAddMilestone}
          aria-label={t(lang, "ganttAddMilestone")}
          title={t(lang, "ganttAddMilestone")}
          className={`rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90 ${INTERACTIVE}`}
        >
          + {t(lang, "ganttAddMilestone")}
        </button>
      )}
      <input
        type="search"
        value={prefs.search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t(lang, "searchPlaceholder")}
        aria-label={t(lang, "searchPlaceholder")}
        title={t(lang, "ganttSearchHint")}
        className={`min-w-[12rem] flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-foreground focus:border-AIPM-dark-blue ${FOCUS_RING} ${TRANSITION}`}
      />
      <select
        value={prefs.status}
        onChange={(e) =>
          setStatusFilter(e.target.value as GanttStatusFilter)
        }
        aria-label={t(lang, "ganttFilterStatus")}
        title={t(lang, "ganttStatusFilterHint")}
        className={`h-[30px] rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground focus:border-AIPM-dark-blue ${FOCUS_RING} ${TRANSITION}`}
      >
        <option value="all">{t(lang, "ganttStatusAll")}</option>
        <option value="open">{t(lang, "ganttStatusOpen")}</option>
        <option value="completed">{t(lang, "ganttStatusCompleted")}</option>
        <option value="overdue">{t(lang, "ganttStatusOverdue")}</option>
      </select>
      <select
        value={prefs.priority}
        onChange={(e) =>
          setPriorityFilter(e.target.value as Priority | "All")
        }
        aria-label={t(lang, "allPriorities")}
        title={t(lang, "priorityFilterHint")}
        className={`h-[30px] rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground focus:border-AIPM-dark-blue ${FOCUS_RING} ${TRANSITION}`}
      >
        <option value="All">{t(lang, "allPriorities")}</option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <select
        value={prefs.assignee}
        onChange={(e) => setAssigneeFilter(e.target.value)}
        aria-label={t(lang, "allAssignees")}
        title={t(lang, "assigneeFilterHint")}
        className={`h-[30px] rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground focus:border-AIPM-dark-blue ${FOCUS_RING} ${TRANSITION}`}
      >
        <option value="All">{t(lang, "allAssignees")}</option>
        {assigneeOptions.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="hidden sm:inline">{t(lang, "ganttSortLabel")}</span>
        <select
          value={prefs.sort}
          onChange={(e) => setSort(e.target.value as GanttSort)}
          aria-label={t(lang, "ganttSortLabel")}
          title={t(lang, "ganttSortHint")}
          className={`h-[30px] rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground focus:border-AIPM-dark-blue ${FOCUS_RING} ${TRANSITION}`}
        >
          <option value="auto">{t(lang, "ganttSortAuto")}</option>
          <option value="due">{t(lang, "ganttSortDue")}</option>
          <option value="name">{t(lang, "ganttSortName")}</option>
          <option value="priority">{t(lang, "ganttSortPriority")}</option>
          <option value="custom" disabled={prefs.customOrder.length === 0}>
            {t(lang, "ganttSortCustom")}
          </option>
        </select>
      </label>
      {filtersActive && (
        <button
          type="button"
          onClick={resetFilters}
          title={t(lang, "resetFiltersHint")}
          className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
        >
          {t(lang, "ganttResetFilters")}
        </button>
      )}
      <button
        type="button"
        onClick={toggleCriticalPath}
        aria-pressed={prefs.showCriticalPath}
        title={t(lang, "ganttCriticalPathHint")}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-1 ${
          prefs.showCriticalPath
            ? "border-AIPM-pink bg-AIPM-pink/10 text-AIPM-dark-blue hover:bg-AIPM-pink/20 focus:ring-AIPM-pink dark:border-AIPM-pink dark:bg-AIPM-pink/15 dark:text-AIPM-light-grey"
            : "border-line bg-surface text-foreground hover:bg-surface-muted focus:ring-AIPM-green"
        }`}
      >
        {/* Diverging-paths glyph — two lines branching from a common origin. */}
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="h-3.5 w-3.5"
        >
          <path d="M4 16 L8 10 L12 13 L16 4" />
          <circle cx="4" cy="16" r="1.2" fill="currentColor" />
          <circle cx="16" cy="4" r="1.2" fill="currentColor" />
        </svg>
        <span>{t(lang, "ganttCriticalPath")}</span>
      </button>
      <PrintButton lang={lang} />
      <ResetSizeButton onClick={resetGanttSize} lang={lang} />
    </div>
  );
}

export function GanttHeader({
  lang,
  monthGroups,
  range,
  today,
  timelineWidthPx,
}: {
  lang: Lang;
  monthGroups: ReadonlyArray<{ label: string; widthPx: number }>;
  range: { min: Date; days: number };
  today: Date;
  timelineWidthPx: number;
}) {
  return (
    <div
      className="sticky top-0 z-20 flex border-b border-line bg-surface-muted text-xs"
      style={{ height: HEADER_HEIGHT_PX }}
    >
      <div
        className="sticky left-0 z-30 flex shrink-0 items-center border-r border-line bg-surface-muted px-3 font-medium uppercase tracking-wide text-muted-foreground"
        style={{ width: LEFT_GUTTER_PX }}
      >
        {t(lang, "task")}
      </div>
      <div
        className="relative flex flex-col"
        style={{ width: timelineWidthPx }}
      >
        <div
          className="flex border-b border-line"
          style={{ height: HEADER_ROW_HEIGHT_PX }}
        >
          {monthGroups.map((g, i) => (
            <div
              key={i}
              className="flex items-center justify-center border-r border-line px-1 text-[11px] font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey"
              style={{ width: g.widthPx }}
              title={g.label}
            >
              <span className="truncate">{g.label}</span>
            </div>
          ))}
        </div>
        <div
          className="flex"
          style={{ height: HEADER_ROW_HEIGHT_PX }}
        >
          {Array.from({ length: range.days }).map((_, i) => {
            const d = addDays(range.min, i);
            const isToday = d.getTime() === today.getTime();
            const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
            return (
              <div
                key={i}
                className={`flex items-center justify-center border-r text-[10px] ${
                  isToday
                    ? "border-AIPM-dark-blue bg-AIPM-dark-blue/10 font-semibold text-AIPM-dark-blue"
                    : isWeekend
                      ? "border-line bg-surface-muted/60 text-muted-foreground"
                      : "border-line text-muted-foreground"
                }`}
                style={{ width: DAY_WIDTH_PX }}
              >
                {fmtDay(d)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function GanttDependencyLayer({
  placeable,
  bars,
  rowIndexById,
  range,
  critical,
  sortedMilestones,
  rowsCount,
  chartWidthPx,
  totalRowsCount,
}: {
  placeable: readonly Task[];
  bars: ReadonlyMap<number, { start: Date; end: Date }>;
  rowIndexById: ReadonlyMap<number, number>;
  range: { min: Date };
  critical: { criticalEdges: ReadonlySet<string> };
  sortedMilestones: readonly Milestone[];
  rowsCount: number;
  chartWidthPx: number;
  totalRowsCount: number;
}) {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute left-0 top-0 z-0"
      width={chartWidthPx}
      height={totalRowsCount * ROW_HEIGHT_PX}
      viewBox={`0 0 ${chartWidthPx} ${totalRowsCount * ROW_HEIGHT_PX}`}
    >
      <defs>
        <marker
          id="gantt-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
          fill={EDGE_STROKE_MUTED}
        >
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
        <marker
          id="gantt-arrow-critical"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
          fill="rgb(220, 38, 38)"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>
      {placeable.flatMap((task, rowIdx) => {
        if (!task.dependencies || task.dependencies.length === 0) {
          return [];
        }
        const myBar = bars.get(task.id);
        if (!myBar) return [];
        const myStartX =
          LEFT_GUTTER_PX +
          diffDays(range.min, myBar.start) * DAY_WIDTH_PX;
        const myEndX =
          LEFT_GUTTER_PX +
          (diffDays(range.min, myBar.end) + 1) * DAY_WIDTH_PX;
        const myYMid = rowIdx * ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2;
        return task.dependencies.map((dep, depIdx) => {
          const predRowIdx = rowIndexById.get(dep.taskId) ?? -1;
          if (predRowIdx < 0) return null;
          const predBar = bars.get(dep.taskId);
          if (!predBar) return null;
          const predStartX =
            LEFT_GUTTER_PX +
            diffDays(range.min, predBar.start) * DAY_WIDTH_PX;
          const predEndX =
            LEFT_GUTTER_PX +
            (diffDays(range.min, predBar.end) + 1) * DAY_WIDTH_PX;
          const predYMid =
            predRowIdx * ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2;

          // Pick which edges of each bar the arrow connects.
          let x1: number;
          let x2: number;
          switch (dep.type) {
            case "FS":
              x1 = predEndX;
              x2 = myStartX;
              break;
            case "SS":
              x1 = predStartX;
              x2 = myStartX;
              break;
            case "FF":
              x1 = predEndX;
              x2 = myEndX;
              break;
            case "SF":
              x1 = predStartX;
              x2 = myEndX;
              break;
          }
          // Simple elbow with curved corners.
          const midX = (x1 + x2) / 2;
          const path = `M ${x1} ${predYMid} C ${midX} ${predYMid}, ${midX} ${myYMid}, ${x2} ${myYMid}`;
          const isCritical = critical.criticalEdges.has(
            edgeKey(dep.taskId, task.id, dep.type),
          );
          return (
            <path
              key={`${task.id}-${depIdx}`}
              d={path}
              stroke={isCritical ? "rgb(220, 38, 38)" : EDGE_STROKE_MUTED}
              strokeOpacity={isCritical ? 0.85 : 0.45}
              strokeWidth={isCritical ? 2 : 1.25}
              fill="none"
              markerEnd={
                isCritical ? "url(#gantt-arrow-critical)" : "url(#gantt-arrow)"
              }
            />
          );
        });
      })}
      {/* Linked-task -> milestone connectors. Informational only:
          a faint, thin line from each linked task's bar end to its
          milestone diamond. Deliberately NOT the critical-path red —
          a muted grey dash (lighter than the non-critical dependency
          edge) so it reads as context, not a schedule driver.
          Linked tasks with no bar (deleted/filtered) are skipped. */}
      {sortedMilestones.flatMap((m, mIdx) => {
        const md = parseISO(m.date);
        if (!md) return [];
        const milestoneX =
          LEFT_GUTTER_PX + diffDays(range.min, md) * DAY_WIDTH_PX;
        const milestoneYMid =
          (rowsCount + mIdx) * ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2;
        return (m.linkedTaskIds ?? []).flatMap((taskId) => {
          const bar = bars.get(taskId);
          if (!bar) return [];
          const taskRowIdx = rowIndexById.get(taskId) ?? -1;
          if (taskRowIdx < 0) return [];
          const taskEndX =
            LEFT_GUTTER_PX +
            (diffDays(range.min, bar.end) + 1) * DAY_WIDTH_PX;
          const taskYMid =
            taskRowIdx * ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2;
          const midX = (taskEndX + milestoneX) / 2;
          const path = `M ${taskEndX} ${taskYMid} C ${midX} ${taskYMid}, ${midX} ${milestoneYMid}, ${milestoneX} ${milestoneYMid}`;
          return (
            <path
              key={`m-${m.id}-link-${taskId}`}
              d={path}
              data-milestone-connector
              stroke={EDGE_STROKE_MUTED}
              strokeOpacity={0.35}
              strokeWidth={1}
              strokeDasharray="3 3"
              fill="none"
            />
          );
        });
      })}
    </svg>
  );
}
