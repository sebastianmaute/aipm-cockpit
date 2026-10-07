"use client";
// src/app/tasks-section-rows.tsx — the Open Points TABLE: column widths, the
// sortable header, the task rows, the "no matches" row and the trailing
// "+ Add task" row. Split out of `tasks-section.tsx` (§492, the panel-split
// convention in AGENTS.md). PURE PRESENTATIONAL: data and handlers arrive as
// props and this file calls no hook of its own.
//
// ★★ It must render INSIDE the orchestrator's `RowContextProvider`: every
// `TaskRow` reads its handlers from that context (`useTaskRowContext`).
//
// ★★ Above `VIRTUALIZE_MIN_ROWS` rows it renders only `rowWindow`'s slice of
// `visibleRows`, between two aria-hidden spacer rows (§5). The window is
// computed by the ORCHESTRATOR (`useTaskRowWindow` in tasks-section.tsx), not
// here, because the deep-link flash there needs its `scrollToIndex`; this file
// stays hook-free. A row's stripe and `aria-rowindex` come from its index in
// the WHOLE list, never its position in the slice.
import type React from "react";
import { PlusIcon } from "./icons";
import { type Lang, t } from "./i18n";
import type { ChangeItem, RaidItem, Task } from "./types";
import type { ProjectDocument } from "./document-model";
import type { SortKey } from "./filters-context";
import { TaskRow } from "./task-row";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { Th } from "./task-manager-ui";
import { SortResizeTh, type useSortHeaderProps } from "./report-table";
import { INTERACTIVE } from "./interaction-styles";
import { TOUR_ANCHORS } from "./app-tour";
import { GUTTER_WIDTH_PX, colWidthStyle, type TaskColId } from "./open-points-table-geometry";
import type { TaskRowWindow } from "./use-task-row-window";

export interface TasksTableProps {
  lang: Lang;
  visibleCols: readonly TaskColId[];
  sizedWidths: Partial<Record<string, number>>;
  tableMinWidth: number;
  /** The four props every sortable header repeats (`useSortHeaderProps`). */
  th: ReturnType<typeof useSortHeaderProps<SortKey>>;
  hiddenCols: Set<string>;
  startColResize: (col: string, e: React.MouseEvent) => void;
  allVisibleSelected: boolean;
  toggleSelectAllVisible: () => void;
  visibleRows: readonly Task[];
  visibleColumnCount: number;
  tableTokens: ReadonlyMap<number, string>;
  selectedIds: Set<number>;
  editingId: number | null;
  pushingIds: Set<number>;
  raidByTask: Map<number, RaidItem[]>;
  changeByTask: Map<number, ChangeItem[]>;
  documentsByEntity: ReadonlyMap<string, readonly ProjectDocument[]>;
  onOpenDocuments: (taskId: number) => void;
  onJumpToChanges: (taskId: number) => void;
  flashId: number | null;
  /** Opens the task editor for a NEW task (discarding any in-progress edit). */
  onAdd: () => void;
  /** Which slice of `visibleRows` to render (`useTaskRowWindow`, §5). */
  rowWindow: TaskRowWindow;
}

/** A spacer standing in for the rows outside the window. One cell spanning the
 *  gutter plus every visible column, so it can never narrow the table. */
function SpacerRow({ height, colSpan }: { height: number; colSpan: number }) {
  return (
    <tr aria-hidden="true" data-row-spacer="">
      <td colSpan={colSpan} style={{ height: `${height}px`, padding: 0 }} />
    </tr>
  );
}

