"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAlertableTasks } from "./due-dates";
import {
  computeTaskHealth,
  formatHealthTooltip,
  HEALTH_VALUES,
  healthColorName,
  healthDot,
  type Health,
  type TaskHealth,
} from "./health";
import { ExportMenu } from "./export-menu";
import { HelpMenu } from "./help-menu";
// jira-api is lazy-loaded via loadJiraApi() — pulls ~400 LOC out of the
// initial bundle for users who don't have Jira configured.
import type { ConflictItem } from "./jira-api";
import { type Lang, type TranslationKey, t } from "./i18n";
import { useChatDispatcher } from "./use-chat-dispatcher";
import { useActivityLog } from "./use-activity-log";
import { useDueAlerts } from "./use-due-alerts";
import { useToast } from "./use-toast";
import { useSettings } from "./use-settings";
import { useJiraSync } from "./use-jira-sync";
import { useStorageBackend } from "./use-storage-backend";
import { useResourcePlanner } from "./use-resource-planner";
import { useBulkOperations } from "./use-bulk-operations";
import { useColumnManager } from "./use-column-manager";
import { useContacts } from "./use-contacts";
import { useWorkspaceCollapsed } from "./use-workspace-collapsed";
import { useHolidaySet } from "./use-holiday-set";
import { useTaskRowHandlers } from "./use-task-row-handlers";
import { useTaskSubmit } from "./use-task-submit";
import { useGanttHandlers } from "./use-gantt-handlers";
import { VersionMenu } from "./version-menu";
import { DueBanner, DueDatesModal } from "./notifications";
// Heavy tab panels are dynamic-imported so each panel's code (and its
// transitive deps like chat-tools / markdown / resource-calendar) only
// loads when the user first opens that tab. ssr:false because every
// panel uses browser-only APIs (window, IndexedDB handles, etc.) and
// can't be prerendered.
const ChatPanel = dynamic(
  () => import("./chat-panel").then((m) => m.ChatPanel),
  { ssr: false },
);
const GanttPanel = dynamic(
  () => import("./gantt").then((m) => m.GanttPanel),
  { ssr: false },
);
const ReportsPanel = dynamic(
  () => import("./reports").then((m) => m.ReportsPanel),
  { ssr: false },
);
const RaidPanel = dynamic(
  () => import("./raid-panel").then((m) => m.RaidPanel),
  { ssr: false },
);
const ResourcesPanel = dynamic(
  () => import("./resources-panel").then((m) => m.ResourcesPanel),
  { ssr: false },
);
const ActivityLogPanel = dynamic(
  () => import("./activity-log-panel").then((m) => m.ActivityLogPanel),
  { ssr: false },
);
// Modals are dynamic-imported on the same principle — JiraConflictsModal
// only opens during a Jira-sync conflict; absence/shift editors only open
// when the user clicks an edit/add affordance. Helpers
// (emptyAbsenceDraft / emptyShiftDraft) are inlined below so opening
// these modals doesn't need to await the module load.
const JiraConflictsModal = dynamic(
  () => import("./jira-conflicts-modal").then((m) => m.JiraConflictsModal),
  { ssr: false },
);
const AbsenceEditModal = dynamic(
  () => import("./absence-edit-modal").then((m) => m.AbsenceEditModal),
  { ssr: false },
);
const ShiftEditModal = dynamic(
  () => import("./shift-edit-modal").then((m) => m.ShiftEditModal),
  { ssr: false },
);
import { greetingName } from "./contacts";
import {
  type Settings,
  SettingsMenu,
} from "./settings-menu";
import {
  DEFAULT_WEEK_HOURS,
  type Absence,
  type RaidItem,
  type Shift,
  type Task,
  type TaskDependency,
} from "./types";
import { buildRaidByTaskIndex, countByCategory, nextRaidId } from "./raid";
import {
  openPopoutWindow,
  type PopoutTab,
  readPopoutTabFromUrl,
} from "./broadcast-sync";
import { FiltersProvider, useFilters } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import {
  TaskFormProvider,
  emptyBulkEdit,
  emptyForm,
  useTaskForm,
} from "./task-form-context";
import { TaskFormModal } from "./task-form-modal";
import { type RowContextValue } from "./task-row";
import { TabButton, ResetSizeIcon } from "./task-manager-ui";
import { TasksSection } from "./tasks-section";
import { useResizable } from "./use-resizable";
// voice-button is lazy-loaded — it transitively pulls the Web Speech API
// shims in voice.ts which we only need when the user clicks the mic.
const VoiceCommandButton = dynamic(
  () => import("./voice-button").then((m) => m.VoiceCommandButton),
  { ssr: false },
);
import type { Command } from "./voice";

