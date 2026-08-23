"use client";
import type React from "react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ArrowPathIcon, CheckCircleIcon, EyeSlashIcon, PlusIcon } from "./icons";
import { type Lang, type TranslationKey, priorityLabel, t } from "./i18n";
import { PRIORITIES, type ChangeItem, type Priority, type RaidItem, type Resource, type Task, type TaskStatus } from "./types";
import type { ProjectDocument } from "./document-model";
import { type JiraExtraProject } from "./settings-types";
import { TaskKanban } from "./task-kanban-board";
import { TaskKanbanSwimlanes } from "./task-kanban-swimlanes";
import { TaskSwimlaneToolbar } from "./task-swimlane-toolbar";
import { UNASSIGNED_LANE, laneResourceIds, type KanbanLane } from "./task-kanban";
import { resourceDisplayName } from "./resource-foundation";
import { CalendarSyncControls } from "./calendar-sync-controls";
import { ToggleButton } from "./toggle-button";
import { SegmentedControl } from "./segmented-control";
import { useSettings } from "./use-settings";
import { useEffectiveSettings } from "./use-effective-settings";
import { getAppearanceSnapshot, saveProjectAppearance, subscribeAppearance } from "./project-appearance-prefs";
import { useHolidaySet } from "./use-holiday-set";
import { type SortKey, useFilters } from "./filters-context";
import { useWorkspace } from "./workspace-context";
import { useTaskForm } from "./task-form-context";
import { useTasksInlineAiEdit } from "./use-tasks-inline-ai-edit";
import { useTasksDedup } from "./use-tasks-dedup";
import type { ToolDispatcher } from "./chat-tools";
import type { LogActivityAsFn } from "./activity-log-context";
import { BulkEditModal } from "./bulk-edit-modal";
import { TypeToConfirmDialog } from "./type-to-confirm-dialog";
import { RowContextProvider, TaskRow, type RowContextValue } from "./task-row";
import { useDeepLinkRowFlash } from "./use-deeplink-row-flash";
import { isTaskFinished } from "./task-status";
import { filterTasksByHealth, type HealthFilter } from "./health";
import { visibleTaskRows } from "./visible-task-rows";
import { sanitizeInlinePatch } from "./task-inline-patch";
import type { UndoStackApi } from "./undo/use-undo-stack";
import { valuesDiffer } from "./undo/field-groups";
import { useEntityCalendarPush } from "./use-entity-calendar-push";
import { useEntityCalendarPull } from "./use-entity-calendar-pull";
import { CalendarPullSummaryModal } from "./calendar-pull-summary-modal";
import { taskToGraphEvent } from "./outlook-calendar-write";
import { calendarSyncFor } from "./calendar-sync-config";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { ActionChips, chipsForView } from "./action-chips";
import { ViewCallout } from "./view-callout";
import { SavedViewsControl } from "./saved-views-control";
import { INTERACTIVE } from "./interaction-styles";
import { ColumnConfigPopover } from "./column-config-popover";
import { Select } from "./form-controls";
import { AddButton, PaneSearchInput } from "./pane-toolbar";
import { AddFirstItemButton } from "./add-first-item-button";
import { IconButton } from "./icon-button";
import type { SuggestedAction } from "./next-actions/types";
import {
  EraserIcon,
  PrintButton,
  ResetColWidthsButton,
  ResetSizeButton,
  Th,
} from "./task-manager-ui";
import { SortResizeTh, useSortHeaderProps } from "./report-table";
import { GUTTER_WIDTH_PX, colWidthStyle, tableMinWidthPx, visibleTaskCols } from "./open-points-table-geometry";

/** Stable empty directory so a resource-less workspace keeps the row-context memo
 *  reference-stable (a fresh `[]` each render would bust it). */
const EMPTY_RESOURCES: readonly Resource[] = [];

/** Fixed English friction phrase to confirm clearing all tasks (mirrors the
 *  factory-reset dialog). Deliberately not localized. */
