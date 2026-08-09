// src/app/gantt-chrome.tsx — presentational chrome for the Gantt chart:
// the filter/sort toolbar, the month/day time-axis header, and the
// dependency/connector arrow overlay. All pure (no local state); GanttPanel
// owns the data + handlers and passes them in.
import type { ReactNode } from "react";
import { EllipsisVerticalIcon } from "@heroicons/react/24/outline";
import { type Lang, t } from "./i18n";
import { FilterMultiSelect, type FilterOption } from "./filter-multiselect";
import { Input, Select } from "./form-controls";
import { ClearableSearchInput } from "./clearable-search-input";
import { INTERACTIVE } from "./interaction-styles";
import { AddButton } from "./pane-toolbar";
import { PrintButton, ResetColWidthsIcon, ResetSizeButton } from "./task-manager-ui";
import { IconButton } from "./icon-button";
import { GanttViewMenu } from "./gantt-view-menu";
import { PRIORITIES, type Milestone, type Priority, type Task } from "./types";
import {
  addDays,
  DAY_ROW_HEIGHT_PX,
  DAY_WIDTH_PX,
  diffDays,
  EDGE_STROKE_MUTED,
  edgeKey,
  fmtDay,
  fmtWeekdayShort,
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
  toggleHolidays,
  toggleAbsences,
  toggleDependencies,
  toggleMilestones,
  toggleGrid,
  dedupButton,
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
  toggleHolidays: () => void;
  toggleAbsences: () => void;
  toggleDependencies: () => void;
  toggleMilestones: () => void;
  toggleGrid: () => void;
  /**
   * The AI "Deduplicate & unify" trigger, pre-built by the view wrapper
   * (it needs settings/setTasks/undo-capture the chart never sees). Null
   * whenever the feature is unavailable (AI off, popout, <2 tasks).
   */
  dedupButton?: ReactNode;
}) {
  return (
    <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2 print:hidden">
      {onAddTask && (
        <AddButton
          onClick={onAddTask}
          aria-label={t(lang, "addTaskButton")}
          title={t(lang, "addTaskButton")}
        >
          + {t(lang, "addTaskButton")}
        </AddButton>
      )}
      {onAddMilestone && (
        <AddButton
          onClick={onAddMilestone}
          aria-label={t(lang, "ganttAddMilestone")}
          title={t(lang, "ganttAddMilestone")}
        >
          + {t(lang, "ganttAddMilestone")}
        </AddButton>
      )}
      {dedupButton}
      {/* Stays AFTER the add buttons: a source-order test in gantt.test.tsx
          pins `onClick={onAddTask}` ahead of this file's `type="search"`. */}
      <ClearableSearchInput
        value={prefs.search}
        onClear={() => setSearch("")}
        clearLabel={`${t(lang, "clear")} – ${t(lang, "searchPlaceholder")}`}
        className="min-w-[12rem] flex-1"
      >
        <Input
          type="search"
          size="xs"
          value={prefs.search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t(lang, "searchPlaceholder")}
          aria-label={t(lang, "searchPlaceholder")}
          title={t(lang, "ganttSearchHint")}
          className={`w-full [&::-webkit-search-cancel-button]:appearance-none${prefs.search ? " pr-8" : ""}`}
        />
      </ClearableSearchInput>
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
        <Select
          size="xs"
          value={prefs.sort}
          onChange={(e) => setSort(e.target.value as GanttSort)}
          aria-label={t(lang, "ganttSortLabel")}
          title={t(lang, "ganttSortHint")}
          className="h-[30px]"
        >
          <option value="auto">{t(lang, "ganttSortAuto")}</option>
          <option value="due">{t(lang, "ganttSortDue")}</option>
          <option value="name">{t(lang, "ganttSortName")}</option>
          <option value="priority">{t(lang, "ganttSortPriority")}</option>
          <option value="custom" disabled={prefs.customOrder.length === 0}>
            {t(lang, "ganttSortCustom")}
          </option>
        </Select>
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
      {/* Every display toggle lives in one popover — eight chips inline would
        * have swamped this row. It is a LEADING control, so the convention only
        * requires it to come BEFORE the trailing group. */}
      <GanttViewMenu
        lang={lang}
        prefs={prefs}
        hasBaseline={hasBaseline}
        hasMilestones={hasMilestones}
        toggleCriticalPath={toggleCriticalPath}
        toggleBaseline={toggleBaseline}
        toggleMilestonePlacement={toggleMilestonePlacement}
        toggleHolidays={toggleHolidays}
        toggleAbsences={toggleAbsences}
        toggleDependencies={toggleDependencies}
        toggleMilestones={toggleMilestones}
        toggleGrid={toggleGrid}
      />
      {/* Trailing group, ordered as everywhere else: Print · reset-columns ·
        * reset-pane-size. The column reset carries the COLUMNS icon — it wore
        * the reset-size glyph, making the two adjacent resets indistinguishable. */}
      <PrintButton lang={lang} />
      <IconButton
        variant="bordered"
        size="md"
        onClick={resetNameColWidth}
        label={t(lang, "ganttResetNameCol")}
        title={t(lang, "ganttResetNameCol")}
      >
        <ResetColWidthsIcon />
      </IconButton>
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
            className="absolute right-0 top-0 z-40 flex h-full w-2 cursor-col-resize select-none items-center justify-center text-muted-foreground/60 transition-colors hover:bg-ui-dark-blue/10 hover:text-ui-dark-blue active:text-ui-dark-blue print:hidden"
          >
            <EllipsisVerticalIcon aria-hidden="true" className="h-4 w-4" />
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
              className="flex items-center justify-center border-r border-line px-1 text-[11px] font-semibold text-ui-dark-blue dark:text-ui-light-grey"
              style={{ width: g.widthPx }}
              title={g.label}
            >
              <span className="truncate">{g.label}</span>
            </div>
          ))}
        </div>
        <div
          className="flex"
          style={{ height: DAY_ROW_HEIGHT_PX }}
        >
          {Array.from({ length: range.days }).map((_, i) => {
            const d = addDays(range.min, i);
            const isToday = d.getTime() === today.getTime();
            const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
            return (
              <div
                key={i}
                className={`flex flex-col items-center justify-center border-r text-[10px] leading-none ${
                  isToday
                    ? "border-ui-dark-blue bg-ui-dark-blue/10 font-semibold text-ui-dark-blue dark:text-foreground"
                    : isWeekend
                      ? "border-line bg-surface-muted/60 text-muted-foreground"
                      : "border-line text-muted-foreground"
                }`}
                style={{ width: DAY_WIDTH_PX }}
              >
                <span>{fmtDay(d)}</span>
                {/* ★ The today cell owns a deliberate accent colour; letting the
                    weekday line force `text-muted-foreground` there would undo it.
                    Inherit in that one case, mute otherwise. */}
                <span className={isToday ? "text-[9px]" : "text-[9px] text-muted-foreground"}>
                  {fmtWeekdayShort(d, lang)}
                </span>
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
              // The non-critical arm was 0.45 / 1.25, which composites
              // EDGE_STROKE_MUTED to a pale grey barely separable from the
              // `border-line` row separators it crosses. The critical arm keeps
              // its heavier values so the red chain stays the stronger signal.
              strokeOpacity={isCritical ? 0.85 : 0.7}
              strokeWidth={isCritical ? 2 : 1.5}
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
