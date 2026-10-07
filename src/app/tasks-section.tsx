"use client";
import type React from "react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { type Lang, t, tPlural } from "./i18n";
import { type ChangeItem, type RaidItem, type Resource, type Task, type TaskStatus } from "./types";
import type { ProjectDocument } from "./document-model";
import { type JiraExtraProject } from "./settings-types";
import { TaskKanban } from "./task-kanban-board";
import { TaskKanbanSwimlanes } from "./task-kanban-swimlanes";
import { UNASSIGNED_LANE, laneResourceIds, type KanbanLane } from "./task-kanban";
import { resourceDisplayName } from "./resource-foundation";
import { CalendarSyncControls } from "./calendar-sync-controls";
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
import { RowContextProvider, type RowContextValue } from "./task-row";
import { useDeepLinkRowFlash } from "./use-deeplink-row-flash";
import { useTaskRowWindow, TASK_ROW_ESTIMATE_PX } from "./use-task-row-window";
import { filterTasksByHealth } from "./health";
import { visibleTaskRows } from "./visible-task-rows";
import { useRowTokens } from "./use-row-tokens";
import { inlineAssigneeEmailRefusal, sanitizeInlinePatch } from "./task-inline-patch";
import { useToastContext } from "./toast-context";
import { EMAIL_REFUSAL_KEY } from "./email-refusal-i18n";
import type { UndoStackApi } from "./undo/use-undo-stack";
import { differs } from "./undo/field-groups";
import { useEntityCalendarPush } from "./use-entity-calendar-push";
import { useEntityCalendarPull } from "./use-entity-calendar-pull";
import type { ScopeEpochReader } from "./scope-epoch";
import { CalendarPullSummaryModal } from "./calendar-pull-summary-modal";
import { taskToGraphEvent } from "./outlook-calendar-write";
import { calendarSyncFor, withCalendarEnabled } from "./calendar-sync-config";
import { isPushableTask } from "./calendar-pushable";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { ActionChips, chipsForView } from "./action-chips";
import { ViewCallout } from "./view-callout";
import { AddFirstItemButton } from "./add-first-item-button";
import type { SuggestedAction } from "./next-actions/types";
import { useSortHeaderProps } from "./report-table";
import { tableMinWidthPx, visibleTaskCols } from "./open-points-table-geometry";
import { TasksSelectionBar, TasksToolbar, type TasksViewMode } from "./tasks-section-toolbar";
import { TasksTable } from "./tasks-section-rows";

/** Stable empty directory so a resource-less workspace keeps the row-context memo
 *  reference-stable (a fresh `[]` each render would bust it). */
const EMPTY_RESOURCES: readonly Resource[] = [];

// Module-level accessor for useRowTokens — an inline arrow would be a fresh
// closure every render, defeating its useMemo and tripping exhaustive-deps.
const nameOfTask = (task: Task) => task.taskName;