const CLEAR_TASKS_CONFIRM_PHRASE = "yes, clear all tasks";

// ★ Exported for its guard test: `taskName` must never appear here (see open-points-table-geometry.ts).
export const CONFIGURABLE_COLS: Array<{ key: string; labelKey: TranslationKey }> = [
  { key: "status",         labelKey: "health" },
  { key: "id",             labelKey: "id" },
  { key: "assignee",       labelKey: "assignee" },
  { key: "startDate",      labelKey: "start" },
  { key: "dueDate",        labelKey: "due" },
  { key: "lastUpdateDate", labelKey: "lastUpdate" },
  { key: "createdDate",    labelKey: "colCreatedDate" },
  { key: "priority",       labelKey: "priority" },
  { key: "taskStatus",     labelKey: "colTaskStatus" },
  { key: "blockers",       labelKey: "blockers" },
  { key: "description",    labelKey: "description" },
  { key: "notesLog",       labelKey: "noteLogTitle" },
  { key: "depRelations",   labelKey: "depRelations" },
  { key: "estimate",       labelKey: "taskOriginalEstimate" },
  { key: "spent",          labelKey: "taskTimeSpent" },
];

export interface TasksSectionProps {
  lang: Lang;
  today: string;
  /** The holidays behind the RAG health filter, from task-manager's ONE
   *  `useHolidaySet`. It feeds the same value to `useBulkOperations`, and the
   *  two must agree or the shared `visibleTaskRows()` stops being one
   *  definition. OPTIONAL only because the standalone pane unit test renders
   *  without it; production always passes it. */
  holidaySet?: Set<string>;
  /** When set, the pane fills its parent (modern full-height layout) instead of
   *  rendering as a fixed-height, user-resizable box (classic layout). */
  fillHeight?: boolean;
  // Row-context data not already in props
  jiraSiteUrl: string;
  jiraExtraProjects: readonly JiraExtraProject[];
  // Row-context callbacks — assembled into rowContextValue useMemo internally
  onToggleSelect: (id: number) => void;
  /** Open the floating notes window for a task (running note log). */
  onOpenNotes: (id: number) => void;
  onJumpToRaid: (id: number) => void;
  onSendInquiry: (task: Task) => void;
  onPushToJira: (id: number) => void;
  onStatusChange: (id: number, next: TaskStatus) => void;
  /** Swimlane cell drop: identifies both the person (lane) and status in one call. */
  onSwimlaneDrop: (id: number, lane: KanbanLane, status: TaskStatus, source?: "drag" | "assign") => void;
  onEdit: (task: Task) => void;
  onDelete: (id: number) => void;
  // column manager
  hiddenCols: Set<string>;
  setHiddenCols: React.Dispatch<React.SetStateAction<Set<string>>>;
  /** ONLY the columns the user explicitly sized — an absent key is at its
   *  default, which is what lets taskName render width-free. */
  sizedWidths: Partial<Record<string, number>>;
  startColResize: (col: string, e: React.MouseEvent) => void;
  resetColWidths: () => void;
  // resizable table
  tableRef: React.RefObject<HTMLElement | null>;
  resetTableSize: () => void;
  // row state
  pushingIds: Set<number>;
  raidByTask: Map<number, RaidItem[]>;
  changeByTask: Map<number, ChangeItem[]>;
  /** The SAME reverse index the registers use (built once in task-manager), keyed
   *  by `refKey(kind, id)` — threaded rather than pre-counted so the task and
   *  register surfaces share one index and one key derivation. */
  documentsByEntity: ReadonlyMap<string, readonly ProjectDocument[]>;
  /** Deep-link to the Documents pane, filtered to this task. */
  onOpenDocuments: (taskId: number) => void;
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
  handleBulkDelete: (ids: Set<number>) => void;
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
  // is the stable Outlook event-category id (falls back to project.code), NOT the
  // per-project settings key; `m365Configured` gates the toggle + Push button.
  projectId?: string;
  // Per-project settings/appearance key — MUST match SettingsView + workspace-section
  // (`portfolioCurrentId ?? "default"`), which differs from the calendar `projectId`
  // (the calendar id has a `project.code` fallback). Used for the effective view mode.
  settingsProjectId?: string;
  m365Configured?: boolean;
  // Inline "Ask Claude" task edit (SP1): the ToolDispatcher backing the single
  // useInlineAiEdit instance owned here, plus optional activity logging —
  // both threaded from task-manager.
  dispatcher: ToolDispatcher;
  logActivityAs?: LogActivityAsFn; // ★ ACTOR-AWARE — its consumer (dedup) writes an `ai.*` kind and stamps its own actor.
  /** Capture a field-level undo entry for an inline cell edit. */
  captureFieldEdit?: UndoStackApi["captureFieldEdit"];
  /** Capture a single (removed + edited) undo entry for an AI dedup merge. */
  captureMerge?: UndoStackApi["capture"];
}

