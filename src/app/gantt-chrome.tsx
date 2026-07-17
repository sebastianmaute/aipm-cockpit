// src/app/gantt-chrome.tsx — presentational chrome for the Gantt chart:
// the filter/sort toolbar, the month/day time-axis header, and the
// dependency/connector arrow overlay. All pure (no local state); GanttPanel
// owns the data + handlers and passes them in.
import { type Lang, t } from "./i18n";
import { FilterMultiSelect, type FilterOption } from "./filter-multiselect";
import { FOCUS_RING, INTERACTIVE, TRANSITION } from "./interaction-styles";
import { PrintButton, ResetSizeButton, ResetSizeIcon } from "./task-manager-ui";
import { PRIORITIES, type Milestone, type Priority, type Task } from "./types";
import {
  addDays,
  DAY_WIDTH_PX,
  diffDays,
  EDGE_STROKE_MUTED,
  edgeKey,
  fmtDay,
  GANTT_STATUS_VALUES,
  type GanttPrefs,
  type GanttSort,
  type GanttStatus,
  HEADER_HEIGHT_PX,
  HEADER_ROW_HEIGHT_PX,
  parseISO,
  ROW_HEIGHT_PX,
} from "./gantt-engine";

/** i18n key for each status bucket's label. */
const STATUS_LABEL_KEY: Record<GanttStatus, "ganttStatusOpen" | "ganttStatusCompleted" | "ganttStatusOverdue"> = {
  open: "ganttStatusOpen",
  completed: "ganttStatusCompleted",
  overdue: "ganttStatusOverdue",
};

