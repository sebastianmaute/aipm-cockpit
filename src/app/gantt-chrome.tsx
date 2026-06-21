// src/app/gantt-chrome.tsx — presentational chrome for the Gantt chart:
// the filter/sort toolbar and the month/day time-axis header. Both are pure
// (no local state); GanttPanel owns the data + handlers and passes them in.
import { type Lang, t } from "./i18n";
import { PrintButton, ResetSizeButton } from "./task-manager-ui";
import { PRIORITIES, type Priority } from "./types";
import {
  addDays,
  DAY_WIDTH_PX,
  fmtDay,
  type GanttPrefs,
  type GanttSort,
  type GanttStatusFilter,
  HEADER_HEIGHT_PX,
  HEADER_ROW_HEIGHT_PX,
  LEFT_GUTTER_PX,
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
          className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90"
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
          className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90"
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
        className="min-w-[12rem] flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green"
      />
      <select
        value={prefs.status}
        onChange={(e) =>
          setStatusFilter(e.target.value as GanttStatusFilter)
        }
        aria-label={t(lang, "ganttFilterStatus")}
        title={t(lang, "ganttStatusFilterHint")}
        className="h-[30px] rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green"
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
        className="h-[30px] rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green"
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
        className="h-[30px] rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green"
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
          className="h-[30px] rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green"
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
          className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted"
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
