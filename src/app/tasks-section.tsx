"use client";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type Lang, type TranslationKey, priorityLabel, t } from "./i18n";
import { PRIORITIES, type ChangeItem, type Priority, type RaidItem, type Resource, type Task, type TaskStatus } from "./types";
import { type JiraExtraProject } from "./settings-types";
import { TaskKanban } from "./task-kanban-board";
import { useSettings } from "./use-settings";
import { useHolidaySet } from "./use-holiday-set";
import { type SortKey, useFilters } from "./filters-context";
import { useWorkspace } from "./workspace-context";
import { useTaskForm } from "./task-form-context";
import { useTasksInlineAiEdit } from "./use-tasks-inline-ai-edit";
import type { ToolDispatcher } from "./chat-tools";
import type { ActivityKind } from "./activity-log";
import { BulkEditModal } from "./bulk-edit-modal";
import { TypeToConfirmDialog } from "./type-to-confirm-dialog";
import { RowContextProvider, TaskRow, type RowContextValue } from "./task-row";
import { useDeepLinkRowFlash } from "./use-deeplink-row-flash";
import { isTaskFinished } from "./task-status";
import { sanitizeInlinePatch } from "./task-inline-patch";
import { useEntityCalendarPush } from "./use-entity-calendar-push";
import { useEntityCalendarPull } from "./use-entity-calendar-pull";
import { CalendarPullSummaryModal } from "./calendar-pull-summary-modal";
import { taskToGraphEvent } from "./outlook-calendar-write";
import { calendarSyncFor } from "./calendar-sync-config";
import { DEFAULT_COL_WIDTHS } from "./use-column-manager";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { ActionChips, chipsForView } from "./action-chips";
import { ViewCallout } from "./view-callout";
import { SavedViewsControl } from "./saved-views-control";
import { FOCUS_RING, INTERACTIVE, TRANSITION } from "./interaction-styles";
import type { SuggestedAction } from "./next-actions/types";
import {
  EraserIcon,
  PrintButton,
  ResetColWidthsButton,
  ResetSizeIcon,
  SortableTh,
  Th,
} from "./task-manager-ui";

/** Stable empty directory so a resource-less workspace keeps the row-context memo
 *  reference-stable (a fresh `[]` each render would bust it). */
const EMPTY_RESOURCES: readonly Resource[] = [];

const ALL_TASK_COLS = ["sel","status","id","taskName","assignee","startDate","dueDate","lastUpdateDate","priority","taskStatus","blockers","notes","depRelations","estimate","spent","actions"] as const;

/** Fixed English friction phrase to confirm clearing all tasks (mirrors the
 *  factory-reset dialog). Deliberately not localized. */
const CLEAR_TASKS_CONFIRM_PHRASE = "yes, clear all tasks";

const CONFIGURABLE_COLS: Array<{ key: string; labelKey: TranslationKey }> = [
  { key: "status",         labelKey: "health" },
  { key: "id",             labelKey: "id" },
  { key: "assignee",       labelKey: "assignee" },
  { key: "startDate",      labelKey: "start" },
  { key: "dueDate",        labelKey: "due" },
  { key: "lastUpdateDate", labelKey: "lastUpdate" },
  { key: "priority",       labelKey: "priority" },
  { key: "taskStatus",     labelKey: "colTaskStatus" },
  { key: "blockers",       labelKey: "blockers" },
  { key: "notes",          labelKey: "notes" },
  { key: "depRelations",   labelKey: "depRelations" },
  { key: "estimate",       labelKey: "taskOriginalEstimate" },
  { key: "spent",          labelKey: "taskTimeSpent" },
];

const inputClass =
  `rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground focus:border-line focus:outline-none ${FOCUS_RING} ${TRANSITION}`;

const searchClass =
  `min-w-[12rem] flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-foreground focus:border-line focus:outline-none ${FOCUS_RING} ${TRANSITION}`;