export function GanttToolbar({
  lang,
  prefs,
  assigneeOptions,
  filtersActive,
  onAddTask,
  onAddMilestone,
  resetGanttSize,
  resetNameColWidth,
  setSearch,
  toggleStatus,
  togglePriority,
  toggleAssignee,
  setSort,
  resetFilters,
  toggleCriticalPath,
  toggleBaseline,
  hasBaseline,
  toggleMilestonePlacement,
  hasMilestones,
}: {
  lang: Lang;
  prefs: GanttPrefs;
  assigneeOptions: readonly string[];
  filtersActive: boolean;
  onAddTask?: () => void;
  onAddMilestone?: () => void;
  resetGanttSize: () => void;
  resetNameColWidth: () => void;
  setSearch: (search: string) => void;
  toggleStatus: (status: GanttStatus) => void;
  togglePriority: (priority: Priority) => void;
  toggleAssignee: (assignee: string) => void;
  setSort: (sort: GanttSort) => void;
  resetFilters: () => void;
  toggleCriticalPath: () => void;
  toggleBaseline: () => void;
  hasBaseline: boolean;
  toggleMilestonePlacement: () => void;
  hasMilestones: boolean;
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
      <FilterMultiSelect
        lang={lang}
        label={t(lang, "ganttFilterStatus")}
        hint={t(lang, "ganttStatusFilterHint")}
        options={GANTT_STATUS_VALUES.map(
          (s): FilterOption<GanttStatus> => ({ value: s, label: t(lang, STATUS_LABEL_KEY[s]) }),
        )}
        selected={prefs.statuses}
        onToggle={toggleStatus}
      />
      <FilterMultiSelect
        lang={lang}
        label={t(lang, "priority")}
        hint={t(lang, "priorityFilterHint")}
        options={PRIORITIES.map((p): FilterOption<Priority> => ({ value: p, label: p }))}
        selected={prefs.priorities}
        onToggle={togglePriority}
      />
      <FilterMultiSelect
        lang={lang}
        label={t(lang, "assignee")}
        hint={t(lang, "assigneeFilterHint")}
        options={assigneeOptions.map((a): FilterOption<string> => ({ value: a, label: a }))}
        selected={prefs.assignees}
        onToggle={toggleAssignee}
      />
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
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 ${
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
      {hasBaseline && (
        <button
          type="button"
          onClick={toggleBaseline}
          aria-pressed={prefs.showBaseline}
          title={t(lang, "ganttBaselineHint")}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 ${
            prefs.showBaseline
              ? "border-AIPM-dark-blue bg-AIPM-dark-blue/10 text-AIPM-dark-blue hover:bg-AIPM-dark-blue/20 focus:ring-AIPM-dark-blue dark:border-AIPM-dark-blue dark:bg-AIPM-dark-blue/20 dark:text-AIPM-light-grey"
              : "border-line bg-surface text-foreground hover:bg-surface-muted focus:ring-AIPM-green"
          }`}
        >
          {/* ghost + solid diamond glyph — baseline vs current */}
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            aria-hidden="true"
            className="h-3.5 w-3.5"
          >
            <rect x={2} y={7} width={5} height={5} transform="rotate(45 4.5 9.5)" />
            <rect x={11} y={7} width={5} height={5} transform="rotate(45 13.5 9.5)" fill="currentColor" />
          </svg>
          <span>{t(lang, "ganttBaseline")}</span>
        </button>
      )}
      {hasMilestones && (
        <button
          type="button"
          onClick={toggleMilestonePlacement}
          // Toggle-button name/state coherence: the visible label is pinned to
          // what the toggle ENABLES ("Inline milestones") and aria-pressed
          // tracks THAT state, so "Inline milestones, pressed" ⇒ inline is on.
          aria-pressed={prefs.milestonePlacement === "inline"}
          title={t(lang, "ganttMilestonesInlineHint")}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 ${
            prefs.milestonePlacement === "inline"
              ? "border-AIPM-dark-blue bg-AIPM-dark-blue/10 text-AIPM-dark-blue hover:bg-AIPM-dark-blue/20 focus:ring-AIPM-dark-blue dark:border-AIPM-dark-blue dark:bg-AIPM-dark-blue/20 dark:text-AIPM-light-grey"
              : "border-line bg-surface text-foreground hover:bg-surface-muted focus:ring-AIPM-green"
          }`}
        >
          {/* Diamond-between-rows glyph — a milestone marker interleaved among
              horizontal task rows. */}
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            aria-hidden="true"
            className="h-3.5 w-3.5"
          >
            <line x1={3} y1={5} x2={17} y2={5} />
            <line x1={3} y1={15} x2={17} y2={15} />
            <rect x={8} y={8} width={4} height={4} transform="rotate(45 10 10)" fill="currentColor" stroke="none" />
          </svg>
          <span>{t(lang, "ganttMilestonesInline")}</span>
        </button>
      )}
      <button
        type="button"
        onClick={resetNameColWidth}
        aria-label={t(lang, "ganttResetNameCol")}
        title={t(lang, "ganttResetNameCol")}
        className={`rounded-md border border-line bg-surface p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground ${INTERACTIVE}`}
      >
        <ResetSizeIcon />
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
  nameColWidth,
  onStartNameColResize,
}: {
  lang: Lang;
  monthGroups: ReadonlyArray<{ label: string; widthPx: number }>;
  range: { min: Date; days: number };
  today: Date;
  timelineWidthPx: number;
  nameColWidth: number;
  onStartNameColResize?: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className="sticky top-0 z-20 flex border-b border-line bg-surface-muted text-xs"
      style={{ height: HEADER_HEIGHT_PX }}
    >
      <div
        className="sticky left-0 z-30 flex shrink-0 items-center border-r border-line bg-surface-muted px-3 font-medium uppercase tracking-wide text-muted-foreground relative"
        style={{ width: nameColWidth }}
      >
        {t(lang, "task")}
        {onStartNameColResize && (
          <div
            role="button"
            aria-label={t(lang, "ganttResizeNameCol")}
            title={t(lang, "ganttResizeNameCol")}
            onMouseDown={onStartNameColResize}
            className="absolute right-0 top-0 z-40 flex h-full w-2 cursor-col-resize select-none items-center justify-center text-muted-foreground/60 transition-colors hover:bg-AIPM-dark-blue/10 hover:text-AIPM-dark-blue active:text-AIPM-dark-blue print:hidden"
          >
            <svg viewBox="0 0 2 12" width="2" height="12" fill="currentColor" aria-hidden="true">
              <circle cx="1" cy="2" r="1" />
              <circle cx="1" cy="6" r="1" />
              <circle cx="1" cy="10" r="1" />
            </svg>
          </div>
        )}
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
                    ? "border-AIPM-dark-blue bg-AIPM-dark-blue/10 font-semibold text-AIPM-dark-blue dark:text-foreground"
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
  taskRowIndexById,
  range,
  critical,
  sortedMilestones,
  milestoneRowIndexById,
  chartWidthPx,
  totalRowsCount,
  nameColWidth,
}: {
  placeable: readonly Task[];
  bars: ReadonlyMap<number, { start: Date; end: Date }>;
  /** Task id → its row index in the FULL (task + milestone) row list. */
  taskRowIndexById: ReadonlyMap<number, number>;
  range: { min: Date };
  critical: { criticalEdges: ReadonlySet<string> };
  sortedMilestones: readonly Milestone[];
  /** Milestone id → its row index in the FULL row list. */
  milestoneRowIndexById: ReadonlyMap<number, number>;
  chartWidthPx: number;
  totalRowsCount: number;
  nameColWidth: number;
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
      {placeable.flatMap((task) => {
        if (!task.dependencies || task.dependencies.length === 0) {
          return [];
        }
        const myBar = bars.get(task.id);
        if (!myBar) return [];
        // Row index is looked up (not the map index) so arrows stay aligned
        // when milestone rows are interleaved among the task rows (inline mode).
        const rowIdx = taskRowIndexById.get(task.id) ?? -1;
        if (rowIdx < 0) return [];
        const myStartX =
          nameColWidth +
          diffDays(range.min, myBar.start) * DAY_WIDTH_PX;
        const myEndX =
          nameColWidth +
          (diffDays(range.min, myBar.end) + 1) * DAY_WIDTH_PX;
        const myYMid = rowIdx * ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2;
        return task.dependencies.map((dep, depIdx) => {
          const predRowIdx = taskRowIndexById.get(dep.taskId) ?? -1;
          if (predRowIdx < 0) return null;
          const predBar = bars.get(dep.taskId);
          if (!predBar) return null;
          const predStartX =
            nameColWidth +
            diffDays(range.min, predBar.start) * DAY_WIDTH_PX;
          const predEndX =
            nameColWidth +
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
      {sortedMilestones.flatMap((m) => {
        const md = parseISO(m.date);
        if (!md) return [];
        const mRowIdx = milestoneRowIndexById.get(m.id) ?? -1;
        if (mRowIdx < 0) return [];
        const milestoneX =
          nameColWidth + diffDays(range.min, md) * DAY_WIDTH_PX;
        const milestoneYMid =
          mRowIdx * ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2;
        return (m.linkedTaskIds ?? []).flatMap((taskId) => {
          const bar = bars.get(taskId);
          if (!bar) return [];
          const taskRowIdx = taskRowIndexById.get(taskId) ?? -1;
          if (taskRowIdx < 0) return [];
          const taskEndX =
            nameColWidth +
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
