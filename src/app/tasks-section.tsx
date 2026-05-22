"use client";
import type React from "react";
import { useMemo } from "react";
import { type Lang, type TranslationKey, priorityLabel, t } from "./i18n";
import { PRIORITIES, type Priority, type RaidItem, type Task } from "./types";
import { useSettings } from "./use-settings";
import { useHolidaySet } from "./use-holiday-set";
import { type SortKey, useFilters } from "./filters-context";
import { useWorkspace } from "./workspace-context";
import { useTaskForm } from "./task-form-context";
import { BulkEditModal } from "./bulk-edit-modal";
import { RowContextProvider, TaskRow, type RowContextValue } from "./task-row";
import { DEFAULT_COL_WIDTHS } from "./use-column-manager";
import {
  EraserIcon,
  ResetColWidthsIcon,
  ResetSizeIcon,
  SortableTh,
  Th,
} from "./task-manager-ui";

const CONFIGURABLE_COLS: Array<{ key: string; labelKey: TranslationKey }> = [
  { key: "status",         labelKey: "colStatus" },
  { key: "id",             labelKey: "id" },
  { key: "assignee",       labelKey: "assignee" },
  { key: "startDate",      labelKey: "start" },
  { key: "dueDate",        labelKey: "due" },
  { key: "lastUpdateDate", labelKey: "lastUpdate" },
  { key: "priority",       labelKey: "priority" },
  { key: "blockers",       labelKey: "blockers" },
  { key: "notes",          labelKey: "notes" },
  { key: "depRelations",   labelKey: "depRelations" },
];

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

export interface TasksSectionProps {
  lang: Lang;
  today: string;
  // Row-context data not already in props
  jiraSiteUrl: string;
  // Row-context callbacks — assembled into rowContextValue useMemo internally
  onToggleSelect: (id: number) => void;
  onToggleNoteExpanded: (id: number) => void;
  onJumpToRaid: (id: number) => void;
  onToggleComplete: (task: Task) => void;
  onSendInquiry: (task: Task) => void;
  onPushToJira: (id: number) => void;
  onEdit: (task: Task) => void;
  onDelete: (id: number) => void;
  // column manager
  hiddenCols: Set<string>;
  setHiddenCols: React.Dispatch<React.SetStateAction<Set<string>>>;
  colWidths: Record<string, number>;
  colConfigOpen: boolean;
  setColConfigOpen: React.Dispatch<React.SetStateAction<boolean>>;
  colConfigRef: React.RefObject<HTMLDivElement | null>;
  startColResize: (col: string, e: React.MouseEvent) => void;
  resetColWidths: () => void;
  // resizable table
  tableRef: React.RefObject<HTMLElement | null>;
  resetTableSize: () => void;
  // row state
  expandedNotes: Set<number>;
  pushingIds: Set<number>;
  raidByTask: Map<number, RaidItem[]>;
  // jira
  jiraEnabled: boolean;
  jiraSyncing: boolean;
  jiraProjectKey: string;
  handleJiraSync: () => void;
  // task actions
  handleCancelEdit: () => void;
  setTaskModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleClearAll: () => void;
  // bulk operations
  selectedIds: Set<number>;
  allVisibleSelected: boolean;
  selectedJiraCount: number;
  toggleSelectAllVisible: () => void;
  clearSelection: () => void;
  handleBulkSendInquiry: () => void;
  applyBulkEdit: () => void;
  cancelBulkEdit: () => void;
}

