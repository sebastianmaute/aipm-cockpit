"use client";

// src/app/gantt-chart.tsx — the Gantt's scrollable chart surface: the sticky
// day/month header, the decorative holiday + grid layers, the today marker, the
// dependency-arrow overlay, the interleaved task/milestone row list, the
// trailing "add task" affordance and the date-range footer.
//
// Presentational, in the same sense as gantt-chrome.tsx and gantt-rows.tsx:
// GanttPanel owns every piece of derived data, the drag state and the handlers
// and threads them in. The ONE piece of state that lives here is `wrapperRef`,
// which nothing outside this file ever read — the outer `scrollRef` stays with
// the panel because its initial-scroll layout effect needs it.
//
// It also owns the "the chart body would render nothing" branch. The message
// KEY is still decided by the panel (`emptyMessageKey`), because the panel's own
// whole-pane empty state shows the same copy and a second inline copy of that
// ternary is how the two drift.

import { useRef } from "react";
import { PlusIcon } from "./icons";
import { type Lang, t } from "./i18n";
import { GanttDependencyLayer, GanttHeader } from "./gantt-chrome";
import { GanttGridLayer, GanttNonWorkingLayer } from "./gantt-overlays";
import { GanttMilestoneRow, GanttTaskRow } from "./gantt-rows";
import { type Absence, type Milestone, type Resource, type Task } from "./types";
import { type BarDrag, type GanttBarDrag } from "./use-gantt-bar-drag";
import {
  fmtFull,
  type GanttBarEdit,
  type GanttPrefs,
  type GanttRow,
  ROW_HEIGHT_PX,
} from "./gantt-engine";

/** The three "why is this empty" strings, decided once by GanttPanel. */
export type GanttEmptyMessageKey =
  | "ganttNoStatusSelected"
  | "ganttNoMatches"
  | "ganttEmpty";