export function TasksTable({
  lang, visibleCols, sizedWidths, tableMinWidth, th, hiddenCols, startColResize, allVisibleSelected,
  toggleSelectAllVisible, visibleRows, visibleColumnCount, tableTokens, selectedIds, editingId, pushingIds,
  raidByTask, changeByTask, documentsByEntity, onOpenDocuments, onJumpToChanges, flashId, onAdd, rowWindow,
}: TasksTableProps) {
  const windowed = rowWindow.enabled;
  const rendered = windowed ? visibleRows.slice(rowWindow.start, rowWindow.end) : visibleRows;
  // Header row + every task + the trailing "+ Add task" row (ARIA 1-based).
  const addRowIndex = visibleRows.length + 2;
  return (
    <table
      className="divide-y divide-line text-left text-sm"
      style={{ tableLayout: "fixed", width: "100%", minWidth: `${tableMinWidth}px` }}
      aria-rowcount={windowed ? addRowIndex : undefined}
    >
      <colgroup>
        {/* Gutter for the hover Ask-Claude cell; a missing <col> shifts every width to its
            neighbour. ★ Uses the same GUTTER_WIDTH_PX that tableMinWidthPx sums, not a class. */}
        <col style={{ width: GUTTER_WIDTH_PX }} />
        {visibleCols.map((col) => (
          <col key={col} style={{ width: colWidthStyle(col, sizedWidths) }} />
        ))}
      </colgroup>
      <thead className={TABLE_HEAD_CLASS}>
        <tr aria-rowindex={windowed ? 1 : undefined}>
          {/* Leading gutter matching the per-row hover Ask-Claude cell. */}
          <th className="w-7" aria-hidden="true" />
          <Th padding="tight" onResize={(e) => startColResize("sel", e)}>
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAllVisible}
              aria-label={t(lang, "selectAllVisible")}
              data-tour-id={TOUR_ANCHORS.selectAll}
              className="h-4 w-4 cursor-pointer rounded border-line text-ui-dark-blue focus:ring-ui-green"
            />
          </Th>
          {!hiddenCols.has("status") && <Th padding="tight" onResize={(e) => startColResize("status", e)}><span className="sr-only">{t(lang, "health")}</span></Th>}
          {!hiddenCols.has("id") && <SortResizeTh {...th} label={t(lang, "id")} sortCol="id" title={t(lang, "sortBy", t(lang, "id"))} />}
          <SortResizeTh {...th} label={t(lang, "task")} sortCol="taskName" title={t(lang, "sortBy", t(lang, "task"))} />
          {!hiddenCols.has("assignee") && <SortResizeTh {...th} label={t(lang, "assignee")} sortCol="assignee" title={t(lang, "sortBy", t(lang, "assignee"))} />}
          {!hiddenCols.has("startDate") && <SortResizeTh {...th} label={t(lang, "start")} sortCol="startDate" title={t(lang, "sortBy", t(lang, "start"))} />}
          {!hiddenCols.has("dueDate") && <SortResizeTh {...th} label={t(lang, "due")} sortCol="dueDate" title={t(lang, "sortBy", t(lang, "due"))} />}
          {!hiddenCols.has("lastUpdateDate") && <SortResizeTh {...th} label={t(lang, "lastUpdate")} sortCol="lastUpdateDate" title={t(lang, "sortBy", t(lang, "lastUpdate"))} />}
          {!hiddenCols.has("createdDate") && <SortResizeTh {...th} label={t(lang, "colCreatedDate")} sortCol="createdDate" title={t(lang, "sortBy", t(lang, "colCreatedDate"))} />}
          {!hiddenCols.has("priority") && <SortResizeTh {...th} label={t(lang, "priority")} sortCol="priority" title={t(lang, "sortBy", t(lang, "priority"))} />}
          {!hiddenCols.has("taskStatus") && <SortResizeTh {...th} label={t(lang, "colTaskStatus")} sortCol="taskStatus" title={t(lang, "sortBy", t(lang, "colTaskStatus"))} />}
          {!hiddenCols.has("blockers") && <Th onResize={(e) => startColResize("blockers", e)}>{t(lang, "blockers")}</Th>}
          {!hiddenCols.has("description") && <Th onResize={(e) => startColResize("description", e)}>{t(lang, "description")}</Th>}
          {!hiddenCols.has("notesLog") && <Th onResize={(e) => startColResize("notesLog", e)}>{t(lang, "noteLogTitle")}</Th>}
          {!hiddenCols.has("depRelations") && <Th onResize={(e) => startColResize("depRelations", e)}>{t(lang, "depRelations")}</Th>}
          {!hiddenCols.has("estimate") && <SortResizeTh {...th} label={t(lang, "colEstimate")} sortCol="estimate" title={t(lang, "sortBy", t(lang, "colEstimate"))} />}
          {!hiddenCols.has("spent") && <SortResizeTh {...th} label={t(lang, "colSpent")} sortCol="spent" title={t(lang, "sortBy", t(lang, "colSpent"))} />}
          <Th>
            <span className="sr-only">{t(lang, "colActions")}</span>
          </Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {visibleRows.length === 0 && (
          <tr>
            <td colSpan={visibleColumnCount + 1} className="p-10 text-center text-sm text-muted-foreground">
              {t(lang, "noTasksFiltered")}
            </td>
          </tr>
        )}
        {windowed && <SpacerRow height={rowWindow.padTop} colSpan={visibleColumnCount + 1} />}
        {rendered.map((task, k) => {
          // `i` is the index in the WHOLE list: the stripe and the aria row
          // index must not restart at the top of the window.
          const i = windowed ? rowWindow.start + k : k;
          return (
          <TaskRow
            key={task.id}
            task={task}
            // `tableTokens` is built in tasks-section.tsx from `visibleRows`
            // (the very array this `.map` iterates), so `task.id` is always a key —
            // the fallback cannot fire today. Kept anyway: the two are
            // independently typed props/locals, so nothing structurally
            // binds a future edit to keep them in sync.
            rowToken={tableTokens.get(task.id) ?? task.taskName}
            isSelected={selectedIds.has(task.id)}
            isEditing={editingId === task.id}
            isPushing={pushingIds.has(task.id)}
            raidRefs={raidByTask.get(task.id)}
            changeRefs={changeByTask.get(task.id)}
            documentsByEntity={documentsByEntity}
            onOpenDocuments={onOpenDocuments}
            onJumpToChanges={onJumpToChanges}
            isStriped={i % 2 === 1}
            isFlashed={flashId === task.id}
            ariaRowIndex={windowed ? i + 2 : undefined}
            virtualIndex={windowed ? i : undefined}
            measureRef={windowed ? rowWindow.measure : undefined}
          />
          );
        })}
        {windowed && <SpacerRow height={rowWindow.padBottom} colSpan={visibleColumnCount + 1} />}
        <tr aria-rowindex={windowed ? addRowIndex : undefined}>
          <td colSpan={visibleColumnCount + 1}>
            <button
              type="button"
              onClick={onAdd}
              // `addTaskButton`, NOT `addTask`. The two keys carry the
              // same STRING in EN and DE but not the same MEANING:
              // `addTask` is the task modal's SUBMIT verb, `addTaskButton`
              // is the label of every control that OPENS the editor. This
              // row is an opener (`onAdd` is the orchestrator's
              // `openTaskEditor`: it runs `handleCancelEdit()`, which
              // DISCARDS an in-progress edit, then opens the modal), so
              // it wears the opener key. It was mis-keyed to `addTask`,
              // which put the submit's name on a control that throws the
              // submit's work away.
              // ★ This row and the toolbar `AddButton` (tasks-section-toolbar.tsx) deliberately
              // KEEP one shared accessible name: identical purpose,
              // identical handler. WCAG 2.4.6 permits that, and this
              // repo's rule says a repeated name is a QUESTION, not an
              // automatic fix — the answer here is that they are the same
              // action rendered twice. Do not disambiguate them.
              aria-label={t(lang, "addTaskButton")}
              className={`group flex w-full cursor-pointer items-center gap-2 border-b border-dashed border-line px-3 py-1.5 text-sm text-muted-foreground hover:bg-ui-dark-blue/5 hover:text-ui-dark-blue dark:hover:text-ui-light-grey dark:hover:bg-white/5 ${INTERACTIVE}`}
            >
              <PlusIcon aria-hidden="true" className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100" />
              {t(lang, "addTaskButton")}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