export function TasksSection({
  lang,
  today,
  jiraSiteUrl,
  onToggleSelect,
  onToggleNoteExpanded,
  onJumpToRaid,
  onToggleComplete,
  onSendInquiry,
  onPushToJira,
  onEdit,
  onDelete,
  hiddenCols,
  setHiddenCols,
  colWidths,
  colConfigOpen,
  setColConfigOpen,
  colConfigRef,
  startColResize,
  resetColWidths,
  tableRef,
  resetTableSize,
  expandedNotes,
  pushingIds,
  raidByTask,
  jiraEnabled,
  jiraSyncing,
  jiraProjectKey,
  handleJiraSync,
  handleCancelEdit,
  setTaskModalOpen,
  handleClearAll,
  selectedIds,
  allVisibleSelected,
  selectedJiraCount,
  toggleSelectAllVisible,
  clearSelection,
  handleBulkSendInquiry,
  applyBulkEdit,
  cancelBulkEdit,
}: TasksSectionProps) {
  const {
    search, setSearch,
    priorityFilter, setPriorityFilter,
    assigneeFilter, setAssigneeFilter,
    groupFilter, setGroupFilter,
    labelFilter, setLabelFilter,
    sortKey, sortDir, setSortKey, setSortDir,
  } = useFilters();

  const { tasks, filteredSortedTasks, uniqueAssignees, uniqueGroups, uniqueLabels, tasksById } =
    useWorkspace();

  const { editingId, bulkEditOpen, setBulkEditOpen } = useTaskForm();

  const { settings } = useSettings();
  const { holidaySet } = useHolidaySet({ holidayCountries: settings.holidayCountries });

  const rowContextValue = useMemo<RowContextValue>(
    () => ({
      lang,
      today,
      holidaySet,
      jiraSiteUrl,
      jiraEnabled,
      jiraProjectKey,
      hiddenCols,
      tasksById,
      onToggleSelect,
      onToggleNoteExpanded,
      onJumpToRaid,
      onToggleComplete,
      onSendInquiry,
      onPushToJira,
      onEdit,
      onDelete,
    }),
    [
      lang,
      today,
      holidaySet,
      jiraSiteUrl,
      jiraEnabled,
      jiraProjectKey,
      hiddenCols,
      tasksById,
      onToggleSelect,
      onToggleNoteExpanded,
      onJumpToRaid,
      onToggleComplete,
      onSendInquiry,
      onPushToJira,
      onEdit,
      onDelete,
    ],
  );

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const ALL_TASK_COLS = ["sel","status","id","taskName","assignee","startDate","dueDate","lastUpdateDate","priority","blockers","notes","depRelations","actions"] as const;
  const visibleColumnCount = ALL_TASK_COLS.filter((col) => !hiddenCols.has(col)).length;

  return (
    <section
      ref={tableRef}
      title={t(lang, "tableResizeHint")}
      className="mb-10 flex h-[560px] min-h-[300px] min-w-[520px] resize flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
    >
      {/* shrink-0 wrapper keeps header, filters and bulk-edit from growing into the table area */}
      <div className="shrink-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div ref={colConfigRef} className="relative">
            <button
              type="button"
              onClick={() => setColConfigOpen((o) => !o)}
              aria-label={t(lang, "colConfigTitle")}
              title={t(lang, "colConfigTitle")}
              aria-expanded={colConfigOpen}
              className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
                <path fillRule="evenodd" d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.25 1.252a6.013 6.013 0 011.317.757l1.198-.42a1 1 0 011.15.376l1.18 2.044a1 1 0 01-.205 1.274l-.96.836a6.02 6.02 0 010 1.514l.96.836a1 1 0 01.205 1.274l-1.18 2.044a1 1 0 01-1.15.376l-1.198-.42a6.014 6.014 0 01-1.317.757l-.25 1.252a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.25-1.252a6.013 6.013 0 01-1.317-.757l-1.198.42a1 1 0 01-1.15-.376L2.745 13.3a1 1 0 01.205-1.274l.96-.836a6.023 6.023 0 010-1.514l-.96-.836a1 1 0 01-.205-1.274L3.925 5.52a1 1 0 011.15-.376l1.198.42a6.013 6.013 0 011.317-.757l.25-1.252zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
              </svg>
            </button>
            {colConfigOpen && (
              <div
                role="dialog"
                aria-label={t(lang, "colConfigTitle")}
                className="absolute left-0 top-full z-40 mt-1 w-52 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
              >
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                  {t(lang, "colConfigTitle")}
                </p>
                <ul className="space-y-1">
                  {CONFIGURABLE_COLS.map(({ key, labelKey }) => (
                    <li key={key}>
                      <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800">
                        <input
                          type="checkbox"
                          checked={!hiddenCols.has(key)}
                          onChange={() =>
                            setHiddenCols((prev) => {
                              const next = new Set(prev);
                              if (next.has(key)) { next.delete(key); } else { next.add(key); }
                              return next;
                            })
                          }
                          className="h-3.5 w-3.5 rounded border-zinc-300 text-AIPM-dark-blue focus:ring-AIPM-dark-blue dark:border-zinc-600 dark:bg-zinc-800"
                        />
                        {t(lang, labelKey)}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
            {t(lang, "tasks")}{" "}
            {filteredSortedTasks.length !== tasks.length
              ? t(lang, "tasksCountFiltered", filteredSortedTasks.length, tasks.length)
              : t(lang, "tasksCount", filteredSortedTasks.length)}
          </h2>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              handleCancelEdit();
              setTaskModalOpen(true);
            }}
            aria-label={t(lang, "addTaskButton")}
            title={t(lang, "addTaskButton")}
            className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-AIPM-dark-blue/90"
          >
            + {t(lang, "addTaskButton")}
          </button>
          {jiraEnabled && (
            <button
              type="button"
              onClick={handleJiraSync}
              disabled={jiraSyncing || !jiraProjectKey}
              title={
                jiraProjectKey
                  ? t(lang, "jiraSync")
                  : t(lang, "jiraSyncNoScope")
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-AIPM-dark-blue bg-white px-3 py-1.5 text-sm font-medium text-AIPM-dark-blue shadow-sm hover:bg-AIPM-light-grey disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
                className={`h-4 w-4 ${jiraSyncing ? "animate-spin" : ""}`}
              >
                <path
                  fillRule="evenodd"
                  d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z"
                  clipRule="evenodd"
                />
              </svg>
              {jiraSyncing ? t(lang, "jiraSyncing") : t(lang, "jiraSync")}
            </button>
          )}
          <button
            type="button"
            onClick={resetTableSize}
            aria-label={t(lang, "tableResetSizeHint")}
            title={t(lang, "tableResetSizeHint")}
            className="rounded-md border border-zinc-300 bg-white p-1.5 text-zinc-500 shadow-sm hover:bg-zinc-50 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <ResetSizeIcon />
          </button>
          <button
            type="button"
            onClick={resetColWidths}
            aria-label={t(lang, "colResetWidthsHint")}
            title={t(lang, "colResetWidthsHint")}
            className="rounded-md border border-zinc-300 bg-white p-1.5 text-zinc-500 shadow-sm hover:bg-zinc-50 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <ResetColWidthsIcon />
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            disabled={tasks.length === 0}
            aria-label={t(lang, "clearAll")}
            title={t(lang, "clearAll")}
            className="rounded-md border border-zinc-300 bg-white p-1.5 text-zinc-500 shadow-sm hover:bg-zinc-50 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <EraserIcon />
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t(lang, "searchPlaceholder")}
          className={inputClass}
        />
        <select
          value={priorityFilter}
          onChange={(e) =>
            setPriorityFilter(e.target.value as Priority | "All")
          }
          className={inputClass}
        >
          <option value="All">{t(lang, "allPriorities")}</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {priorityLabel(lang, p)}
            </option>
          ))}
        </select>
        <select
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className={inputClass}
        >
          <option value="All">{t(lang, "allAssignees")}</option>
          {uniqueAssignees.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          className={inputClass}
        >
          <option value="All">{t(lang, "allGroups")}</option>
          <option value="">{t(lang, "groupNone")}</option>
          {uniqueGroups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <select
          value={labelFilter}
          onChange={(e) => setLabelFilter(e.target.value)}
          className={inputClass}
        >
          <option value="All">{t(lang, "allLabels")}</option>
          {uniqueLabels.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      {selectedIds.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-AIPM-medium-grey/40 bg-AIPM-light-grey p-3 dark:border-zinc-700 dark:bg-zinc-900">
          <span className="text-sm font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">
            {t(lang, "selectionCount", selectedIds.size)}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleBulkSendInquiry}
              className="rounded-md bg-AIPM-green px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:opacity-90"
            >
              {t(lang, "bulkSendInquiries")}
            </button>
            <button
              type="button"
              onClick={() => setBulkEditOpen((o) => !o)}
              aria-pressed={bulkEditOpen}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {t(lang, "bulkEdit")}
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {t(lang, "clearSelection")}
            </button>
          </div>
        </div>
      )}

      <BulkEditModal
        lang={lang}
        today={today}
        selectedIds={selectedIds}
        selectedJiraCount={selectedJiraCount}
        uniqueGroups={uniqueGroups}
        uniqueLabels={uniqueLabels}
        onApply={applyBulkEdit}
        onCancel={cancelBulkEdit}
      />

      </div>{/* end shrink-0 */}

      <div
        className="min-h-0 flex-1 w-full overflow-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
      >
        <RowContextProvider value={rowContextValue}>
          <table
            className="divide-y divide-zinc-200 text-left text-sm dark:divide-zinc-800"
            style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}
          >
            <colgroup>
              {(["sel","status","id","taskName","assignee","startDate","dueDate","lastUpdateDate","priority","blockers","notes","depRelations","actions"] as const)
                .filter((col) => !hiddenCols.has(col))
                .map((col) => (
                  <col key={col} style={{ width: colWidths[col] ?? DEFAULT_COL_WIDTHS[col] }} />
                ))}
            </colgroup>
            <thead className="sticky top-0 z-10 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 shadow-sm dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <Th onResize={(e) => startColResize("sel", e)}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAllVisible}
                    aria-label={t(lang, "selectAllVisible")}
                    className="h-4 w-4 cursor-pointer rounded border-zinc-300 text-AIPM-dark-blue focus:ring-AIPM-dark-blue dark:border-zinc-600 dark:bg-zinc-800"
                  />
                </Th>
                {!hiddenCols.has("status") && <Th onResize={(e) => startColResize("status", e)}><span className="sr-only">Status</span></Th>}
                {!hiddenCols.has("id") && <SortableTh label={t(lang, "id")} sortKey="id" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("id", e)} />}
                <SortableTh label={t(lang, "task")} sortKey="taskName" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("taskName", e)} />
                {!hiddenCols.has("assignee") && <SortableTh label={t(lang, "assignee")} sortKey="assignee" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("assignee", e)} />}
                {!hiddenCols.has("startDate") && <SortableTh label={t(lang, "start")} sortKey="startDate" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("startDate", e)} />}
                {!hiddenCols.has("dueDate") && <SortableTh label={t(lang, "due")} sortKey="dueDate" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("dueDate", e)} />}
                {!hiddenCols.has("lastUpdateDate") && <SortableTh label={t(lang, "lastUpdate")} sortKey="lastUpdateDate" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("lastUpdateDate", e)} />}
                {!hiddenCols.has("priority") && <SortableTh label={t(lang, "priority")} sortKey="priority" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("priority", e)} />}
                {!hiddenCols.has("blockers") && <Th onResize={(e) => startColResize("blockers", e)}>{t(lang, "blockers")}</Th>}
                {!hiddenCols.has("notes") && <Th onResize={(e) => startColResize("notes", e)}>{t(lang, "notes")}</Th>}
                {!hiddenCols.has("depRelations") && <Th onResize={(e) => startColResize("depRelations", e)}>{t(lang, "depRelations")}</Th>}
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={visibleColumnCount} className="p-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
                    {t(lang, "noTasks")}
                  </td>
                </tr>
              )}
              {tasks.length > 0 && filteredSortedTasks.length === 0 && (
                <tr>
                  <td colSpan={visibleColumnCount} className="p-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
                    {t(lang, "noTasksFiltered")}
                  </td>
                </tr>
              )}
              {filteredSortedTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  isSelected={selectedIds.has(task.id)}
                  isEditing={editingId === task.id}
                  isExpanded={expandedNotes.has(task.id)}
                  isPushing={pushingIds.has(task.id)}
                  raidRefs={raidByTask.get(task.id)}
                />
              ))}
              <tr>
                <td colSpan={visibleColumnCount}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => { handleCancelEdit(); setTaskModalOpen(true); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleCancelEdit();
                        setTaskModalOpen(true);
                      }
                    }}
                    aria-label={t(lang, "addTask")}
                    className="group flex cursor-pointer items-center gap-2 border-b border-dashed border-zinc-200 px-3 py-1.5 text-sm text-zinc-400 hover:bg-AIPM-dark-blue/5 hover:text-AIPM-dark-blue dark:border-zinc-700 dark:hover:bg-white/5"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100">
                      <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                    </svg>
                    {t(lang, "addTask")}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </RowContextProvider>
      </div>
    </section>
  );
}