export interface TasksSectionProps {
  lang: Lang;
  today: string;
  /** When set, the pane fills its parent (modern full-height layout) instead of
   *  rendering as a fixed-height, user-resizable box (classic layout). */
  fillHeight?: boolean;
  // Row-context data not already in props
  jiraSiteUrl: string;
  jiraExtraProjects: readonly JiraExtraProject[];
  // Row-context callbacks — assembled into rowContextValue useMemo internally
  onToggleSelect: (id: number) => void;
  onToggleNoteExpanded: (id: number) => void;
  onJumpToRaid: (id: number) => void;
  onSendInquiry: (task: Task) => void;
  onPushToJira: (id: number) => void;
  onStatusChange: (id: number, next: TaskStatus) => void;
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
  changeByTask: Map<number, ChangeItem[]>;
  // jira
  jiraEnabled: boolean;
  jiraSyncing: boolean;
  jiraProjectKey: string;
  handleJiraSync: () => void;
  // task actions
  handleCancelEdit: () => void;
  setTaskModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleClearAll: () => void;
  /** Non-null nonce = a pending voice `clearAll` request → open the same
   *  type-to-confirm clear-all dialog the toolbar button opens. Consumed via
   *  onClearAllRequestConsumed so a remount can't re-fire a stale request. */
  clearAllRequestNonce?: number | null;
  onClearAllRequestConsumed?: () => void;
  // bulk operations
  selectedIds: Set<number>;
  allVisibleSelected: boolean;
  selectedJiraCount: number;
  toggleSelectAllVisible: () => void;
  clearSelection: () => void;
  handleBulkSendInquiry: () => void;
  applyBulkEdit: () => void;
  cancelBulkEdit: () => void;
  // Inline action chips (SP4): task-due actions surfaced atop the Open Points pane.
  nextActions?: readonly SuggestedAction[];
  onOpenAction?: (a: SuggestedAction) => void;
  onShowActions?: () => void;
  // Per-view Help callout (SP2). Rendered only when onLearnMoreHint is wired
  // (omitted in the standalone unit test, which has no tab context).
  showViewHints?: boolean;
  isPopout?: boolean;
  onLearnMoreHint?: (conceptId: string) => void;
  // Outlook calendar write-back (SP1): threaded from task-manager. `projectId`
  // is the stable Outlook event-category id; `m365Configured` gates the toggle +
  // Push button (hidden when M365 is not configured).
  projectId?: string;
  m365Configured?: boolean;
  // Inline "Ask Claude" task edit (SP1): the ToolDispatcher backing the single
  // useInlineAiEdit instance owned here, plus optional activity logging —
  // both threaded from task-manager.
  dispatcher: ToolDispatcher;
  logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void;
}