export function TasksSection({
  lang,
  today,
  holidaySet: holidaySetProp,
  fillHeight,
  jiraSiteUrl,
  jiraExtraProjects,
  onToggleSelect,
  onOpenNotes,
  onJumpToRaid,
  onSendInquiry,
  onPushToJira,
  onStatusChange,
  onSwimlaneDrop,
  onEdit,
  onDelete,
  hiddenCols,
  setHiddenCols,
  sizedWidths,
  startColResize,
  resetColWidths,
  tableRef,
  resetTableSize,
  pushingIds,
  raidByTask,
  changeByTask,
  documentsByEntity,
  onOpenDocuments,
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
  handleBulkDelete,
  applyBulkEdit,
  cancelBulkEdit,
  nextActions = [],
  onOpenAction,
  onShowActions,
  showViewHints,
  isPopout,
  onLearnMoreHint,
  projectId,
  settingsProjectId,
  m365Configured,
  dispatcher,
  logActivityAs,
  captureFieldEdit,
  captureMerge,
}: TasksSectionProps) {
  const {
    search, setSearch,
    priorityFilter, setPriorityFilter,
    // Raw values are NOT read here — the <select>s render effectiveFilters so an
    // orphaned one resolves in the control and the row filter together.
    setAssigneeFilter, setGroupFilter, setLabelFilter,
    healthFilter, setHealthFilter,
    sortKey, sortDir, setSortKey, setSortDir,
  } = useFilters();

  const workspaceCtx = useWorkspace();
  const { tasks, filteredSortedTasks, uniqueAssignees, uniqueGroups, uniqueLabels, tasksById, setTasks, resources, effectiveFilters } =
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
  // ONE holidaySet, threaded from task-manager, which feeds the SAME value to
  // useBulkOperations. Deriving a second one here made the pane and the hook
  // agree only by convention — both happened to read the same device setting.
  // The local hook survives solely as the fallback for the standalone pane unit
  // test (it renders TasksSection with no prop); task-manager always passes one.
  const { holidaySet: fallbackHolidaySet } = useHolidaySet({ holidayCountries: settings.holidayCountries });
  const holidaySet = holidaySetProp ?? fallbackHolidaySet;
  const { flashId, containerRef } = useDeepLinkRowFlash("open-points");

  // Inline "Ask Claude" task edit (SP1) — wired via a dedicated glue hook so this
  // pane stays lean; it owns the single active-edit popover element.
  const { onAiEdit, aiEditEnabled, popover: inlineAiEditPopover } = useTasksInlineAiEdit({
    dispatcher,
    settings,
    isPopout: isPopout ?? false,
    lang,
    workspaceCtx,
  });
  // "Deduplicate & unify" (plan-then-apply AI merge) — owns its trigger + modal.
  const dedup = useTasksDedup({
    settings, isPopout: isPopout ?? false, lang, tasks, setTasks,
    capture: captureMerge, logActivityAs,
  });

  const hideExternal = settings.hideExternalTasks ?? false;
  // View mode reads the EFFECTIVE value (device default OR this project's
  // appearance override). The in-pane toggle below writes to whichever scope is
  // active, so an override no longer snaps back when toggled. Keys off
  // `settingsProjectId` (canonical `portfolioCurrentId ?? "default"`) — NOT the
  // calendar `projectId`, whose `project.code` fallback would land the override
  // under a different key than SettingsView writes.
  const pid = settingsProjectId ?? "default";
  const effectiveSettings = useEffectiveSettings(pid);
  const projectAppearance = useSyncExternalStore(
    subscribeAppearance,
    () => getAppearanceSnapshot(pid),
    () => getAppearanceSnapshot(pid),
  );
  // EFFECTIVE, not device: useBulkOperations reads this flag off the settings
  // task-manager hands it, which are the effective ones. `hideFinishedTasks` is
  // not an override today, but `tasksViewMode` already joined that list once —
  // reading device here would silently re-open the drift the shared
  // visibleTaskRows() exists to close. The toggle below still writes device
  // settings, which is where the flag lives.
  const hideFinished = effectiveSettings.hideFinishedTasks ?? false;
  const tasksViewMode = effectiveSettings.tasksViewMode ?? "table";
  const viewModeOverridden = projectAppearance.tasksViewMode !== undefined;
  const setTasksViewMode = useCallback(
    (mode: "table" | "board" | "swimlane") => {
      if (viewModeOverridden)
        saveProjectAppearance(pid, { ...projectAppearance, tasksViewMode: mode });
      else setSettings((s) => ({ ...s, tasksViewMode: mode }));
    },
    [viewModeOverridden, pid, projectAppearance, setSettings],
  );

  // Extra swimlane rows the user pulled in so an empty person is droppable.
  // Session-only: not persisted, cleared on unmount.
  const [extraLaneIds, setExtraLaneIds] = useState<readonly number[]>([]);
  const addLane = useCallback(
    (id: number) => setExtraLaneIds((prev) => (prev.includes(id) ? prev : [...prev, id])),
    [],
  );
  const removeLane = useCallback(
    (id: number) => setExtraLaneIds((prev) => prev.filter((x) => x !== id)),
    [],
  );

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
  // RAG health filter (toolbar) applies to BOTH the table and the board; the
  // separate hide-finished toggle stays table-only (below). "all" is a no-op.
  const healthFilteredTasks = useMemo(
    () => filterTasksByHealth(filteredSortedTasks, healthFilter, today, holidaySet),
    [filteredSortedTasks, healthFilter, today, holidaySet],
  );
  // ONE definition, shared with useBulkOperations — see visible-task-rows.ts.
  // The hook used to derive select-all from `filteredSortedTasks`, upstream of
  // both filters, so it reached rows the user could not see.
  const visibleRows = useMemo(
    () => visibleTaskRows(filteredSortedTasks, healthFilter, hideFinished, { today, holidaySet }),
    [filteredSortedTasks, healthFilter, hideFinished, today, holidaySet],
  );

  const laneIds = useMemo(
    () => laneResourceIds(healthFilteredTasks, resourcesById, extraLaneIds),
    [healthFilteredTasks, resourcesById, extraLaneIds],
  );
  // Both assign pickers narrow to internals while "Hide externals" is on, so
  // a user can't assign work to someone whose card the toggle then hides.
  const assignableResources = useMemo(
    () => (hideExternal ? resources.filter((r) => !r.isExternal) : resources),
    [hideExternal, resources],
  );
  // A lane pulled in via the picker while "Hide externals" was OFF must not
  // outlive the toggle: the picker only stops OFFERING an external going
  // forward, it doesn't retract a lane already in extraLaneIds, so without
  // this filter that lane keeps rendering as a live drop target — dropping a
  // task there assigns it to the external and the card silently vanishes
  // (the same defect the picker fix closed on the picker side). The raw
  // extraLaneIds state is left untouched so the lane returns when the toggle
  // flips back off (mirrors the orphaned-filter self-healing convention).
  const visibleExtraLaneIds = useMemo(
    () =>
      hideExternal
        ? extraLaneIds.filter((id) => !resourcesById.get(id)?.isExternal)
        : extraLaneIds,
    [hideExternal, extraLaneIds, resourcesById],
  );

  // Swimlane keyboard assign path: reuses onSwimlaneDrop (the same functional write the drag uses)
  // with the task's CURRENT status, so keyboard and mouse can never diverge. ★★ Passes "assign" — an
  // explicit pick against a select controlled on the STORED FK, so its no-op test differs; see there.
  const onAssignFromCard = useCallback(
    (taskId: number, resourceId: number | null) => {
      const current = healthFilteredTasks.find((t) => t.id === taskId);
      if (!current) return;
      const r = resourceId != null ? resourcesById.get(resourceId) : undefined;
      onSwimlaneDrop(
        taskId,
        r
          ? { key: `res:${r.id}`, label: resourceDisplayName(r), resourceId: r.id }
          : { key: UNASSIGNED_LANE, label: "", resourceId: null },
        current.status, "assign",
      );
    },
    [healthFilteredTasks, resourcesById, onSwimlaneDrop],
  );

  // Inline Open-Points cell edit: apply one sanitized field patch to a task via
  // a functional setter, stamping localModifiedAt. Mirrors the form-save
  // sanitizers (use-task-submit); Jira-synced rows are read-only and skipped.
  const onInlinePatch = useCallback(
    (taskId: number, patch: Partial<Task>) => {
      const beforeRow = tasks.find((tk) => tk.id === taskId);
      // Jira-synced rows are read-only — no edit, no capture.
      if (!beforeRow || beforeRow.jiraKey) return;
      const knownTaskIds = new Set(tasks.map((tk) => tk.id));
      const clean = sanitizeInlinePatch(patch, {
        hasResource: (id) => resourcesById.has(id),
        knownTaskIds,
        ownTaskId: taskId,
      });
      setTasks((prev) =>
        prev.map((row) =>
          row.id === taskId && !row.jiraKey
            ? { ...row, ...clean, localModifiedAt: new Date().toISOString() }
            : row,
        ),
      );
      const cleanKeys = Object.keys(clean) as (keyof Task)[];
      const anyChanged = cleanKeys.some((k) => valuesDiffer(beforeRow[k], clean[k]));
      if (cleanKeys.length > 0 && anyChanged) {
        const before: Partial<Task> = {};
        for (const k of cleanKeys) {
          (before as Record<string, unknown>)[k] = beforeRow[k];
        }
        captureFieldEdit?.({
          setter: setTasks,
          kind: "task.updated",
          id: taskId,
          before,
          after: clean,
          stampField: "localModifiedAt",
        });
      }
    },
    [tasks, setTasks, resourcesById, captureFieldEdit],
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
      onOpenNotes,
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
      onOpenNotes,
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

  // The four props every one of the 11 sortable headers repeats verbatim. No
  // explicit generic: `sortKey` is already the `SortKey` literal union (it comes
  // from `useFilters`, not from a bare-string `PanelSort`), so `K` infers
  // correctly and `sortCol` stays checked against it.
  const th = useSortHeaderProps(sortKey, sortDir, toggleSort, startColResize);

  const visibleCols = useMemo(() => visibleTaskCols(hiddenCols), [hiddenCols]);
  const tableMinWidth = useMemo(() => tableMinWidthPx(visibleCols, sizedWidths), [visibleCols, sizedWidths]);
  const visibleColumnCount = visibleCols.length;

  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [deleteSelectedConfirmOpen, setDeleteSelectedConfirmOpen] = useState(false);
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
        <AddButton
          onClick={() => {
            handleCancelEdit();
            setTaskModalOpen(true);
          }}
          aria-label={t(lang, "addTaskButton")}
          title={t(lang, "addTaskButton")}
        >
          + {t(lang, "addTaskButton")}
        </AddButton>
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
            className={`inline-flex items-center gap-1.5 rounded-md border border-ui-dark-blue bg-surface px-2.5 py-1.5 text-xs font-medium text-ui-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
          >
            <ArrowPathIcon aria-hidden="true" className={`h-4 w-4 ${jiraSyncing ? "animate-spin" : ""}`} />
            {jiraSyncing ? t(lang, "jiraSyncing") : t(lang, "jiraSync")}
          </button>
        )}
        {dedup.button}
        <ToggleButton lang={lang}
          pressed={hideFinished}
          onToggle={() => setSettings((s) => ({ ...s, hideFinishedTasks: !(s.hideFinishedTasks ?? false) }))}
          icon={<CheckCircleIcon aria-hidden="true" className="h-3.5 w-3.5" />}
        >
          {t(lang, "hideFinishedTasks")}
        </ToggleButton>
        <ToggleButton lang={lang}
          pressed={hideExternal}
          onToggle={() => setSettings((s) => ({ ...s, hideExternalTasks: !(s.hideExternalTasks ?? false) }))}
          icon={<EyeSlashIcon aria-hidden="true" className="h-3.5 w-3.5" />}
        >
          {t(lang, "hideExternalTasks")}
        </ToggleButton>
        <SegmentedControl
          value={tasksViewMode}
          options={[
            { value: "table", label: t(lang, "tasksViewTable") },
            { value: "board", label: t(lang, "tasksViewBoard") },
            { value: "swimlane", label: t(lang, "tasksViewSwimlane") },
          ]}
          onChange={setTasksViewMode}
          ariaLabel={t(lang, "tasksViewModeLabel")}
        />
        {tasksViewMode === "swimlane" && (
          <TaskSwimlaneToolbar
            lang={lang}
            resources={assignableResources}
            laneResourceIds={laneIds}
            onAddLane={addLane}
          />
        )}
        <PaneSearchInput
          value={search}
          onChange={setSearch}
          ariaLabel={t(lang, "searchPlaceholder")}
          clearLabel={`${t(lang, "clear")} – ${t(lang, "searchPlaceholder")}`}
          title={t(lang, "tasksSearchHint")}
        />
        <Select
          size="xs"
          value={priorityFilter}
          onChange={(e) =>
            setPriorityFilter(e.target.value as Priority | "All")
          }
          title={t(lang, "priorityFilterHint")}
        >
          <option value="All">{t(lang, "allPriorities")}</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {priorityLabel(lang, p)}
            </option>
          ))}
        </Select>
        <Select
          size="xs"
          value={effectiveFilters.assignee}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          title={t(lang, "assigneeFilterHint")}
        >
          <option value="All">{t(lang, "allAssignees")}</option>
          {/* uniqueAssignees KEEPS blanks, so label the unassigned option (value stays ""). */}
          {uniqueAssignees.map((a) => (
            <option key={a} value={a}>{a === "" ? t(lang, "assigneeNone") : a}</option>
          ))}
        </Select>
        <Select
          size="xs"
          value={effectiveFilters.group}
          onChange={(e) => setGroupFilter(e.target.value)}
          title={t(lang, "tasksGroupFilterHint")}
        >
          <option value="All">{t(lang, "allGroups")}</option>
          <option value="">{t(lang, "groupNone")}</option>
          {uniqueGroups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </Select>
        <Select
          size="xs"
          value={effectiveFilters.label}
          onChange={(e) => setLabelFilter(e.target.value)}
          title={t(lang, "tasksLabelFilterHint")}
        >
          <option value="All">{t(lang, "allLabels")}</option>
          {uniqueLabels.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </Select>
        <Select
          size="xs"
          value={healthFilter}
          onChange={(e) => setHealthFilter(e.target.value as HealthFilter)}
          aria-label={t(lang, "healthFilterLabel")}
          title={t(lang, "healthFilterHint")}
        >
          <option value="all">{t(lang, "allHealth")}</option>
          <option value="red">{t(lang, "healthRed")}</option>
          <option value="amber">{t(lang, "healthAmber")}</option>
          <option value="green">{t(lang, "healthGreen")}</option>
        </Select>
        <ColumnConfigPopover
          lang={lang}
          cols={CONFIGURABLE_COLS}
          hidden={hiddenCols}
          onToggle={(key) =>
            setHiddenCols((prev) => {
              const next = new Set(prev);
              if (next.has(key)) { next.delete(key); } else { next.add(key); }
              return next;
            })
          }
        />
        <SavedViewsControl lang={lang} hiddenCols={hiddenCols} setHiddenCols={setHiddenCols} />
        <CalendarSyncControls
          lang={lang}
          entityLabelKey="calendarSyncEntityTask"
          m365Configured={m365Configured}
          isPopout={isPopout}
          calendarEnabled={calendarTaskEnabled}
          onToggleCalendar={(enabled) =>
            setSettings((s) => ({
              ...s,
              outlookCalendar: {
                ...s.outlookCalendar,
                // Disabling here also forces auto off (mirrors the Settings toggle)
                // so re-enabling from this toggle can't silently reactivate auto-sync.
                task: {
                  enabled,
                  auto: enabled ? (s.outlookCalendar?.task?.auto ?? false) : false,
                },
              },
            }))
          }
          onPushCalendar={() => void pushTasksToOutlook()}
          calendarPushBusy={calPushBusy}
          onPullCalendar={() => void taskPull.pull()}
          calendarPullBusy={taskPull.busy}
        />
        <IconButton
          variant="dangerBordered"
          size="md"
          onClick={() => setClearConfirmOpen(true)}
          disabled={tasks.length === 0}
          label={t(lang, "clearAll")}
          title={t(lang, "clearAll")}
        >
          <EraserIcon />
        </IconButton>
        <PrintButton lang={lang} />
        <ResetColWidthsButton onClick={resetColWidths} lang={lang} />
        <ResetSizeButton onClick={resetTableSize} lang={lang} />
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
          <span className="text-sm font-medium text-ui-dark-blue dark:text-ui-light-grey">
            {t(lang, "selectionCount", selectedIds.size)}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleBulkSendInquiry}
              className={`rounded-md bg-ui-green px-3 py-1.5 text-sm font-medium text-ui-dark-blue hover:opacity-90 ${INTERACTIVE}`}
            >
              {t(lang, "bulkSendInquiries")}
            </button>
            <ToggleButton lang={lang} pressed={bulkEditOpen} onToggle={() => setBulkEditOpen((o) => !o)}>
              {t(lang, "bulkEdit")}
            </ToggleButton>
            <button
              type="button"
              onClick={() => setDeleteSelectedConfirmOpen(true)}
              className={`rounded-md border border-ui-pink-strong bg-surface px-3 py-1.5 text-sm font-medium text-ui-pink-strong hover:bg-ui-pink/5 ${INTERACTIVE}`}
            >
              {t(lang, "deleteSelected")}
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

      {deleteSelectedConfirmOpen && (
        <TypeToConfirmDialog
          lang={lang}
          title={t(lang, "tasksDeleteSelectedDialogTitle")}
          message={t(lang, "tasksDeleteSelectedDialogMessage", selectedIds.size)}
          confirmValue={`delete ${selectedIds.size} tasks`}
          confirmLabel={t(lang, "tasksDeleteSelectedConfirmLabel")}
          onConfirm={() => {
            handleBulkDelete(selectedIds);
            setDeleteSelectedConfirmOpen(false);
          }}
          onCancel={() => setDeleteSelectedConfirmOpen(false)}
        />
      )}

      <BulkEditModal
        lang={lang}
        today={today}
        selectedIds={selectedIds}
        selectedJiraCount={selectedJiraCount}
        uniqueGroups={uniqueGroups}
        uniqueLabels={uniqueLabels}
        budgetBuckets={workspaceCtx.budgets}
        onApply={applyBulkEdit}
        onCancel={cancelBulkEdit}
      />

      </div>{/* end shrink-0 */}

      {tasksViewMode === "swimlane" ? (
        /* Swimlane view shows the same search/people-filtered task set as the
           board (NOT the hide-finished filtered `visibleRows`) so cancelled/done
           columns stay populated. */
        <TaskKanbanSwimlanes
          lang={lang}
          tasks={healthFilteredTasks}
          resourcesById={resourcesById}
          extraLaneIds={visibleExtraLaneIds}
          today={today}
          holidaySet={holidaySet}
          raidByTask={raidByTask}
          changeByTask={changeByTask}
          documentsByEntity={documentsByEntity}
          onOpenDocuments={onOpenDocuments}
          onSwimlaneDrop={onSwimlaneDrop}
          assignableResources={assignableResources}
          onAssign={onAssignFromCard}
          onStatusChange={onStatusChange}
          onEdit={onEdit}
          onRemoveLane={removeLane}
          onJumpToRaid={onJumpToRaid}
          jiraProjectKey={jiraProjectKey}
          jiraExtraProjects={jiraExtraProjects}
          containerRef={containerRef}
          flashId={flashId}
          onAiEdit={onAiEdit}
          aiEditEnabled={aiEditEnabled}
        />
      ) : tasksViewMode === "board" ? (
        /* Board view shows every search/people-filtered task (NOT the
           hide-finished filtered `visibleRows`) so cancelled/done columns
           stay populated. SP-B Task 6 swaps in the rich <TaskKanbanCard>. */
        <TaskKanban
          lang={lang}
          tasks={healthFilteredTasks}
          today={today}
          holidaySet={holidaySet}
          resourcesById={resourcesById}
          raidByTask={raidByTask}
          changeByTask={changeByTask}
          documentsByEntity={documentsByEntity}
          onOpenDocuments={onOpenDocuments}
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
          <AddFirstItemButton
            onAdd={() => {
              handleCancelEdit();
              setTaskModalOpen(true);
            }}
            text={t(lang, "noTasks")}
            addLabel={`+ ${t(lang, "addTaskButton")}…`}
            rounded="xl"
          />
        ) : (
        <RowContextProvider value={rowContextValue} tasksById={tasksById}>
          <table
            className="divide-y divide-line text-left text-sm"
            style={{ tableLayout: "fixed", width: "100%", minWidth: `${tableMinWidth}px` }}
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
              <tr>
                {/* Leading gutter matching the per-row hover Ask-Claude cell. */}
                <th className="w-7" aria-hidden="true" />
                <Th padding="tight" onResize={(e) => startColResize("sel", e)}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAllVisible}
                    aria-label={t(lang, "selectAllVisible")}
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
              {visibleRows.map((task, i) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  isSelected={selectedIds.has(task.id)}
                  isEditing={editingId === task.id}
                  isPushing={pushingIds.has(task.id)}
                  raidRefs={raidByTask.get(task.id)}
                  changeRefs={changeByTask.get(task.id)}
                  documentsByEntity={documentsByEntity}
                  onOpenDocuments={onOpenDocuments}
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
                    className={`group flex w-full cursor-pointer items-center gap-2 border-b border-dashed border-line px-3 py-1.5 text-sm text-muted-foreground hover:bg-ui-dark-blue/5 hover:text-ui-dark-blue dark:hover:bg-white/5 ${INTERACTIVE}`}
                  >
                    <PlusIcon aria-hidden="true" className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100" />
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
      {dedup.modal}
    </section>
  );
}