// --- inlined absence / shift draft helpers ------------------------------
//
// Originally re-exported from absence-edit-modal.tsx / shift-edit-modal.tsx
// alongside the components. Inlined here so opening a draft doesn't need
// to await the modal module — the parent computes the seed synchronously
// and the dynamic-imported modal hydrates around it.

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyAbsenceDraft(id: number): Absence {
  const today = isoToday();
  return {
    id,
    assignee: "",
    assigneeEmail: undefined,
    startDate: today,
    endDate: today,
    type: "vacation",
    note: undefined,
  };
}

function emptyShiftDraft(id: number): Shift {
  return {
    id,
    assignee: "",
    assigneeEmail: undefined,
    hoursPerWeekday: DEFAULT_WEEK_HOURS,
    note: undefined,
  };
}

export type TopTab = "chat" | "reports" | "gantt" | "raid" | "resources" | "activity";

// i18n key for each tab's label — used by both the tab strip and the
// popout window's document.title. Adding a new tab requires a row here.
const TAB_LABEL_KEYS: Record<TopTab, TranslationKey> = {
  chat: "tabChat",
  reports: "tabReports",
  gantt: "tabGantt",
  raid: "tabRaid",
  resources: "tabResources",
  activity: "tabActivity",
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// TaskManagerInner consumes the FiltersProvider context. The default
// export below wraps this in <FiltersProvider> so useFilters() works.
function TaskManagerInner() {
  const { settings, setSettings, hydrated, i18nReady, lang } = useSettings();
  const { activityLog, setActivityLog, logActivity, handleClearActivityLog } =
    useActivityLog({ lang });
  const { toast, showToast } = useToast();

  const { workspaceCollapsed, setWorkspaceCollapsed } = useWorkspaceCollapsed();
  const {
    colWidths,
    setColWidths,
    hiddenCols,
    setHiddenCols,
    colConfigOpen,
    setColConfigOpen,
    colConfigRef,
    resetColWidths,
    startColResize,
  } = useColumnManager();
  // Popout mode: when the URL carries `?popout=<tab>`, the window suppresses
  // the page header / banner / task table / footer and renders only the
  // requested workspace panel. The popout window is opened by the per-tab
  // popout icon (see TabButton). State stays in sync with the opening window
  // via BroadcastChannel — see useStorageBackend.
  const [popoutTab] = useState<PopoutTab | null>(() => readPopoutTabFromUrl());
  const isPopout = popoutTab !== null;
  const [activeTab, setActiveTab] = useState<TopTab>(popoutTab ?? "chat");
  // raidFilterTaskId / setRaidFilterTaskId remain in TaskManagerInner because
  // the RAID tab button (in the workspace section) calls setRaidFilterTaskId(null)
  // on click, and RaidPanel receives filterTaskId as a prop.
  const { raidFilterTaskId, setRaidFilterTaskId } = useFilters();
  // Tasks data + derivations owned by WorkspaceProvider (Slice 2 of the
  // task-manager decomposition; see
  // docs/superpowers/specs/2026-05-18-workspace-context-slice2-design.md).
  // The default export wraps this component in <WorkspaceProvider> inside
  // <FiltersProvider>.
  const {
    tasks,
    setTasks,
    uniqueGroups,
    uniqueLabels,
    tasksById,
    taskSearchIndex,
    raid,
    setRaid,
    absences,
    setAbsences,
    shifts,
    setShifts,
  } = useWorkspace();

  const { contacts, setContacts, contactsList, handleRemoveContact } =
    useContacts({ hydrated, tasks });

  // Form / modal state owned by TaskFormProvider (Slice 3 of the
  // task-manager decomposition; see
  // docs/superpowers/specs/2026-05-18-task-form-context-slice3-design.md).
  // The default export wraps this component in <TaskFormProvider> inside
  // <WorkspaceProvider>.
  const {
    form,
    setForm,
    editingId,
    setEditingId,
    taskModalOpen,
    setTaskModalOpen,
  } = useTaskForm();

  // Populated after useBulkOperations is called below; onDelete calls through
  // this ref so it doesn't depend on deselectId being defined first.
  const deselectIdRef = useRef<(id: number) => void>(() => {});


  // Resizable surfaces. See `use-resizable.ts` — each has its own
  // localStorage key, only deliberate corner-drag gestures are persisted.
  const { ref: tableRef, reset: resetTableSize } = useResizable(
    "lop-app:task-table-size",
  );
  const { ref: workspaceRef, reset: resetWorkspaceSize } = useResizable(
    "lop-app:workspace-size",
  );
  const { ref: modalRef } = useResizable("lop-app:task-modal-size");

  const today = todayISO();


  // Set the browser tab title in popout mode. The main-window title is
  // managed by `next/metadata` via layout.tsx; this only fires when
  // `?popout=<tab>` is present, so it never overwrites the main title.
  useEffect(() => {
    if (!isPopout || !popoutTab) return;
    document.title = `${t(lang, TAB_LABEL_KEYS[popoutTab])} — ${t(lang, "appTitle")}`;
  }, [isPopout, popoutTab, lang]);

  const { holidaySet } = useHolidaySet({
    holidayCountries: settings.holidayCountries,
  });

  const { bannerDismissed, setBannerDismissed, dueModalOpen, setDueModalOpen } =
    useDueAlerts({ hydrated, tasks, holidaySet, settings, today, showToast });

  // --- RAID CRUD handlers ---------------------------------------------
  //
  // The RAID panel owns its own form state and edit modal; these are pure
  // mutators that update the top-level `raid` array, which round-trips to
  // storage via the existing save effect.

  const { jiraSyncing, jiraConflicts, handleJiraSync, handleResolveConflicts, clearConflicts } = useJiraSync({
    settings,
    today,
    lang,
    showToast,
    logActivity,
  });

  const { storageDescription, storageReady, onPickStorageFile, onGrantWriteAccess, onOpenStorageFile } =
    useStorageBackend({ settings, lang, hydrated, activityLog, setActivityLog, showToast });

  // Reverse-lookup index for the "referenced by N RAID items" badge on
  // each task row. Map<taskId, RaidItem[]>. O(R) on every raid update,
  // then O(1) per row. Empty when `raid` is empty — the per-row check
  // bails out fast.
  const raidByTask = useMemo(() => buildRaidByTaskIndex(raid), [raid]);

  const nextId = tasks.length > 0 ? Math.max(...tasks.map((row) => row.id)) + 1 : 1;

  const {
    editingAbsence,
    editingShift,
    handleSaveRaidItem,
    handleDeleteRaidItem,
    handleOpenAddAbsence,
    handleEditAbsence,
    handleCloseAbsenceModal,
    handleSaveAbsence,
    handleDeleteAbsence,
    handleOpenShiftEditor,
    handleCloseShiftModal,
    handleSaveShift,
    handleDeleteShift,
    handleCreateMitigationTaskFromRaid,
  } = useResourcePlanner({ lang, logActivity, showToast });

  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const onPushToJiraRef = useRef<(taskId: number) => Promise<boolean>>(
    () => Promise.resolve(false),
  );
  const { error, handleSubmit, handleCancelEdit, openEditModal } = useTaskSubmit({
    form,
    setForm,
    editingId,
    setEditingId,
    setTaskModalOpen,
    tasks,
    today,
    lang,
    settings,
    tasksRef,
    setTasks,
    setContacts,
    logActivity,
    showToast,
    onPushToJiraRef,
  });

  const {
    expandedNotes,
    pushingIds,
    onToggleNoteExpanded,
    onJumpToRaid,
    onToggleComplete,
    onSendInquiry,
    onPushToJira,
    onEdit,
    onDelete,
    handleClearRaidTaskFilter,
    handleJumpToTaskFromRaid,
  } = useTaskRowHandlers({
    tasksRef,
    settings,
    lang,
    today,
    editingId,
    showToast,
    openEditModal,
    setTasks,
    setRaidFilterTaskId,
    deselectIdRef,
    handleCancelEdit,
    logActivity,
  });
  onPushToJiraRef.current = onPushToJira;

  const {
    selectedIds,
    setSelectedIds,
    allVisibleSelected,
    selectedJiraCount,
    onToggleSelect,
    toggleSelectAllVisible,
    clearSelection,
    deselectId,
    cancelBulkEdit,
    applyBulkEdit,
    handleBulkSendInquiry,
    handleClearAll,
    handleCommand,
  } = useBulkOperations({
    lang,
    settings,
    setSettings,
    handlers: { onEdit, onDelete, onSendInquiry },
    onCancelEdit: handleCancelEdit,
    logActivity,
    showToast,
  });
  // Sync deselectIdRef so onDelete (defined above) can call it without
  // depending on useBulkOperations being declared first.
  deselectIdRef.current = deselectId;
  const { handleGanttBarUpdate } = useGanttHandlers({ tasksRef, setTasks, today });

  const bannerItems = useMemo(() => {
    const cfg = settings.notifications.banner;
    if (!cfg.enabled) return [];
    return getAlertableTasks(tasks, cfg.thresholdWorkDays, today, holidaySet);
  }, [tasks, settings.notifications.banner, today, holidaySet]);

  const dueModalItems = useMemo(() => {
    const cfg = settings.notifications.popup;
    return getAlertableTasks(tasks, cfg.thresholdWorkDays, today, holidaySet);
  }, [tasks, settings.notifications.popup, today, holidaySet]);


  const dispatcher = useChatDispatcher({
    settings,
    today,
    setSelectedIds,
    setSettings,
  });

  const handleAcceptAiConsent = useCallback(() => {
    setSettings((s) => ({ ...s, ai: { ...s.ai, consentAccepted: true } }));
  }, []);

  const isEditing = editingId !== null;
  const editingTask =
    editingId !== null
      ? tasks.find((row) => row.id === editingId) ?? null
      : null;
  const editingIsJiraLinked = !!editingTask?.jiraKey;

  const rowContextValue = useMemo<RowContextValue>(
    () => ({
      lang,
      today,
      holidaySet,
      jiraSiteUrl: settings.jira.siteUrl,
      jiraEnabled: settings.jira.enabled,
      jiraProjectKey: settings.jira.projectKey,
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
      settings.jira.siteUrl,
      settings.jira.enabled,
      settings.jira.projectKey,
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

  // Render gate: hold first paint until the active-language dictionary is
  // in memory. Lifts in the next microtask for en-US/en-GB (no fetch);
  // briefly delays initial paint for de while ./i18n.de loads. Must come
  // AFTER every hook so the rules-of-hooks invariant holds.
  if (!i18nReady) return null;

  return (
    <div
      className={
        isPopout
          ? "flex flex-1 flex-col p-4"
          : "mx-auto w-full max-w-6xl p-6 sm:p-10"
      }
    >
      {!isPopout && (
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-AIPM-dark-blue dark:text-AIPM-light-grey">
            {t(lang, "appTitle")}
          </h1>
          <p className="mt-1 text-sm text-AIPM-dark-grey dark:text-AIPM-medium-grey">
            {t(lang, "appSubtitle")}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/AIPM-logo.svg"
            alt="Acme"
            className="h-7 w-auto"
          />
          <div className="flex items-center gap-1">
            <VoiceCommandButton
              lang={lang}
              onCommand={handleCommand}
              onError={(msg) => showToast("error", msg)}
            />
            <button
              type="button"
              onClick={() => {
                // Open a fresh new-task modal. If the user was in the middle
                // of editing, cancel that first so the form starts empty.
                handleCancelEdit();
                setTaskModalOpen(true);
              }}
              aria-label={t(lang, "addTaskButton")}
              title={t(lang, "addTaskButton")}
              className="rounded-md p-2 text-AIPM-dark-grey hover:bg-AIPM-light-grey hover:text-AIPM-dark-blue focus:outline-none focus:ring-2 focus:ring-AIPM-dark-blue dark:text-AIPM-medium-grey dark:hover:bg-zinc-800 dark:hover:text-AIPM-light-grey"
            >
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
                className="h-5 w-5"
              >
                <path
                  fillRule="evenodd"
                  d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => {
                setBannerDismissed(false);
                setDueModalOpen(true);
              }}
              aria-label={t(lang, "showDueAlerts")}
              title={t(lang, "showDueAlerts")}
              className="relative rounded-md p-2 text-AIPM-dark-grey hover:bg-AIPM-light-grey hover:text-AIPM-dark-blue focus:outline-none focus:ring-2 focus:ring-AIPM-dark-blue dark:text-AIPM-medium-grey dark:hover:bg-zinc-800 dark:hover:text-AIPM-light-grey"
            >
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
                className="h-5 w-5"
              >
                <path d="M10 2a6 6 0 00-6 6v2.586l-.707.707A1 1 0 004 13h12a1 1 0 00.707-1.707L16 10.586V8a6 6 0 00-6-6zM8 15a2 2 0 104 0H8z" />
              </svg>
              {bannerItems.length > 0 && (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-AIPM-pink px-1 text-[10px] font-semibold leading-none text-white"
                >
                  {bannerItems.length}
                </span>
              )}
            </button>
            <ExportMenu lang={lang} tasks={tasks} raid={raid} absences={absences} shifts={shifts} />
            <HelpMenu lang={lang} />
            <VersionMenu lang={lang} />
            <SettingsMenu
              settings={settings}
              onChange={setSettings}
              storageDescription={storageDescription}
              storageReady={storageReady}
              onPickStorageFile={onPickStorageFile}
              onOpenStorageFile={onOpenStorageFile}
              onGrantStorageWrite={onGrantWriteAccess}
            />
          </div>
        </div>
      </header>
      )}

      {!isPopout && !bannerDismissed && (
        <DueBanner
          items={bannerItems}
          lang={lang}
          onOpenList={() => setDueModalOpen(true)}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}

      {/*
        Resizable + collapsible workspace section. Only Chat and Reports
        live here — the New-task / Edit-task form moved out into a
        header-triggered modal.

        Resize state is persisted at "lop-app:workspace-size"; collapsed
        state at "lop-app:workspace-collapsed". When collapsed, the section
        drops resize/overflow and shrinks to just the tab strip — the
        chevron button on the right toggles back.

        `overflow-hidden` on the expanded section is required for CSS
        `resize` to take effect on a flex container; the individual panels
        still scroll internally via their own overflow rules. Min dimensions
        are sized so chat (input row + a few bubbles) and reports (4-tile
        row + first section header) render fully without internal
        scrollbars on first load.
      */}
      <section
        ref={workspaceRef}
        title={
          isPopout || workspaceCollapsed
            ? undefined
            : t(lang, "workspaceResizeHint")
        }
        className={
          isPopout
            ? "flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
            : workspaceCollapsed
            ? "mb-10 flex w-full flex-col rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
            : "mb-10 flex h-[560px] min-h-[420px] w-full min-w-[520px] resize flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
        }
      >
        {!isPopout && (
        <div
          role="tablist"
          aria-label="Workspace tabs"
          className={
            workspaceCollapsed
              ? "-mx-2 -mt-2 flex shrink-0 items-end gap-1 px-2"
              : "-mx-2 -mt-2 flex shrink-0 items-end gap-1 border-b border-zinc-200 px-2 dark:border-zinc-800"
          }
        >
          <TabButton
            active={activeTab === "chat"}
            onClick={() => {
              setActiveTab("chat");
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-chat"
            onPopout={() => openPopoutWindow("chat")}
            popoutLabel={t(lang, "popoutOpenInNewWindow")}
          >
            {t(lang, "tabChat")}
          </TabButton>
          <TabButton
            active={activeTab === "reports"}
            onClick={() => {
              setActiveTab("reports");
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-reports"
            onPopout={() => openPopoutWindow("reports")}
            popoutLabel={t(lang, "popoutOpenInNewWindow")}
          >
            {t(lang, "tabReports")}
          </TabButton>
          <TabButton
            active={activeTab === "gantt"}
            onClick={() => {
              setActiveTab("gantt");
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-gantt"
            onPopout={() => openPopoutWindow("gantt")}
            popoutLabel={t(lang, "popoutOpenInNewWindow")}
          >
            {t(lang, "tabGantt")}
          </TabButton>
          <TabButton
            active={activeTab === "raid"}
            onClick={() => {
              setActiveTab("raid");
              setRaidFilterTaskId(null);
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-raid"
            onPopout={() => openPopoutWindow("raid")}
            popoutLabel={t(lang, "popoutOpenInNewWindow")}
          >
            {t(lang, "tabRaid")}
          </TabButton>
          <TabButton
            active={activeTab === "resources"}
            onClick={() => {
              setActiveTab("resources");
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-resources"
            onPopout={() => openPopoutWindow("resources")}
            popoutLabel={t(lang, "popoutOpenInNewWindow")}
          >
            {t(lang, "tabResources")}
          </TabButton>
          <TabButton
            active={activeTab === "activity"}
            onClick={() => {
              setActiveTab("activity");
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-activity"
            onPopout={() => openPopoutWindow("activity")}
            popoutLabel={t(lang, "popoutOpenInNewWindow")}
          >
            {t(lang, "tabActivity")}
          </TabButton>
          {!workspaceCollapsed && (
            <button
              type="button"
              onClick={resetWorkspaceSize}
              aria-label={t(lang, "tableResetSizeHint")}
              title={t(lang, "tableResetSizeHint")}
              className="ml-auto mb-1 rounded-md border border-zinc-300 bg-white p-1.5 text-zinc-500 shadow-sm hover:bg-zinc-50 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <ResetSizeIcon />
            </button>
          )}
          <button
            type="button"
            onClick={() => setWorkspaceCollapsed((v) => !v)}
            aria-expanded={!workspaceCollapsed}
            aria-controls="workspace-panels"
            title={
              workspaceCollapsed
                ? t(lang, "workspaceExpand")
                : t(lang, "workspaceCollapse")
            }
            className={
              workspaceCollapsed
                ? "ml-auto mb-1 rounded-md p-1.5 text-AIPM-dark-grey hover:bg-AIPM-light-grey hover:text-AIPM-dark-blue dark:text-AIPM-medium-grey dark:hover:bg-zinc-800 dark:hover:text-AIPM-light-grey"
                : "mb-1 rounded-md p-1.5 text-AIPM-dark-grey hover:bg-AIPM-light-grey hover:text-AIPM-dark-blue dark:text-AIPM-medium-grey dark:hover:bg-zinc-800 dark:hover:text-AIPM-light-grey"
            }
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
              className={`h-4 w-4 transition-transform ${workspaceCollapsed ? "rotate-180" : ""}`}
            >
              {/* Chevron up — flipped to chevron down via rotate-180 when collapsed. */}
              <path
                fillRule="evenodd"
                d="M14.78 12.78a.75.75 0 01-1.06 0L10 9.06l-3.72 3.72a.75.75 0 11-1.06-1.06l4.25-4.25a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
        )}

        <div
          id="workspace-panels"
          hidden={!isPopout && workspaceCollapsed}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div
            id="panel-chat"
            role="tabpanel"
            hidden={activeTab !== "chat"}
            className="min-h-0 flex-1 pt-4"
          >
            <ChatPanel
              lang={lang}
              ai={settings.ai}
              dispatcher={dispatcher}
              onAcceptConsent={handleAcceptAiConsent}
            />
          </div>

          {activeTab === "reports" && (
            <div
              id="panel-reports"
              role="tabpanel"
              className="min-h-0 flex-1 overflow-y-auto pt-4"
            >
              <ReportsPanel
                tasks={tasks}
                today={today}
                holidaySet={holidaySet}
                lang={lang}
              />
            </div>
          )}

          {activeTab === "gantt" && (
            <div
              id="panel-gantt"
              role="tabpanel"
              className="min-h-0 flex-1 pt-4"
            >
              <GanttPanel
                lang={lang}
                tasks={tasks}
                absences={absences}
                onUpdateBar={handleGanttBarUpdate}
                onAddTask={() => {
                  handleCancelEdit();
                  setTaskModalOpen(true);
                }}
              />
            </div>
          )}

          <div
            id="panel-raid"
            role="tabpanel"
            hidden={activeTab !== "raid"}
            className="min-h-0 flex-1 pt-4"
          >
            <RaidPanel
              lang={lang}
              tasks={tasks}
              raid={raid}
              today={today}
              filterTaskId={raidFilterTaskId}
              onClearTaskFilter={handleClearRaidTaskFilter}
              onSave={handleSaveRaidItem}
              onDelete={handleDeleteRaidItem}
              onCreateMitigationTask={handleCreateMitigationTaskFromRaid}
              onJumpToTask={handleJumpToTaskFromRaid}
            />
          </div>

          {activeTab === "resources" && (
            <div
              id="panel-resources"
              role="tabpanel"
              className="min-h-0 flex-1 pt-4"
            >
              <ResourcesPanel
                lang={lang}
                tasks={tasks}
                absences={absences}
                shifts={shifts}
                today={today}
                holidaySet={holidaySet}
                onAddAbsence={handleOpenAddAbsence}
                onEditAbsence={handleEditAbsence}
                onEditShift={handleOpenShiftEditor}
              />
            </div>
          )}

          {activeTab === "activity" && (
            <div
              id="panel-activity"
              role="tabpanel"
              className="min-h-0 flex-1 pt-4"
            >
              <ActivityLogPanel
                lang={lang}
                entries={activityLog}
                onClear={handleClearActivityLog}
              />
            </div>
          )}
        </div>
      </section>

      {/*
        New-task / Edit-task modal. Opened by the header "+" button or by
        editing a row. Backdrop click + Esc cancel and close. Submit closes
        on success. Dialog role + a11y owned by <Modal>; the inner div is
        just the resizable panel surface (the `modalRef` carries the saved
        size via useResizable).
      */}
      <TaskFormModal
        lang={lang}
        today={today}
        nextId={nextId}
        contactsList={contactsList}
        absences={absences}
        tasksForDeps={tasks}
        uniqueGroups={uniqueGroups}
        uniqueLabels={uniqueLabels}
        editingIsJiraLinked={editingIsJiraLinked}
        jiraEnabled={settings.jira.enabled}
        error={error}
        holidaySet={holidaySet}
        jiraProjectKey={settings.jira.projectKey}
        jiraDefaultIssueType={settings.jira.issueTypes[0]}
        modalRef={modalRef}
        onSubmit={handleSubmit}
        onCancel={handleCancelEdit}
        onRemoveContact={handleRemoveContact}
        onShowToast={showToast}
      />

      {!isPopout && (
        <TasksSection
          lang={lang}
          today={today}
          rowContextValue={rowContextValue}
          hiddenCols={hiddenCols}
          setHiddenCols={setHiddenCols}
          colWidths={colWidths}
          colConfigOpen={colConfigOpen}
          setColConfigOpen={setColConfigOpen}
          colConfigRef={colConfigRef}
          startColResize={startColResize}
          resetColWidths={resetColWidths}
          tableRef={tableRef}
          resetTableSize={resetTableSize}
          expandedNotes={expandedNotes}
          pushingIds={pushingIds}
          raidByTask={raidByTask}
          jiraEnabled={settings.jira.enabled}
          jiraSyncing={jiraSyncing}
          jiraProjectKey={settings.jira.projectKey}
          handleJiraSync={handleJiraSync}
          handleCancelEdit={handleCancelEdit}
          setTaskModalOpen={setTaskModalOpen}
          handleClearAll={handleClearAll}
          selectedIds={selectedIds}
          allVisibleSelected={allVisibleSelected}
          selectedJiraCount={selectedJiraCount}
          toggleSelectAllVisible={toggleSelectAllVisible}
          clearSelection={clearSelection}
          handleBulkSendInquiry={handleBulkSendInquiry}
          applyBulkEdit={applyBulkEdit}
          cancelBulkEdit={cancelBulkEdit}
        />
      )}

      {dueModalOpen && (
        <DueDatesModal
          items={dueModalItems}
          lang={lang}
          onClose={() => setDueModalOpen(false)}
          onSelectTask={(taskId) => {
            const task = tasks.find((row) => row.id === taskId);
            if (task) {
              setDueModalOpen(false);
              openEditModal(task);
            }
          }}
        />
      )}

      {jiraConflicts.length > 0 && (
        <JiraConflictsModal
          lang={lang}
          conflicts={jiraConflicts}
          onResolve={handleResolveConflicts}
          onClose={clearConflicts}
        />
      )}

      {editingAbsence && (
        <AbsenceEditModal
          lang={lang}
          absence={editingAbsence.absence}
          isNew={editingAbsence.isNew}
          knownAssignees={[
            ...tasks.map((tk) => ({
              name: tk.assignee,
              email: tk.assigneeEmail,
            })),
            ...absences.map((a) => ({
              name: a.assignee,
              email: a.assigneeEmail,
            })),
          ]}
          onSave={handleSaveAbsence}
          onDelete={handleDeleteAbsence}
          onClose={handleCloseAbsenceModal}
        />
      )}

      {editingShift && (
        <ShiftEditModal
          lang={lang}
          shift={editingShift.shift}
          isNew={editingShift.isNew}
          existingAssigneeKeys={
            new Set(
              shifts
                .filter((s) => s.id !== editingShift.shift.id)
                .map((s) => s.assignee.trim().toLowerCase()),
            )
          }
          knownAssignees={[
            ...tasks.map((tk) => ({
              name: tk.assignee,
              email: tk.assigneeEmail,
            })),
            ...absences.map((a) => ({
              name: a.assignee,
              email: a.assigneeEmail,
            })),
            ...shifts.map((s) => ({
              name: s.assignee,
              email: s.assigneeEmail,
            })),
          ]}
          onSave={handleSaveShift}
          onDelete={handleDeleteShift}
          onClose={handleCloseShiftModal}
        />
      )}

      {!isPopout && (
      <footer className="mt-12 flex items-center justify-between gap-4 border-t border-AIPM-light-grey pt-6 text-xs text-AIPM-medium-grey dark:border-zinc-800">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/AIPM-logo.svg" alt="Acme" className="h-6 w-auto" />
        <span className="text-right italic">
          Identity Excellence Delivered. Globally.
        </span>
      </footer>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-4 right-4 z-30 max-w-md rounded-md px-4 py-2.5 text-sm shadow-lg ${
            toast.kind === "error"
              ? "bg-AIPM-pink text-white"
              : "bg-AIPM-dark-blue text-white"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

export default function TaskManager() {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <TaskFormProvider>
          <TaskManagerInner />
        </TaskFormProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}