export function TasksSection({
  lang,
  today,
  fillHeight,
  jiraSiteUrl,
  jiraExtraProjects,
  onToggleSelect,
  onToggleNoteExpanded,
  onJumpToRaid,
  onSendInquiry,
  onPushToJira,
  onStatusChange,
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
  changeByTask,
  jiraEnabled,
  jiraSyncing,
  jiraProjectKey,
  handleJiraSync,
  handleCancelEdit,
  setTaskModalOpen,
  handleClearAll,
  clearAllRequestNonce,
  onClearAllRequestConsumed,
  selectedIds,
  allVisibleSelected,
  selectedJiraCount,
  toggleSelectAllVisible,
  clearSelection,
  handleBulkSendInquiry,
  applyBulkEdit,
  cancelBulkEdit,
  nextActions = [],
  onOpenAction,
  onShowActions,
  showViewHints,
  isPopout,
  onLearnMoreHint,
  projectId,
  m365Configured,
  dispatcher,
  logActivity,
}: TasksSectionProps) {
  const {
    search, setSearch,
    priorityFilter, setPriorityFilter,
    assigneeFilter, setAssigneeFilter,
    groupFilter, setGroupFilter,
    labelFilter, setLabelFilter,
    sortKey, sortDir, setSortKey, setSortDir,
  } = useFilters();

  const workspaceCtx = useWorkspace();
  const { tasks, filteredSortedTasks, uniqueAssignees, uniqueGroups, uniqueLabels, tasksById, setTasks, resources } =
    workspaceCtx;
  // id -> Resource lookup for resolving the LIVE assignee name of linked tasks
  // (the stored `assignee` string is a cache that goes stale after a rename).
  // Built once here and threaded to both the table rows (row context) and the
  // Kanban board (which renders outside RowContextProvider).
  const resourcesById = useMemo(
    () => new Map((resources ?? []).map((r) => [r.id, r])),
    [resources],
  );

  const { editingId, bulkEditOpen, setBulkEditOpen } = useTaskForm();

  const { settings, setSettings } = useSettings();
  const { holidaySet } = useHolidaySet({ holidayCountries: settings.holidayCountries });
  const { flashId, containerRef } = useDeepLinkRowFlash("open-points");

  // Inline "Ask Claude" task edit (SP1) — wired via a dedicated glue hook so this
  // pane stays lean; it owns the single active-edit popover element.
  const { onAiEdit, aiEditEnabled, popover: inlineAiEditPopover } = useTasksInlineAiEdit({
    dispatcher,
    settings,
    isPopout: isPopout ?? false,
    lang,
    logActivity,
    workspaceCtx,
  });

  const hideFinished = settings.hideFinishedTasks ?? false;
  const tasksViewMode = settings.tasksViewMode ?? "table";

  // Outlook calendar write-back (SP1): manual push of unfinished, dated tasks.
  // The hook is called unconditionally (rules of hooks); `enabled` gates the
  // MSAL session so it stays inert when M365 is not configured.
  const calendarTaskEnabled = calendarSyncFor(settings, "task").enabled;
  const pushableTasks = useMemo(
    () => tasks.filter((x) => !isTaskFinished(x) && !!x.dueDate),
    [tasks],
  );
  // Bridge the workspace `Dispatch<SetStateAction<readonly Task[]>>` setter to the
  // hook's `(updater: (prev: Task[]) => Task[]) => void` shape (mirrors milestones).
  const setTasksForPush = useCallback(
    (updater: (prev: Task[]) => Task[]) => setTasks((prev) => updater([...prev])),
    [setTasks],
  );
  const { pushToOutlook: pushTasksToOutlook, busy: calPushBusy } = useEntityCalendarPush<Task>({
    items: pushableTasks,
    entityType: "task",
    projectId: projectId ?? "default",
    toGraphEvent: taskToGraphEvent,
    setItems: setTasksForPush,
    isPopout: !!isPopout,
    lang,
    enabled: !!m365Configured && !isPopout,
  });
  // Outlook calendar two-way sync (SP2): manual pull of due dates from Outlook.
  // Jira-synced tasks are excluded (Jira owns their dates).
  const taskPull = useEntityCalendarPull<Task>({
    items: pushableTasks,
    entityType: "task",
    projectId: projectId ?? "default",
    getDate: (x) => x.dueDate,
    withDate: (x, date) => ({ ...x, dueDate: date }),
    toGraphEvent: taskToGraphEvent,
    setItems: setTasksForPush,
    isPullable: (x) => !x.jiraKey,
    isPopout: !!isPopout,
    lang,
    enabled: !!m365Configured && !isPopout,
  });
  const visibleRows = hideFinished
    ? filteredSortedTasks.filter((r) => !isTaskFinished(r))
    : filteredSortedTasks;

  // Inline Open-Points cell edit: apply one sanitized field patch to a task via
  // a functional setter, stamping localModifiedAt. Mirrors the form-save
  // sanitizers (use-task-submit); Jira-synced rows are read-only and skipped.
  const onInlinePatch = useCallback(
    (taskId: number, patch: Partial<Task>) => {
      setTasks((prev) => {
        const knownTaskIds = new Set(prev.map((tk) => tk.id));
        return prev.map((row) => {
          if (row.id !== taskId || row.jiraKey) return row;
          const clean = sanitizeInlinePatch(patch, {
            hasResource: (id) => resourcesById.has(id),
            knownTaskIds,
            ownTaskId: taskId,
          });
          return { ...row, ...clean, localModifiedAt: new Date().toISOString() };
        });
      });
    },
    [setTasks, resourcesById],
  );

  const rowContextValue = useMemo<RowContextValue>(
    () => ({
      lang,
      today,
      holidaySet,
      jiraSiteUrl,
      jiraExtraProjects,
      jiraEnabled,
      jiraProjectKey,
      hiddenCols,
      onToggleSelect,
      onToggleNoteExpanded,
      onJumpToRaid,
      onSendInquiry,
      onPushToJira,
      onStatusChange,
      onEdit,
      onDelete,
      onAiEdit,
      aiEditEnabled,
      onInlinePatch,
      resourcesById,
      resources: resources ?? EMPTY_RESOURCES,
    }),
    [
      lang,
      today,
      holidaySet,
      jiraSiteUrl,
      jiraExtraProjects,
      jiraEnabled,
      jiraProjectKey,
      hiddenCols,
      onToggleSelect,
      onToggleNoteExpanded,
      onJumpToRaid,
      onSendInquiry,
      onPushToJira,
      onStatusChange,
      onEdit,
      onDelete,
      onAiEdit,
      aiEditEnabled,
      onInlinePatch,
      resourcesById,
      resources,
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

  const visibleColumnCount = ALL_TASK_COLS.filter((col) => !hiddenCols.has(col)).length;

  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  // Voice `clearAll` (from any view — task-manager navigates here first) sets a
  // non-null clearAllRequestNonce → open the type-to-confirm dialog (same
  // friction as the toolbar button). Render-time reconcile (react-hooks bans
  // set-state-in-effect for the dialog state); handled seed is a SENTINEL (null)
  // so a FRESH mount with a pending request DOES fire it — the parent then
  // clears the nonce (below) so a later remount can't re-fire a stale request.
  const [handledClearNonce, setHandledClearNonce] = useState<number | null>(null);
  if (clearAllRequestNonce != null && clearAllRequestNonce !== handledClearNonce) {
    setHandledClearNonce(clearAllRequestNonce);
    if (tasks.length > 0) setClearConfirmOpen(true);
  }
  // Consume the request once handled (parent resets the nonce to null). Not the
  // component's own state, so this effect is exempt from the set-state ban.
  useEffect(() => {
    if (handledClearNonce != null && handledClearNonce === clearAllRequestNonce) {
      onClearAllRequestConsumed?.();
    }
  }, [handledClearNonce, clearAllRequestNonce, onClearAllRequestConsumed]);

  return (
    <section
      ref={tableRef}
      className={
        fillHeight
          ? `print-root print-landscape ${VIEW_PANE_RESIZABLE_CLASS}`
          : "print-root print-landscape relative mb-10 flex h-[560px] min-h-[300px] min-w-[520px] resize flex-col overflow-hidden rounded-xl border border-line bg-surface p-6"
      }
    >
      {/* shrink-0 wrapper keeps header, filters and bulk-edit from growing into the table area */}
      <div className="shrink-0 print:hidden">
      {onOpenAction && onShowActions && (
        <ActionChips
          lang={lang}
          actions={chipsForView(nextActions, "open-points")}
          onOpen={onOpenAction}
          onShowMore={onShowActions}
          className="mb-2"
        />
      )}
      {onLearnMoreHint && (
        <ViewCallout
          view="open-points"
          lang={lang}
          showHints={showViewHints !== false}
          isPopout={!!isPopout}
          onLearnMore={onLearnMoreHint}
        />
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            handleCancelEdit();
            setTaskModalOpen(true);
          }}
          aria-label={t(lang, "addTaskButton")}
          title={t(lang, "addTaskButton")}
          className={`rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90 ${INTERACTIVE}`}
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
            className={`inline-flex items-center gap-1.5 rounded-md border border-AIPM-dark-blue bg-surface px-2.5 py-1.5 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
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
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={hideFinished}
            onChange={(e) => setSettings((s) => ({ ...s, hideFinishedTasks: e.target.checked }))}
            className="h-3.5 w-3.5 rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green"
          />
          {t(lang, "hideFinishedTasks")}
        </label>
        <div
          className="inline-flex overflow-hidden rounded-md border border-line"
          role="group"
          aria-label={t(lang, "tasksViewModeLabel")}
        >
          <button
            type="button"
            aria-pressed={tasksViewMode === "table"}
            onClick={() => setSettings((s) => ({ ...s, tasksViewMode: "table" }))}
            className={`px-2 py-1 text-xs ${tasksViewMode === "table" ? "bg-AIPM-dark-blue text-white" : "text-muted-foreground hover:bg-surface-muted"} ${INTERACTIVE}`}
          >
            {t(lang, "tasksViewTable")}
          </button>
          <button
            type="button"
            aria-pressed={tasksViewMode === "board"}
            onClick={() => setSettings((s) => ({ ...s, tasksViewMode: "board" }))}
            className={`px-2 py-1 text-xs ${tasksViewMode === "board" ? "bg-AIPM-dark-blue text-white" : "text-muted-foreground hover:bg-surface-muted"} ${INTERACTIVE}`}
          >
            {t(lang, "tasksViewBoard")}
          </button>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t(lang, "searchPlaceholder")}
          aria-label={t(lang, "searchPlaceholder")}
          title={t(lang, "tasksSearchHint")}
          className={searchClass}
        />
        <select
          value={priorityFilter}
          onChange={(e) =>
            setPriorityFilter(e.target.value as Priority | "All")
          }
          title={t(lang, "priorityFilterHint")}
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
          title={t(lang, "assigneeFilterHint")}
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
          title={t(lang, "tasksGroupFilterHint")}
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
          title={t(lang, "tasksLabelFilterHint")}
          className={inputClass}
        >
          <option value="All">{t(lang, "allLabels")}</option>
          {uniqueLabels.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <div ref={colConfigRef} className="relative">
          <button
            type="button"
            onClick={() => setColConfigOpen((o) => !o)}
            aria-label={t(lang, "colConfigTitle")}
            title={t(lang, "colConfigTitle")}
            aria-expanded={colConfigOpen}
            className={`rounded-md p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-muted-foreground ${INTERACTIVE}`}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
              <path fillRule="evenodd" d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.25 1.252a6.013 6.013 0 011.317.757l1.198-.42a1 1 0 011.15.376l1.18 2.044a1 1 0 01-.205 1.274l-.96.836a6.02 6.02 0 010 1.514l.96.836a1 1 0 01.205 1.274l-1.18 2.044a1 1 0 01-1.15.376l-1.198-.42a6.014 6.014 0 01-1.317.757l-.25 1.252a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.25-1.252a6.013 6.013 0 01-1.317-.757l-1.198.42a1 1 0 01-1.15-.376L2.745 13.3a1 1 0 01.205-1.274l.96-.836a6.023 6.023 0 010-1.514l-.96-.836a1 1 0 01-.205-1.274L3.925 5.52a1 1 0 011.15-.376l1.198.42a6.013 6.013 0 011.317-.757l.25-1.252zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
          </button>
          {colConfigOpen && (
            <div
              role="dialog"
              aria-label={t(lang, "colConfigTitle")}
              className="absolute left-0 top-full z-40 mt-1 w-52 rounded-lg border border-line bg-surface p-3"
            >
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t(lang, "colConfigTitle")}
              </p>
              <ul className="space-y-1">
                {CONFIGURABLE_COLS.map(({ key, labelKey }) => (
                  <li key={key}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm text-foreground hover:bg-surface-muted">
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
                        className="h-3.5 w-3.5 rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green"
                      />
                      {t(lang, labelKey)}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <SavedViewsControl lang={lang} hiddenCols={hiddenCols} setHiddenCols={setHiddenCols} />
        {m365Configured && !isPopout && (
          <>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={calendarTaskEnabled}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    outlookCalendar: {
                      ...s.outlookCalendar,
                      // Disabling here also forces auto off (mirrors the Settings toggle)
                      // so re-enabling from this checkbox can't silently reactivate auto-sync.
                      task: {
                        enabled: e.target.checked,
                        auto: e.target.checked ? (s.outlookCalendar?.task?.auto ?? false) : false,
                      },
                    },
                  }))
                }
                aria-label={t(lang, "calendarSyncEnable")}
                className="h-3.5 w-3.5 rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green"
              />
              {t(lang, "calendarSyncEnable")}
            </label>
            {calendarTaskEnabled && (
              <button
                type="button"
                onClick={() => void pushTasksToOutlook()}
                disabled={calPushBusy}
                aria-label={t(lang, "calendarPush")}
                title={t(lang, "calendarPush")}
                className={`rounded-md border border-AIPM-dark-blue bg-surface px-2.5 py-1.5 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
              >
                {calPushBusy ? t(lang, "calendarPushing") : t(lang, "calendarPush")}
              </button>
            )}
            {calendarTaskEnabled && (
              <button
                type="button"
                onClick={() => void taskPull.pull()}
                disabled={taskPull.busy}
                aria-label={t(lang, "calendarPull")}
                title={t(lang, "calendarPull")}
                className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
              >
                {taskPull.busy ? t(lang, "calendarPulling") : t(lang, "calendarPull")}
              </button>
            )}
          </>
        )}
        <PrintButton lang={lang} iconOnly />
        <button
          type="button"
          onClick={resetTableSize}
          aria-label={t(lang, "tableResetSizeHint")}
          title={t(lang, "tableResetSizeHint")}
          className={`rounded-md border border-line bg-surface p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground ${INTERACTIVE}`}
        >
          <ResetSizeIcon />
        </button>
        <ResetColWidthsButton onClick={resetColWidths} lang={lang} />
        <button
          type="button"
          onClick={() => setClearConfirmOpen(true)}
          disabled={tasks.length === 0}
          aria-label={t(lang, "clearAll")}
          title={t(lang, "clearAll")}
          className={`rounded-md border border-line bg-surface p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
        >
          <EraserIcon />
        </button>
      </div>

      {clearConfirmOpen && (
        <TypeToConfirmDialog
          lang={lang}
          title={t(lang, "tasksClearDialogTitle")}
          message={t(lang, "tasksClearDialogMessage", tasks.length)}
          confirmValue={CLEAR_TASKS_CONFIRM_PHRASE}
          confirmLabel={t(lang, "tasksClearConfirmLabel")}
          onConfirm={() => {
            handleClearAll();
            setClearConfirmOpen(false);
          }}
          onCancel={() => setClearConfirmOpen(false)}
        />
      )}

      {selectedIds.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-muted p-3">
          <span className="text-sm font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">
            {t(lang, "selectionCount", selectedIds.size)}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleBulkSendInquiry}
              className={`rounded-md bg-AIPM-green px-3 py-1.5 text-sm font-medium text-AIPM-dark-blue hover:opacity-90 ${INTERACTIVE}`}
            >
              {t(lang, "bulkSendInquiries")}
            </button>
            <button
              type="button"
              onClick={() => setBulkEditOpen((o) => !o)}
              aria-pressed={bulkEditOpen}
              className={`rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
            >
              {t(lang, "bulkEdit")}
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className={`rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
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

      {tasksViewMode === "board" ? (
        /* Board view shows every search/people-filtered task (NOT the
           hide-finished filtered `visibleRows`) so cancelled/done columns
           stay populated. SP-B Task 6 swaps in the rich <TaskKanbanCard>. */
        <TaskKanban
          lang={lang}
          tasks={filteredSortedTasks}
          today={today}
          holidaySet={holidaySet}
          resourcesById={resourcesById}
          raidByTask={raidByTask}
          changeByTask={changeByTask}
          onStatusChange={onStatusChange}
          onEdit={onEdit}
          onJumpToRaid={onJumpToRaid}
          jiraProjectKey={jiraProjectKey}
          jiraExtraProjects={jiraExtraProjects}
          containerRef={containerRef}
          flashId={flashId}
          onAiEdit={onAiEdit}
          aiEditEnabled={aiEditEnabled}
        />
      ) : (
      <div
        ref={containerRef}
        className={tasks.length === 0 ? undefined : "min-h-0 flex-1 w-full overflow-auto rounded-xl border border-line bg-surface pr-2"}
      >
        {tasks.length === 0 ? (
          // Empty → clickable dashed box (budget/gantt empty-state convention):
          // descriptive text + "+ Add task…", the box opens the task editor.
          <button
            type="button"
            onClick={() => {
              handleCancelEdit();
              setTaskModalOpen(true);
            }}
            className={`flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-line p-10 text-center text-sm text-muted-foreground hover:border-AIPM-dark-blue hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey ${INTERACTIVE}`}
          >
            <span>{t(lang, "noTasks")}</span>
            <span className="font-medium">+ {t(lang, "addTaskButton")}…</span>
          </button>
        ) : (
        <RowContextProvider value={rowContextValue} tasksById={tasksById}>
          <table
            className="divide-y divide-line text-left text-sm"
            style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}
          >
            <colgroup>
              {/* Leading gutter column matching the per-row hover Ask-Claude cell
                  and the leading <th> below — under table-layout:fixed a missing
                  <col> shifts every column's width to its left neighbour. */}
              <col className="w-8" />
              {ALL_TASK_COLS
                .filter((col) => !hiddenCols.has(col))
                .map((col) => (
                  <col key={col} style={{ width: colWidths[col] ?? DEFAULT_COL_WIDTHS[col] }} />
                ))}
            </colgroup>
            <thead className={TABLE_HEAD_CLASS}>
              <tr>
                {/* Leading gutter matching the per-row hover Ask-Claude cell. */}
                <th className="w-8" aria-hidden="true" />
                <Th onResize={(e) => startColResize("sel", e)}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAllVisible}
                    aria-label={t(lang, "selectAllVisible")}
                    className="h-4 w-4 cursor-pointer rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green"
                  />
                </Th>
                {!hiddenCols.has("status") && <Th onResize={(e) => startColResize("status", e)}><span className="sr-only">{t(lang, "health")}</span></Th>}
                {!hiddenCols.has("id") && <SortableTh label={t(lang, "id")} sortKey="id" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("id", e)} lang={lang} />}
                <SortableTh label={t(lang, "task")} sortKey="taskName" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("taskName", e)} lang={lang} />
                {!hiddenCols.has("assignee") && <SortableTh label={t(lang, "assignee")} sortKey="assignee" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("assignee", e)} lang={lang} />}
                {!hiddenCols.has("startDate") && <SortableTh label={t(lang, "start")} sortKey="startDate" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("startDate", e)} lang={lang} />}
                {!hiddenCols.has("dueDate") && <SortableTh label={t(lang, "due")} sortKey="dueDate" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("dueDate", e)} lang={lang} />}
                {!hiddenCols.has("lastUpdateDate") && <SortableTh label={t(lang, "lastUpdate")} sortKey="lastUpdateDate" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("lastUpdateDate", e)} lang={lang} />}
                {!hiddenCols.has("priority") && <SortableTh label={t(lang, "priority")} sortKey="priority" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("priority", e)} lang={lang} />}
                {!hiddenCols.has("taskStatus") && <SortableTh label={t(lang, "colTaskStatus")} sortKey="taskStatus" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("taskStatus", e)} lang={lang} />}
                {!hiddenCols.has("blockers") && <Th onResize={(e) => startColResize("blockers", e)}>{t(lang, "blockers")}</Th>}
                {!hiddenCols.has("notes") && <Th onResize={(e) => startColResize("notes", e)}>{t(lang, "notes")}</Th>}
                {!hiddenCols.has("depRelations") && <Th onResize={(e) => startColResize("depRelations", e)}>{t(lang, "depRelations")}</Th>}
                {!hiddenCols.has("estimate") && <SortableTh label={t(lang, "colEstimate")} sortKey="estimate" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("estimate", e)} lang={lang} />}
                {!hiddenCols.has("spent") && <SortableTh label={t(lang, "colSpent")} sortKey="spent" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("spent", e)} lang={lang} />}
                <Th>
                  <span className="sr-only">Actions</span>
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
              {visibleRows.map((task, i) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  isSelected={selectedIds.has(task.id)}
                  isEditing={editingId === task.id}
                  isExpanded={expandedNotes.has(task.id)}
                  isPushing={pushingIds.has(task.id)}
                  raidRefs={raidByTask.get(task.id)}
                  changeRefs={changeByTask.get(task.id)}
                  isStriped={i % 2 === 1}
                  isFlashed={flashId === task.id}
                />
              ))}
              <tr>
                <td colSpan={visibleColumnCount + 1}>
                  <button
                    type="button"
                    onClick={() => { handleCancelEdit(); setTaskModalOpen(true); }}
                    aria-label={t(lang, "addTask")}
                    className={`group flex w-full cursor-pointer items-center gap-2 border-b border-dashed border-line px-3 py-1.5 text-sm text-muted-foreground hover:bg-AIPM-dark-blue/5 hover:text-AIPM-dark-blue dark:hover:bg-white/5 ${INTERACTIVE}`}
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100">
                      <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                    </svg>
                    {t(lang, "addTask")}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </RowContextProvider>
        )}
      </div>
      )}

      {taskPull.result && (() => {
        const plan = taskPull.result.plan;
        const nameOf = (id: number) => pushableTasks.find((x) => x.id === id)?.taskName ?? String(id);
        return (
          <CalendarPullSummaryModal
            lang={lang}
            open
            onClose={taskPull.clearResult}
            applied={plan.applies.map((a) => ({ id: a.id, name: nameOf(a.id), newDate: a.newDate }))}
            conflicts={plan.conflicts.map((c) => ({ id: c.id, eventId: c.eventId, name: nameOf(c.id), appDate: c.appDate, outlookDate: c.outlookDate }))}
            deletions={plan.deletions.map((d) => ({ id: d.id, name: nameOf(d.id) }))}
            onKeepApp={taskPull.keepApp}
            onTakeOutlook={(c) => taskPull.applyMove(c.id, c.eventId, c.outlookDate)}
          />
        );
      })()}

      {inlineAiEditPopover}
    </section>
  );
}
