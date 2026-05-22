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
// jira-api is lazy-loaded via loadJiraApi() — pulls ~400 LOC out of the
// initial bundle for users who don't have Jira configured.
import type { ConflictItem } from "./jira-api";
import { type TranslationKey, t } from "./i18n";
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
import { DueBanner, DueDatesModal } from "./notifications";
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
import {
  DEFAULT_WEEK_HOURS,
  type Absence,
  type RaidItem,
  type Shift,
  type Task,
  type TaskDependency,
} from "./types";
import { buildRaidByTaskIndex, countByCategory, nextRaidId } from "./raid";
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
import { TasksSection } from "./tasks-section";
import { useResizable } from "./use-resizable";
import { WorkspaceTabProvider, useWorkspaceTab, type TopTab } from "./workspace-tab-context";
import { AppHeader } from "./app-header";
import { WorkspaceSection } from "./workspace-section";

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
  const { isPopout, activeTab } = useWorkspaceTab();
  const { setRaidFilterTaskId } = useFilters();
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
    if (!isPopout) return;
    document.title = `${t(lang, TAB_LABEL_KEYS[activeTab])} — ${t(lang, "appTitle")}`;
  }, [isPopout, activeTab, lang]);

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
    setWorkspaceCollapsed,
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
        <AppHeader
          handleCancelEdit={handleCancelEdit}
          setTaskModalOpen={setTaskModalOpen}
          bannerItems={bannerItems}
          setBannerDismissed={setBannerDismissed}
          setDueModalOpen={setDueModalOpen}
          showToast={showToast}
          handleCommand={handleCommand}
          storageDescription={storageDescription}
          storageReady={storageReady}
          onPickStorageFile={onPickStorageFile}
          onOpenStorageFile={onOpenStorageFile}
          onGrantStorageWrite={onGrantWriteAccess}
        />
      )}

      {!isPopout && !bannerDismissed && (
        <DueBanner
          items={bannerItems}
          lang={lang}
          onOpenList={() => setDueModalOpen(true)}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}

      <WorkspaceSection
        today={today}
        holidaySet={holidaySet}
        workspaceRef={workspaceRef}
        resetWorkspaceSize={resetWorkspaceSize}
        workspaceCollapsed={workspaceCollapsed}
        setWorkspaceCollapsed={setWorkspaceCollapsed}
        dispatcher={dispatcher}
        handleAcceptAiConsent={handleAcceptAiConsent}
        handleGanttBarUpdate={handleGanttBarUpdate}
        handleCancelEdit={handleCancelEdit}
        setTaskModalOpen={setTaskModalOpen}
        handleClearRaidTaskFilter={handleClearRaidTaskFilter}
        handleSaveRaidItem={handleSaveRaidItem}
        handleDeleteRaidItem={handleDeleteRaidItem}
        handleCreateMitigationTaskFromRaid={handleCreateMitigationTaskFromRaid}
        handleJumpToTaskFromRaid={handleJumpToTaskFromRaid}
        activityLog={activityLog}
        handleClearActivityLog={handleClearActivityLog}
        handleOpenAddAbsence={handleOpenAddAbsence}
        handleEditAbsence={handleEditAbsence}
        handleOpenShiftEditor={handleOpenShiftEditor}
      />

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
          <WorkspaceTabProvider>
            <TaskManagerInner />
          </WorkspaceTabProvider>
        </TaskFormProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}
