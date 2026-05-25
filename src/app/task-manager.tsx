"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAlertableTasks } from "./due-dates";
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
import { AppModals } from "./app-modals";
import {
  type Absence,
  type RaidItem,
  type Resource,
  type Shift,
  type Task,
} from "./types";
import { splitName, resourceDisplayName } from "./resource-foundation";
import { buildRaidByTaskIndex } from "./raid";
import { FiltersProvider, useFilters } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import {
  TaskFormProvider,
  useTaskForm,
} from "./task-form-context";
import { TasksSection } from "./tasks-section";
import { useResizable } from "./use-resizable";
import { WorkspaceTabProvider, useWorkspaceTab, type TopTab } from "./workspace-tab-context";
import { AppHeader } from "./app-header";
import { BirthdayBanner, DueBanner } from "./notifications";
import { WorkspaceSection } from "./workspace-section";
import { getUpcomingBirthdays } from "./birthdays";
import { useBirthdayAlerts } from "./use-birthday-alerts";

// i18n key for each tab's label — used by both the tab strip and the
// popout window's document.title. Adding a new tab requires a row here.
const TAB_LABEL_KEYS: Record<TopTab, TranslationKey> = {
  chat: "tabChat",
  reports: "tabReports",
  gantt: "tabGantt",
  raid: "tabRaid",
  resources: "tabResources",
  activity: "tabActivity",
  "resource-report": "resourcesReportTitle",
  "address-book": "resourcesAddressBookTitle",
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
    resources,
    roles,
    disciplines,
    grades,
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

  const { birthdayDismissed, setBirthdayDismissed } = useBirthdayAlerts({
    hydrated, resources, today, settings, showToast,
  });

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
    useStorageBackend({ settings, lang, hydrated, isPopout, activityLog, setActivityLog, showToast });

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
    rolesModalOpen,
    handleOpenRolesModal,
    handleCloseRolesModal,
    handleSaveRole,
    handleDeleteRole,
    resolveOrCreateRole,
    handleAssignResourceRole,
    handleAddDiscipline,
    handleRenameDiscipline,
    handleAddGrade,
    handleRenameGrade,
    handleSetUtilization,
    handleSetUtilizationMode,
    handleSetAbsenceOverride,
    handleSetPlanWindow,
    handleSetPlanGranularity,
    editingResource,
    handleOpenAddResource,
    handleEditResource,
    handleSaveResource,
    handleDeleteResource,
    handleCloseResourceModal,
  } = useResourcePlanner({ lang, logActivity, showToast });

  const [fillTaskAssigneeOnSave, setFillTaskAssigneeOnSave] = useState(false);

  const handleAddAssigneeToAddressBook = useCallback((name: string, email: string) => {
    const { firstName, lastName } = splitName(name);
    setFillTaskAssigneeOnSave(true);
    handleOpenAddResource({ firstName, lastName, email: email.trim() || undefined });
  }, [handleOpenAddResource]);

  const handleSaveResourceFromAnywhere = useCallback((next: Resource) => {
    handleSaveResource(next);
    if (fillTaskAssigneeOnSave) {
      setForm((prev) => ({ ...prev, assignee: resourceDisplayName(next), assigneeEmail: next.email ?? "" }));
      setFillTaskAssigneeOnSave(false);
    }
  }, [handleSaveResource, fillTaskAssigneeOnSave, setForm]);

  const handleCloseResourceFromAnywhere = useCallback(() => {
    handleCloseResourceModal();
    setFillTaskAssigneeOnSave(false);
  }, [handleCloseResourceModal]);

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

  const birthdayItems = useMemo(
    () => settings.notifications.birthday.enabled
      ? getUpcomingBirthdays(resources, today, settings.notifications.birthday.leadDays)
      : [],
    [resources, settings.notifications.birthday, today],
  );

  const dueModalItems = useMemo(() => {
    const cfg = settings.notifications.popup;
    return getAlertableTasks(tasks, cfg.thresholdWorkDays, today, holidaySet);
  }, [tasks, settings.notifications.popup, today, holidaySet]);

  const absenceKnownAssignees = useMemo(
    () => [
      ...tasks.map((tk) => ({ name: tk.assignee, email: tk.assigneeEmail })),
      ...absences.map((a) => ({ name: a.assignee, email: a.assigneeEmail })),
    ],
    [tasks, absences],
  );

  const shiftKnownAssignees = useMemo(
    () => [
      ...tasks.map((tk) => ({ name: tk.assignee, email: tk.assigneeEmail })),
      ...absences.map((a) => ({ name: a.assignee, email: a.assigneeEmail })),
      ...shifts.map((s) => ({ name: s.assignee, email: s.assigneeEmail })),
    ],
    [tasks, absences, shifts],
  );

  const shiftExistingAssigneeKeys = useMemo(
    () =>
      new Set(
        shifts
          .filter((s) => editingShift === null || s.id !== editingShift.shift.id)
          .map((s) => s.assignee.trim().toLowerCase()),
      ),
    [shifts, editingShift],
  );

  const onSelectDueTask = useCallback(
    (taskId: number) => {
      const task = tasks.find((row) => row.id === taskId);
      if (task) {
        setDueModalOpen(false);
        openEditModal(task);
      }
    },
    [tasks, setDueModalOpen, openEditModal],
  );

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

      {!isPopout && !birthdayDismissed && birthdayItems.length > 0 && (
        <BirthdayBanner items={birthdayItems} lang={lang} onDismiss={() => setBirthdayDismissed(true)} />
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
        onManageRoles={handleOpenRolesModal}
        onAssignRole={handleAssignResourceRole}
        onSetUtilization={handleSetUtilization}
        onSetUtilizationMode={handleSetUtilizationMode}
        onSetAbsenceOverride={handleSetAbsenceOverride}
        onSetPlanWindow={handleSetPlanWindow}
        onSetPlanGranularity={handleSetPlanGranularity}
        onEditResource={handleEditResource}
        onAddResource={handleOpenAddResource}
      />

      {!isPopout && (
        <TasksSection
          lang={lang}
          today={today}
          jiraSiteUrl={settings.jira.siteUrl}
          onToggleSelect={onToggleSelect}
          onToggleNoteExpanded={onToggleNoteExpanded}
          onJumpToRaid={onJumpToRaid}
          onToggleComplete={onToggleComplete}
          onSendInquiry={onSendInquiry}
          onPushToJira={onPushToJira}
          onEdit={onEdit}
          onDelete={onDelete}
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

      <AppModals
        lang={lang}
        isPopout={isPopout}
        dueModalOpen={dueModalOpen}
        dueModalItems={dueModalItems}
        onSelectDueTask={onSelectDueTask}
        onCloseDueModal={() => setDueModalOpen(false)}
        jiraConflicts={jiraConflicts}
        handleResolveConflicts={handleResolveConflicts}
        clearConflicts={clearConflicts}
        editingAbsence={editingAbsence}
        absenceKnownAssignees={absenceKnownAssignees}
        handleSaveAbsence={handleSaveAbsence}
        handleDeleteAbsence={handleDeleteAbsence}
        handleCloseAbsenceModal={handleCloseAbsenceModal}
        editingShift={editingShift}
        shiftKnownAssignees={shiftKnownAssignees}
        shiftExistingAssigneeKeys={shiftExistingAssigneeKeys}
        handleSaveShift={handleSaveShift}
        handleDeleteShift={handleDeleteShift}
        handleCloseShiftModal={handleCloseShiftModal}
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
        handleSubmit={handleSubmit}
        handleCancelEdit={handleCancelEdit}
        handleRemoveContact={handleRemoveContact}
        showToast={showToast}
        onAddAssigneeToAddressBook={handleAddAssigneeToAddressBook}
        editingResource={editingResource}
        onSaveResource={handleSaveResourceFromAnywhere}
        onDeleteResource={handleDeleteResource}
        onCloseResourceModal={handleCloseResourceFromAnywhere}
        rolesModalOpen={rolesModalOpen}
        roles={roles}
        disciplines={disciplines}
        grades={grades}
        onSaveRole={handleSaveRole}
        onDeleteRole={handleDeleteRole}
        onResolveOrCreateRole={resolveOrCreateRole}
        onAddDiscipline={handleAddDiscipline}
        onRenameDiscipline={handleRenameDiscipline}
        onAddGrade={handleAddGrade}
        onRenameGrade={handleRenameGrade}
        onCloseRolesModal={handleCloseRolesModal}
        toast={toast}
      />
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