export function GanttChart({
  scrollRef,
  lang,
  prefs,
  range,
  monthGroups,
  today,
  todayISO,
  timelineWidthPx,
  nameColWidth,
  chartWidthPx,
  todayOffsetPx,
  onStartNameColResize,
  rendersNothing,
  emptyMessageKey,
  holidaySet,
  totalRowsCount,
  rows,
  bars,
  placeable,
  taskRowIndexById,
  milestoneRowIndexById,
  critical,
  visibleMilestones,
  absencesByAssigneeKey,
  resourcesById,
  tasksById,
  draggingId,
  dropTargetId,
  setDraggingId,
  setDropTargetId,
  handleDrop,
  interactingWithBarRef,
  barDrag,
  barDragDeltaDays,
  previewDates,
  startBarDrag,
  onUpdateBar,
  onEditTask,
  onEditMilestone,
  onAddTask,
  baselineMilestoneDates,
}: {
  /** The outer overflow-auto container — the panel's initial-scroll effect
   *  targets it, so the ref is created there and threaded down. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  lang: Lang;
  prefs: GanttPrefs;
  range: { min: Date; max: Date; days: number };
  monthGroups: ReadonlyArray<{ label: string; widthPx: number }>;
  today: Date;
  todayISO: string;
  timelineWidthPx: number;
  nameColWidth: number;
  chartWidthPx: number;
  todayOffsetPx: number;
  onStartNameColResize?: (e: React.MouseEvent) => void;
  /** True when the row list is empty — see GanttPanel's `rendersNothing`. */
  rendersNothing: boolean;
  emptyMessageKey: GanttEmptyMessageKey;
  holidaySet: ReadonlySet<string>;
  totalRowsCount: number;
  rows: readonly GanttRow[];
  bars: ReadonlyMap<number, { start: Date; end: Date }>;
  placeable: readonly Task[];
  taskRowIndexById: ReadonlyMap<number, number>;
  milestoneRowIndexById: ReadonlyMap<number, number>;
  critical: { criticalTasks: ReadonlySet<number>; criticalEdges: ReadonlySet<string> };
  visibleMilestones: readonly Milestone[];
  absencesByAssigneeKey: ReadonlyMap<string, Absence[]>;
  resourcesById: ReadonlyMap<number, Resource>;
  tasksById: ReadonlyMap<number, Task>;
  draggingId: number | null;
  dropTargetId: number | null;
  setDraggingId: (id: number | null) => void;
  setDropTargetId: (id: number | null) => void;
  handleDrop: (fromId: number, toId: number) => void;
  interactingWithBarRef: React.MutableRefObject<boolean>;
  barDrag: BarDrag | null;
  barDragDeltaDays: number;
  previewDates: GanttBarDrag["previewDates"];
  startBarDrag: GanttBarDrag["startBarDrag"];
  onUpdateBar?: (edit: GanttBarEdit) => void;
  onEditTask?: (task: Task) => void;
  onEditMilestone?: (m: Milestone) => void;
  onAddTask?: () => void;
  baselineMilestoneDates?: ReadonlyMap<number, string>;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  return (
    <div
      ref={scrollRef}
      className="min-h-[240px] w-full min-w-[480px] flex-1 overflow-auto rounded-md border border-line pr-2"
    >
      <div
        ref={wrapperRef}
        style={{ width: chartWidthPx, minWidth: "100%" }}
        className="relative bg-surface"
      >
        {/* --- top header rows: months + days -------------------------- */}
        <GanttHeader
          lang={lang}
          monthGroups={monthGroups}
          range={range}
          today={today}
          timelineWidthPx={timelineWidthPx}
          nameColWidth={nameColWidth}
          onStartNameColResize={onStartNameColResize}
        />

        {/* --- rows ----------------------------------------------------- */}
        {rendersNothing ? (
          // Header and toolbar stay mounted on purpose — the way back out of
          // this state lives in the toolbar (the status checkboxes, the other
          // filter controls, or Reset filters), so unmounting it would strand
          // the user.
          <div className="flex flex-col items-center gap-3 border-t border-line p-10 text-center text-sm text-muted-foreground">
            <span>{t(lang, emptyMessageKey)}</span>
          </div>
        ) : (
          <div className="relative">
            {/* Holiday shading + the optional day grid. Rendered FIRST so they
                paint underneath the today marker, the dependency arrows and the
                bars; both are pointer-events-none, so they can't intercept a bar
                drag. Their height matches the today marker's exactly — the task +
                milestone rows, not the trailing "add task" affordance. */}
            {prefs.showHolidays && (
              <GanttNonWorkingLayer
                range={range}
                holidaySet={holidaySet}
                nameColWidth={nameColWidth}
                heightPx={totalRowsCount * ROW_HEIGHT_PX}
              />
            )}
            {prefs.showGrid && (
              <GanttGridLayer
                range={range}
                nameColWidth={nameColWidth}
                heightPx={totalRowsCount * ROW_HEIGHT_PX}
              />
            )}

            {/* Today marker — drawn as an absolutely positioned line that
                spans the rows area. Sits behind the bars (z-0) but on top
                of the row backgrounds. */}
            {todayOffsetPx >= nameColWidth && (
              <div
                aria-hidden
                className="pointer-events-none absolute z-10 w-px bg-ui-dark-blue/60"
                style={{
                  left: todayOffsetPx,
                  top: 0,
                  height: totalRowsCount * ROW_HEIGHT_PX,
                }}
                title={t(lang, "ganttToday")}
              />
            )}

            {/* Dependency arrow layer — sits over the rows but under the bars
                for hover contrast. Gated on the View popover's Dependencies
                toggle; it also carries the linked-task -> milestone connectors,
                so turning it off hides both overlays.
                ★ An edge draws only when BOTH endpoints are rendered rows: a
                predecessor with no due date has no bar (deriveBar returns null),
                and one excluded by the status/priority/assignee/search filters
                has no row index, so either way the arrow is silently skipped. */}
            {prefs.showDependencies && (
              <GanttDependencyLayer
                placeable={placeable}
                bars={bars}
                taskRowIndexById={taskRowIndexById}
                range={range}
                critical={critical}
                sortedMilestones={visibleMilestones}
                milestoneRowIndexById={milestoneRowIndexById}
                chartWidthPx={chartWidthPx}
                totalRowsCount={totalRowsCount}
                nameColWidth={nameColWidth}
              />
            )}

            {/* --- rows: task bars + milestone diamonds. In "below" mode all
                task rows come first, then the milestone block; in "inline" mode
                each non-achieved milestone is spliced into the task sequence at
                its due-date position (buildGanttRows). Milestone rows aren't part
                of the critical-path / dependency math. */}
            {rows.map((row) => {
              if (row.kind === "task") {
                const task = row.task;
                const bar = bars.get(task.id);
                if (!bar) return null;
                return (
                  <GanttTaskRow
                    key={`t-${task.id}`}
                    task={task}
                    bar={bar}
                    lang={lang}
                    today={today}
                    timelineWidthPx={timelineWidthPx}
                    nameColWidth={nameColWidth}
                    range={range}
                    absencesByAssigneeKey={absencesByAssigneeKey}
                    showAbsences={prefs.showAbsences}
                    resourcesById={resourcesById}
                    critical={critical}
                    draggingId={draggingId}
                    dropTargetId={dropTargetId}
                    setDraggingId={setDraggingId}
                    setDropTargetId={setDropTargetId}
                    handleDrop={handleDrop}
                    interactingWithBarRef={interactingWithBarRef}
                    barDrag={barDrag}
                    barDragDeltaDays={barDragDeltaDays}
                    previewDates={previewDates}
                    startBarDrag={startBarDrag}
                    onUpdateBar={onUpdateBar}
                    onEditTask={onEditTask}
                  />
                );
              }
              const m = row.milestone;
              return (
                <GanttMilestoneRow
                  key={`m-${m.id}`}
                  m={m}
                  lang={lang}
                  range={range}
                  timelineWidthPx={timelineWidthPx}
                  nameColWidth={nameColWidth}
                  tasksById={tasksById}
                  todayISO={todayISO}
                  onEditMilestone={onEditMilestone}
                  baselineDate={baselineMilestoneDates?.get(m.id)}
                  showBaseline={prefs.showBaseline}
                />
              );
            })}

            {onAddTask && (
              <div
                role="button"
                tabIndex={0}
                onClick={onAddTask}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onAddTask();
                  }
                }}
                className="group relative flex cursor-pointer border-b border-dashed border-line hover:bg-surface-muted"
                style={{ height: ROW_HEIGHT_PX }}
                aria-label={t(lang, "addTaskButton")}
              >
                <div
                  className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-line bg-surface px-3 text-xs text-muted-foreground group-hover:text-ui-dark-blue"
                  style={{ width: nameColWidth }}
                >
                  <PlusIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                  <span>{t(lang, "ganttAddTask")}</span>
                </div>
                <div style={{ width: timelineWidthPx }} />
              </div>
            )}
          </div>
        )}

        {/* --- Footer with the date range so it's visible without hover -- */}
        <div
          className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-line bg-surface-muted px-3 py-1 text-[11px] text-muted-foreground"
          style={{ minHeight: 22 }}
        >
          <span>
            {t(lang, "ganttRange", fmtFull(range.min, lang), fmtFull(range.max, lang))}
          </span>
        </div>
      </div>
    </div>
  );
}