export { CONFIGURABLE_COLS } from "./tasks-section-toolbar";

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
  /** Open the floating blocker window for a task (blocker log). */
  onOpenBlockers: (id: number) => void;
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
  /** Jump to the Changes view filtered to this task's linked changes (open-followups §481). */
  onJumpToChanges: (taskId: number) => void;
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
  /** §548 — `useStorageBackend`'s scope-epoch reader, threaded into this pane's OWN
   *  `useEntityCalendarPush` / `useEntityCalendarPull` instances so a Graph call started
   *  in one project cannot stamp its `outlookEventId`s — or its Outlook dates as
   *  `dueDate` — onto the next project's same-id tasks. ★ REQUIRED, not optional,
   *  exactly like `CalendarIntegrationDeps.getScopeEpoch`: the reader is optional at the
   *  hooks themselves, so a pane that silently stopped passing it would keep working and
   *  keep corrupting. tsc is the only thing that can see that, so it is made to.
   *  ★★ KNOWN GAP, recorded rather than assumed away: `ScopeEpochReader` is `() => number`, so tsc
   *  proves a reader of the right TYPE arrives — never that it is `useStorageBackend`'s. Nothing
   *  MOUNTS this wiring either (`task-manager.characterization.test.tsx` mocks `workspace-section`
   *  and only ever constructs `tasksSectionEl` as JSX), so a `() => 0` substituted at the call site
   *  would pass every gate. The risk is low because the same identifier already feeds the two deps
   *  bags in the same render scope, and those ARE covered — but do not read this prop as pinned. */
  getScopeEpoch: ScopeEpochReader;
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
  onOpenBlockers,
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
  onJumpToChanges,
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
  getScopeEpoch,
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
  const showToast = useToastContext();

  const { settings, setSettings } = useSettings();
  // ONE holidaySet, threaded from task-manager, which feeds the SAME value to
  // useBulkOperations. Deriving a second one here made the pane and the hook
  // agree only by convention — both happened to read the same device setting.
  // The local hook survives solely as the fallback for the standalone pane unit
  // test (it renders TasksSection with no prop); task-manager always passes one.
  const { holidaySet: fallbackHolidaySet } = useHolidaySet({ holidayCountries: settings.holidayCountries });
  const holidaySet = holidaySetProp ?? fallbackHolidaySet;
  // §5: a deep link to a row outside the virtualized window first scrolls it
  // into range. `scrollRowIntoRange` is declared below, after `visibleRows`;
  // the hook calls this only from an effect, after render, so it is defined.
  const { flashId, containerRef } = useDeepLinkRowFlash("open-points", {
    scrollToId: (id) => scrollRowIntoRange(id),
  });

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
    (mode: TasksViewMode) => {
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

  // Outlook calendar write-back (SP1): manual push of unfinished, dated tasks
  // (plus opted-out ones still linked, so their kept event is not deleted — §486).
  // The hook is called unconditionally (rules of hooks); `enabled` gates the
  // MSAL session so it stays inert when M365 is not configured.
  const calendarTaskEnabled = calendarSyncFor(settings, "task").enabled;
  const pushableTasks = useMemo(
    () => tasks.filter(isPushableTask),
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
    // §548 — this pane mounts its own push instance, so it must carry the reader itself;
    // the seventeen instances in `use-calendar-integrations.ts` get it from the deps bag.
    getScopeEpoch,
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
    // §548 — same reader as the push above: a pull resolving after a project change would
    // otherwise write the OLD project's Outlook dates as `dueDate` on the NEW project's tasks.
    getScopeEpoch,
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
  // §5: above VIRTUALIZE_MIN_ROWS rows the table renders a window of rows.
  // ★ The board and swimlane views reuse `containerRef` as THEIR scroll box, so
  // the count is 0 outside the table — a live virtualizer would otherwise
  // observe the board's scrolling and re-render this pane for nothing.
  const isTableView = tasksViewMode !== "board" && tasksViewMode !== "swimlane";
  const rowWindow = useTaskRowWindow({
    count: isTableView ? visibleRows.length : 0,
    scrollRef: containerRef,
    estimateRowPx: TASK_ROW_ESTIMATE_PX,
  });
  const scrollRowIntoRange = (id: number) => {
    const index = visibleRows.findIndex((task) => task.id === id);
    if (index >= 0) rowWindow.scrollToIndex(index);
  };

  // ★★ TWO maps, not one, and this is not redundancy. The table renders
  // `visibleRows` (which also applies hide-finished) while both Kanban views
  // render `healthFilteredTasks`. An occurrence index is only meaningful over
  // the array actually on screen, so a shared map would number the table's rows
  // against tasks the table is not showing.
  const tableTokens = useRowTokens(visibleRows, nameOfTask);
  // ★ Board and swimlanes share this one: both render the whole array on one
  // page, so uniqueness has to span lanes and columns, not sit inside one.
  const boardTokens = useRowTokens(healthFilteredTasks, nameOfTask);

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
      // The picked resource's stored email, or undefined when the id is not a
      // number or names no live resource (fix round 1 MINOR 4 — an `[""]`
      // fallback here would exempt a blank clear from the copy-source list,
      // which `emailWriteRefusal` already exempts unconditionally; a missing
      // resource must contribute NO copy source, not an empty one).
      const pickedResourceEmail =
        typeof patch.resourceId === "number" ? resourcesById.get(patch.resourceId)?.email : undefined;
      const patchCtx = {
        hasResource: (id: number) => resourcesById.has(id),
        knownTaskIds,
        ownTaskId: taskId,
        storedAssigneeEmail: beforeRow.assigneeEmail,
        // Only the resource THIS patch picked (spec decision 2, pre-flight M10).
        copySourceEmails: pickedResourceEmail !== undefined ? [pickedResourceEmail] : [],
      };
      const emailRefusal = inlineAssigneeEmailRefusal(patch, patchCtx);
      if (emailRefusal !== null) showToast("error", t(lang, EMAIL_REFUSAL_KEY[emailRefusal]));
      // ★ `clean` never carries `blockers`/`blockerLog` (`sanitizeInlinePatch`
      // drops them): the blockers cell is a badge opening the blocker window,
      // which is the only writer of the log, so a plain spread is safe here.
      const clean = sanitizeInlinePatch(patch, patchCtx);
      setTasks((prev) =>
        prev.map((row) =>
          row.id === taskId && !row.jiraKey
            ? { ...row, ...clean, localModifiedAt: new Date().toISOString() }
            : row,
        ),
      );
      const cleanKeys = Object.keys(clean) as (keyof Task)[];
      const anyChanged = cleanKeys.some((k) => differs(beforeRow[k], clean[k]));
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
    [tasks, setTasks, resourcesById, captureFieldEdit, showToast, lang],
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
      onOpenBlockers,
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
      onOpenBlockers,
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

  // ONE opener for every "+ Add task" control: discards any in-progress edit, then opens the editor.
  const openTaskEditor = () => {
    handleCancelEdit();
    setTaskModalOpen(true);
  };

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
      <TasksToolbar
        lang={lang}
        onAdd={openTaskEditor}
        jiraEnabled={jiraEnabled}
        handleJiraSync={handleJiraSync}
        jiraSyncing={jiraSyncing}
        jiraProjectKey={jiraProjectKey}
        dedupButton={dedup.button}
        hideFinished={hideFinished}
        onToggleHideFinished={() => setSettings((s) => ({ ...s, hideFinishedTasks: !(s.hideFinishedTasks ?? false) }))}
        hideExternal={hideExternal}
        onToggleHideExternal={() => setSettings((s) => ({ ...s, hideExternalTasks: !(s.hideExternalTasks ?? false) }))}
        tasksViewMode={tasksViewMode}
        setTasksViewMode={setTasksViewMode}
        assignableResources={assignableResources}
        laneIds={laneIds}
        addLane={addLane}
        search={search}
        setSearch={setSearch}
        priorityFilter={priorityFilter}
        setPriorityFilter={setPriorityFilter}
        effectiveFilters={effectiveFilters}
        setAssigneeFilter={setAssigneeFilter}
        setGroupFilter={setGroupFilter}
        setLabelFilter={setLabelFilter}
        uniqueAssignees={uniqueAssignees}
        uniqueGroups={uniqueGroups}
        uniqueLabels={uniqueLabels}
        healthFilter={healthFilter}
        setHealthFilter={setHealthFilter}
        hiddenCols={hiddenCols}
        setHiddenCols={setHiddenCols}
        calendarControls={
          <CalendarSyncControls
            lang={lang}
            entityLabelKey="calendarSyncEntityTask"
            m365Configured={m365Configured}
            isPopout={isPopout}
            calendarEnabled={calendarTaskEnabled}
            onToggleCalendar={(enabled) => setSettings((s) => withCalendarEnabled(s, "task", enabled))}
            onPushCalendar={() => void pushTasksToOutlook()}
            calendarPushBusy={calPushBusy}
            onPullCalendar={() => void taskPull.pull()}
            calendarPullBusy={taskPull.busy}
          />
        }
        onClearAll={() => setClearConfirmOpen(true)}
        clearDisabled={tasks.length === 0}
        resetColWidths={resetColWidths}
        resetTableSize={resetTableSize}
      />

      {clearConfirmOpen && (
        <TypeToConfirmDialog
          lang={lang}
          title={t(lang, "tasksClearDialogTitle")}
          message={tPlural(lang, "tasksClearDialogMessage", tasks.length, tasks.length)}
          confirmValue={t(lang, "tasksClearAllConfirmValue")}
          confirmLabel={t(lang, "tasksClearConfirmLabel")}
          onConfirm={() => {
            handleClearAll();
            setClearConfirmOpen(false);
          }}
          onCancel={() => setClearConfirmOpen(false)}
        />
      )}

      {selectedIds.size > 0 && (
        <TasksSelectionBar
          lang={lang}
          selectedCount={selectedIds.size}
          handleBulkSendInquiry={handleBulkSendInquiry}
          bulkEditOpen={bulkEditOpen}
          onToggleBulkEdit={() => setBulkEditOpen((o) => !o)}
          onDeleteSelected={() => setDeleteSelectedConfirmOpen(true)}
          clearSelection={clearSelection}
        />
      )}

      {deleteSelectedConfirmOpen && (
        <TypeToConfirmDialog
          lang={lang}
          title={t(lang, "tasksDeleteSelectedDialogTitle")}
          message={tPlural(lang, "tasksDeleteSelectedDialogMessage", selectedIds.size, selectedIds.size)}
          confirmValue={t(lang, "tasksDeleteSelectedConfirmValue")}
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
          tokens={boardTokens}
          extraLaneIds={visibleExtraLaneIds}
          today={today}
          holidaySet={holidaySet}
          raidByTask={raidByTask}
          changeByTask={changeByTask}
          documentsByEntity={documentsByEntity}
          onOpenDocuments={onOpenDocuments}
          onJumpToChanges={onJumpToChanges}
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
          tokens={boardTokens}
          raidByTask={raidByTask}
          changeByTask={changeByTask}
          documentsByEntity={documentsByEntity}
          onOpenDocuments={onOpenDocuments}
          onJumpToChanges={onJumpToChanges}
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
            onAdd={openTaskEditor}
            text={t(lang, "noTasks")}
            addLabel={`+ ${t(lang, "addTaskButton")}…`}
            rounded="xl"
          />
        ) : (
        <RowContextProvider value={rowContextValue} tasksById={tasksById}>
          <TasksTable
            lang={lang}
            visibleCols={visibleCols}
            sizedWidths={sizedWidths}
            tableMinWidth={tableMinWidth}
            th={th}
            hiddenCols={hiddenCols}
            startColResize={startColResize}
            allVisibleSelected={allVisibleSelected}
            toggleSelectAllVisible={toggleSelectAllVisible}
            visibleRows={visibleRows}
            visibleColumnCount={visibleColumnCount}
            tableTokens={tableTokens}
            selectedIds={selectedIds}
            editingId={editingId}
            pushingIds={pushingIds}
            raidByTask={raidByTask}
            changeByTask={changeByTask}
            documentsByEntity={documentsByEntity}
            onOpenDocuments={onOpenDocuments}
            onJumpToChanges={onJumpToChanges}
            flashId={flashId}
            onAdd={openTaskEditor}
            rowWindow={rowWindow}
          />
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
