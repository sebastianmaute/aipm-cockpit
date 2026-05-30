"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { getAlertableTasks } from "./due-dates";
import { getBucketReminders } from "./budget-report";
import { t } from "./i18n";
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
import { type Resource, type BudgetBucket } from "./types";
import { useFxRates } from "./use-fx-rates";
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
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";
import { AppHeader } from "./app-header";
import { BirthdayBanner, DueBanner, JiraTokenBanner } from "./notifications";
import { getJiraTokenAlert } from "./jira-token-status";
import { WorkspaceSection } from "./workspace-section";
import { getUpcomingBirthdays } from "./birthdays";
import { useBirthdayAlerts } from "./use-birthday-alerts";
import { useReminderSnooze } from "./use-reminder-snooze";
import { isReportPopoutTab } from "./broadcast-sync";
import { AppShell } from "./app-shell";
import { ModernShell } from "./modern-shell";
import { useHashView } from "./use-hash-view";
import { navLabelKey } from "./nav-config";
import type { AppView } from "./nav-config";
import { TaskEditView, TASK_EDIT_FORM_ID } from "./task-edit-view";
import { APP_VERSION } from "./version";
import { ExportMenu } from "./export-menu";
import { HelpMenu } from "./help-menu";
import { VersionMenu } from "./version-menu";
import { makeEditGuard } from "./read-only-guard";
import { SettingsView } from "./settings-view";
import { ReadOnlyMirrorBanner } from "./read-only-mirror-banner";
import { VoiceCommandProvider } from "./voice-command-context";
import { useMsAuth } from "./use-ms-auth";
import { SidebarFooter } from "./sidebar-footer";
import { useSidebarCollapsed } from "./use-sidebar-collapsed";
import { useOutlookContacts } from "./use-outlook-contacts";
import { OutlookImportModal } from "./outlook-import-modal";
import { contactsFromImported, type OutlookContact } from "./outlook-contacts";
import { upsertContact } from "./contacts";
import { useOutlookCalendar } from "./use-outlook-calendar";
import { OutlookCalendarImportModal } from "./outlook-calendar-import-modal";
import { dedupeKey, type OutlookEvent, type AbsenceImportTarget } from "./outlook-calendar";
import { isoAddDays } from "./due-dates";
import type { AbsenceType } from "./types";

// Lazy-loaded like in app-header.tsx — the speech-recognition bundle is only
// fetched client-side when the button mounts.
const VoiceCommandButton = dynamic(
  () => import("./voice-button").then((m) => m.VoiceCommandButton),
  { ssr: false },
);

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
  const { collapsed: sidebarCollapsed, toggle: toggleSidebar } = useSidebarCollapsed();
  const {
    colWidths,
    hiddenCols,
    setHiddenCols,
    colConfigOpen,
    setColConfigOpen,
    colConfigRef,
    resetColWidths,
    startColResize,
  } = useColumnManager();
  const { isPopout, activeTab, setActiveTab } = useWorkspaceTab();
  useHashView(settings.layout === "modern");
  // Classic mode has no panel for the modern-only views; fall back to chat.
  useEffect(() => {
    if (
      settings.layout === "classic" &&
      (activeTab === "open-points" || activeTab === "settings" || activeTab === "edit")
    ) {
      setActiveTab("chat");
    }
  }, [settings.layout, activeTab, setActiveTab]);
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
    raid,
    absences,
    shifts,
    resources,
    roles,
    disciplines,
    grades,
    setBudgets,
    setFxRates,
    budgets,
    plan,
    fxRates,
  } = useWorkspace();

  const { setContacts, contactsList, handleRemoveContact } =
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

  // Phase 2: in the modern main window the task editor is a full-page "edit"
  // view, not the overlay modal. `taskModalOpen` stays the single "editor open"
  // signal (set by every entry point, cleared by handleSubmit on success and by
  // handleCancelEdit); this effect mirrors it into navigation, remembering the
  // origin view so Save/Cancel return there. Classic mode and popouts keep the
  // modal and are unaffected (the effect is gated on `useEditView`).
  const useEditView = settings.layout === "modern" && !isPopout;
  const editorReturnRef = useRef<AppView>("open-points");
  useEffect(() => {
    if (!useEditView) return;
    if (taskModalOpen && activeTab !== "edit") {
      editorReturnRef.current = activeTab;
      setActiveTab("edit");
    } else if (!taskModalOpen && activeTab === "edit") {
      setActiveTab(editorReturnRef.current);
    }
  }, [useEditView, taskModalOpen, activeTab, setActiveTab]);

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
    document.title = `${t(lang, navLabelKey(activeTab))} — ${t(lang, "appTitle")}`;
  }, [isPopout, activeTab, lang]);

  const { holidaySet } = useHolidaySet({
    holidayCountries: settings.holidayCountries,
  });

  const { bannerDismissed, setBannerDismissed, dueModalOpen, setDueModalOpen } =
    useDueAlerts({ hydrated, tasks, holidaySet, absences, settings, today, showToast });

  const { birthdayDismissed, setBirthdayDismissed } = useBirthdayAlerts({
    hydrated, resources, today, settings, holidaySet, absences, showToast,
  });

  const dueSnooze = useReminderSnooze("due");
  const birthdaySnooze = useReminderSnooze("birthday");
  const jiraTokenSnooze = useReminderSnooze("jiraToken");
  const [jiraTokenDismissed, setJiraTokenDismissed] = useState(false);
  const jiraTokenAlert = useMemo(
    () => getJiraTokenAlert(settings.jira, today, settings.notifications.reminderLeadDays),
    [settings.jira, today, settings.notifications.reminderLeadDays],
  );

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
    onJiraAuthResult: (ok: boolean) =>
      setSettings((s) => ({ ...s, jira: { ...s.jira, tokenInvalidAt: ok ? undefined : new Date().toISOString() } })),
  });

  const { storageDescription, storageReady, onPickStorageFile, onGrantWriteAccess, onOpenStorageFile, onRequestStorageSwitch } =
    useStorageBackend({ settings, lang, hydrated, isPopout, activityLog, setActivityLog, showToast, setStorageConfig: (storageConfig) => setSettings((s) => ({ ...s, storageConfig })) });

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
    onDeleteDiscipline,
    onReorderDisciplines,
    handleAddGrade,
    handleRenameGrade,
    onDeleteGrade,
    onReorderGrades,
    handleSetUtilization,
    handleSetAbsenceOverride,
    handleSetPlanWindow,
    editingResource,
    handleOpenAddResource,
    handleEditResource,
    handleSaveResource,
    handleDeleteResource,
    handleImportResources,
    handleImportAbsences,
    handleCloseResourceModal,
    handleSetAllUtilizationMode,
  } = useResourcePlanner({ lang, logActivity, showToast, workdayHours: settings.resources.workdayHours, holidaySet });

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

  const m365Enabled = settings.integrations?.m365?.enabled ?? false;
  const outlookContactsEnabled =
    m365Enabled && (settings.integrations?.m365?.outlookContacts ?? false);
  const msAuth = useMsAuth(m365Enabled);
  const { fetchContacts: fetchOutlookContacts } = useOutlookContacts(msAuth.acquireToken);

  const [importOpen, setImportOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importContacts, setImportContacts] = useState<OutlookContact[]>([]);

  const handleOpenOutlookImport = useCallback(async () => {
    const knownKeys = [
      "outlookSignInRequired",
      "outlookSignInExpired",
      "outlookPermissionDenied",
      "outlookFetchFailed",
    ] as const;
    setImportOpen(true);
    setImportError(null);
    setImportContacts([]);
    setImportLoading(true);
    try {
      const fetched = await fetchOutlookContacts();
      setImportContacts(fetched);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      const key = (knownKeys as readonly string[]).includes(msg)
        ? (msg as (typeof knownKeys)[number])
        : "outlookFetchFailed";
      setImportError(t(lang, key));
    } finally {
      setImportLoading(false);
    }
  }, [fetchOutlookContacts, lang]);

  const existingResourceEmails = useMemo(
    () =>
      new Set(
        resources
          .map((r) => (r.email ?? "").trim().toLowerCase())
          .filter((e) => e !== ""),
      ),
    [resources],
  );

  const handleConfirmOutlookImport = useCallback(
    (selected: OutlookContact[]) => {
      handleImportResources(selected);
      setContacts((prev) =>
        contactsFromImported(selected).reduce(
          (acc, c) => upsertContact(acc, c.name, c.email),
          prev,
        ),
      );
      setImportOpen(false);
      showToast("info", t(lang, "outlookImportedN", selected.length));
    },
    [handleImportResources, setContacts, showToast, lang],
  );

  const outlookCalendarEnabled =
    m365Enabled && (settings.integrations?.m365?.outlookCalendar ?? false);
  const { fetchEvents: fetchOutlookEvents } = useOutlookCalendar(msAuth.acquireToken);

  const [calImportOpen, setCalImportOpen] = useState(false);
  const [calImportLoading, setCalImportLoading] = useState(false);
  const [calImportError, setCalImportError] = useState<string | null>(null);
  const [calImportEvents, setCalImportEvents] = useState<OutlookEvent[]>([]);

  const calendarTarget = useMemo<AbsenceImportTarget>(() => {
    const email = (msAuth.account?.username ?? "").trim();
    const lower = email.toLowerCase();
    const match = email
      ? resources.find((r) => (r.email ?? "").trim().toLowerCase() === lower)
      : undefined;
    return {
      assignee: match ? resourceDisplayName(match) : (msAuth.account?.name ?? email),
      assigneeEmail: email || undefined,
      resourceId: match?.id,
    };
  }, [msAuth.account, resources]);

  const calendarExistingKeys = useMemo(() => {
    const key = calendarTarget.assignee.trim().toLowerCase();
    return new Set(
      absences
        .filter((a) => a.assignee.trim().toLowerCase() === key)
        .map((a) => dedupeKey(a.assignee, a.startDate, a.endDate)),
    );
  }, [absences, calendarTarget.assignee]);

  const handleOpenCalendarImport = useCallback(async () => {
    const knownKeys = [
      "outlookSignInRequired",
      "outlookSignInExpired",
      "outlookCalendarPermissionDenied",
      "outlookCalendarFetchFailed",
    ] as const;
    setCalImportOpen(true);
    setCalImportError(null);
    setCalImportEvents([]);
    setCalImportLoading(true);
    try {
      const events = await fetchOutlookEvents({
        startDateTime: `${isoAddDays(today, -30)}T00:00:00Z`,
        endDateTime: `${isoAddDays(today, 180)}T00:00:00Z`,
      });
      setCalImportEvents(events);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      const key = (knownKeys as readonly string[]).includes(msg)
        ? (msg as (typeof knownKeys)[number])
        : "outlookCalendarFetchFailed";
      setCalImportError(t(lang, key));
    } finally {
      setCalImportLoading(false);
    }
  }, [fetchOutlookEvents, today, lang]);

  const handleConfirmCalendarImport = useCallback(
    (rows: { event: OutlookEvent; type: AbsenceType }[]) => {
      handleImportAbsences(rows, calendarTarget);
      setCalImportOpen(false);
      showToast("info", t(lang, "outlookCalImportedN", rows.length));
    },
    [handleImportAbsences, calendarTarget, showToast, lang],
  );

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
  // Keep the forwarding ref current after every commit (it's only ever read
  // from event handlers, never during render).
  useEffect(() => {
    onPushToJiraRef.current = onPushToJira;
  });

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
  // depending on useBulkOperations being declared first. Written in an effect
  // (after commit) because onDelete only reads it from its event handler.
  useEffect(() => {
    deselectIdRef.current = deselectId;
  });
  const { handleGanttBarUpdate } = useGanttHandlers({ tasksRef, setTasks, today });

  const bannerItems = useMemo(() => {
    const cfg = settings.notifications.banner;
    if (!cfg.enabled) return [];
    return getAlertableTasks(tasks, settings.notifications.reminderLeadDays, today, holidaySet, absences);
  }, [tasks, settings.notifications.reminderLeadDays, settings.notifications.banner, today, holidaySet, absences]);

  const birthdayItems = useMemo(
    () => settings.notifications.birthday.enabled
      ? getUpcomingBirthdays(resources, today, settings.notifications.reminderLeadDays, holidaySet, absences)
      : [],
    [resources, settings.notifications.reminderLeadDays, settings.notifications.birthday, today, holidaySet, absences],
  );

  const dueModalItems = useMemo(() => {
    return getAlertableTasks(tasks, settings.notifications.reminderLeadDays, today, holidaySet, absences);
  }, [tasks, settings.notifications.reminderLeadDays, today, holidaySet, absences]);

  const bucketReminders = useMemo(
    () => getBucketReminders(budgets, settings.notifications.reminderLeadDays, today),
    [budgets, settings.notifications.reminderLeadDays, today],
  );

  const bucketReminderKey = bucketReminders.map((r) => r.bucket.id).join(",");
  useEffect(() => {
    if (bucketReminders.length > 0) {
      showToast("info", `${bucketReminders.length} ${t(lang, "budgetEndingSoon")}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucketReminderKey]);

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
    isReadOnly: isPopout,
  });

  const handleAcceptAiConsent = useCallback(() => {
    setSettings((s) => ({ ...s, ai: { ...s.ai, consentAccepted: true } }));
  }, [setSettings]);

  const handleChangeBudgets = useCallback((next: BudgetBucket[]) => setBudgets(next), [setBudgets]);
  const cacheFxRates = useCallback((fx: import("./types").FxRates) => setFxRates(fx), [setFxRates]);
  const { refresh: refreshFx, loading: fxLoading } = useFxRates(cacheFxRates);

  const editingTask =
    editingId !== null
      ? tasks.find((row) => row.id === editingId) ?? null
      : null;
  const editingIsJiraLinked = !!editingTask?.jiraKey;

  // Render gate: hold first paint until the active-language dictionary is
  // in memory. Lifts in the next microtask for en-US/en-GB (no fetch);
  // briefly delays initial paint for de while ./i18n.de loads. Must come
  // AFTER every hook so the rules-of-hooks invariant holds.
  const guardEdit = makeEditGuard(isPopout, () =>
    showToast("info", t(lang, "popoutReadOnly")),
  );

  const voiceHandlers = useMemo(
    () => (isPopout ? null : { onCommand: handleCommand, onError: (msg: string) => showToast("error", msg) }),
    [isPopout, handleCommand, showToast],
  );

  if (!i18nReady) return null;

  // Shared props for WorkspaceSection. Spread into both the classic (no
  // fullBleed) and modern (fullBleed) renders so the long prop list lives once.
  const workspaceProps = {
    today,
    holidaySet,
    workspaceRef,
    resetWorkspaceSize,
    workspaceCollapsed,
    setWorkspaceCollapsed,
    dispatcher,
    handleAcceptAiConsent,
    handleGanttBarUpdate: guardEdit(handleGanttBarUpdate),
    handleCancelEdit,
    setTaskModalOpen,
    handleClearRaidTaskFilter,
    handleSaveRaidItem: guardEdit(handleSaveRaidItem),
    handleDeleteRaidItem: guardEdit(handleDeleteRaidItem),
    handleCreateMitigationTaskFromRaid: guardEdit(handleCreateMitigationTaskFromRaid),
    handleJumpToTaskFromRaid,
    activityLog,
    handleClearActivityLog: guardEdit(handleClearActivityLog),
    handleOpenAddAbsence: guardEdit(handleOpenAddAbsence),
    handleEditAbsence: guardEdit(handleEditAbsence),
    handleOpenShiftEditor: guardEdit(handleOpenShiftEditor),
    onManageRoles: guardEdit(handleOpenRolesModal),
    onAssignRole: guardEdit(handleAssignResourceRole),
    onSetUtilization: guardEdit(handleSetUtilization),
    onSetAllUtilizationMode: guardEdit(handleSetAllUtilizationMode),
    onSetAbsenceOverride: guardEdit(handleSetAbsenceOverride),
    onSetPlanWindow: guardEdit(handleSetPlanWindow),
    onEditResource: guardEdit(handleEditResource),
    onAddResource: guardEdit(handleOpenAddResource),
    onImportOutlook:
      outlookContactsEnabled && msAuth.account && !importLoading
        ? guardEdit(() => { void handleOpenOutlookImport(); })
        : undefined,
    onImportOutlookCalendar:
      outlookCalendarEnabled && msAuth.account
        ? guardEdit(() => { void handleOpenCalendarImport(); })
        : undefined,
    onEditTask: openEditModal,
    onChangeBudgets: handleChangeBudgets,
    onRefreshFx: refreshFx,
    fxLoading,
  };

  const workspaceEl = <WorkspaceSection {...workspaceProps} />;
  const workspaceFullBleedEl = <WorkspaceSection {...workspaceProps} fullBleed />;

  const tasksSectionEl = (
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
  );

  // Phase 2 full-page editor (modern). Reuses the same fields/validation as the
  // modal; submit goes through the existing handleSubmit.
  const editTitle =
    editingId !== null ? t(lang, "tabEditTask", editingId) : t(lang, "tabNewTask");

  const editActions = (
    <>
      <button
        type="button"
        onClick={handleCancelEdit}
        className="rounded-md border border-line bg-surface px-4 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted dark:border-line dark:bg-surface dark:text-foreground dark:hover:bg-surface-muted"
      >
        {t(lang, "cancel")}
      </button>
      <button
        type="submit"
        form={TASK_EDIT_FORM_ID}
        className="rounded-md bg-AIPM-green px-4 py-1.5 text-sm font-semibold text-AIPM-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-AIPM-green"
      >
        {editingId !== null ? t(lang, "updateTask") : t(lang, "addTask")}
      </button>
    </>
  );

  const editViewEl = (
    <TaskEditView
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
      onSubmit={handleSubmit}
      onRemoveContact={handleRemoveContact}
      onShowToast={showToast}
      onAddAssigneeToAddressBook={handleAddAssigneeToAddressBook}
    />
  );

  const settingsViewEl = (
    <SettingsView
      lang={lang}
      settings={settings}
      onChange={setSettings}
      storageDescription={storageDescription}
      storageReady={storageReady}
      onPickStorageFile={onPickStorageFile}
      onOpenStorageFile={onOpenStorageFile}
      onGrantStorageWrite={onGrantWriteAccess}
      onRequestStorageSwitch={onRequestStorageSwitch}
    />
  );

  // The action-cluster menus that AppHeader renders in classic mode. Reused by
  // the modern TopBar (which renders the + and bell buttons itself).
  const topBarMenus = (
    <>
      <VoiceCommandButton
        lang={lang}
        onCommand={handleCommand}
        onError={(msg) => showToast("error", msg)}
      />
      <ExportMenu lang={lang} tasks={tasks} raid={raid} absences={absences} shifts={shifts} resources={resources} roles={roles} disciplines={disciplines} grades={grades} plan={plan} budgets={budgets} fxRates={fxRates} />
      <HelpMenu lang={lang} />
      <VersionMenu lang={lang} />
    </>
  );

  const modalsBlock = (
    <>
      <OutlookImportModal
        lang={lang}
        open={importOpen}
        loading={importLoading}
        error={importError}
        contacts={importContacts}
        existingEmails={existingResourceEmails}
        onConfirm={handleConfirmOutlookImport}
        onClose={() => setImportOpen(false)}
      />
      <OutlookCalendarImportModal
        lang={lang}
        open={calImportOpen}
        loading={calImportLoading}
        error={calImportError}
        events={calImportEvents}
        targetAssignee={calendarTarget.assignee}
        existingKeys={calendarExistingKeys}
        onConfirm={handleConfirmCalendarImport}
        onClose={() => setCalImportOpen(false)}
      />
      <AppModals
        lang={lang}
        isPopout={isPopout}
        showTaskFormModal={!useEditView}
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
        onDeleteDiscipline={onDeleteDiscipline}
        onReorderDisciplines={onReorderDisciplines}
        onAddGrade={handleAddGrade}
        onRenameGrade={handleRenameGrade}
        onDeleteGrade={onDeleteGrade}
        onReorderGrades={onReorderGrades}
        onCloseRolesModal={handleCloseRolesModal}
        toast={toast}
      />
    </>
  );

  // The existing tree. Its root className already branches on isPopout, so this
  // single definition serves both the classic main window AND every popout.
  const legacyTree = (
    <div
      className={
        isPopout
          ? "flex flex-1 flex-col p-4"
          : "mx-auto w-full max-w-[1536px] p-6 sm:p-10"
      }
    >
      {isPopout && !isReportPopoutTab(activeTab) && <ReadOnlyMirrorBanner lang={lang} />}
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
          onRequestStorageSwitch={onRequestStorageSwitch}
          settings={settings}
          setSettings={setSettings}
          lang={lang}
        />
      )}

      {!isPopout && !bannerDismissed && !dueSnooze.isSnoozed && (
        <DueBanner
          items={bannerItems}
          lang={lang}
          onOpenList={() => setDueModalOpen(true)}
          onDismiss={() => setBannerDismissed(true)}
          onSnooze={dueSnooze.snooze}
        />
      )}

      {!isPopout && !birthdaySnooze.isSnoozed && !birthdayDismissed && birthdayItems.length > 0 && (
        <BirthdayBanner items={birthdayItems} lang={lang} onDismiss={() => setBirthdayDismissed(true)} onSnooze={birthdaySnooze.snooze} />
      )}

      {!isPopout && jiraTokenAlert && !jiraTokenSnooze.isSnoozed && !jiraTokenDismissed && (
        <JiraTokenBanner
          alert={jiraTokenAlert}
          lang={lang}
          onSnooze={jiraTokenSnooze.snooze}
          onDismiss={() => setJiraTokenDismissed(true)}
        />
      )}

      {workspaceEl}

      {!isPopout && tasksSectionEl}

      {modalsBlock}
    </div>
  );

  const modernTree = (
    <>
      <ModernShell
        lang={lang}
        activeView={activeTab}
        onNavigate={(v) => setActiveTab(v)}
        version={APP_VERSION}
        bannerCount={bannerItems.length}
        onNewTask={() => { handleCancelEdit(); setTaskModalOpen(true); }}
        onShowAlerts={() => { setBannerDismissed(false); setDueModalOpen(true); }}
        topBarMenus={topBarMenus}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebar}
        sidebarFooter={
          <SidebarFooter
            lang={lang}
            collapsed={sidebarCollapsed}
            storageDescription={storageDescription}
            storageReady={storageReady}
            isSignedIn={msAuth.account != null}
            accountName={msAuth.account?.username ?? null}
            onSignOut={() => {
              void msAuth.signOut();
            }}
          />
        }
        tasksSection={tasksSectionEl}
        workspace={workspaceFullBleedEl}
        editView={editViewEl}
        editTitle={editTitle}
        editActions={editActions}
        settingsView={settingsViewEl}
      />
      {modalsBlock}
    </>
  );

  if (isPopout) {
    return <VoiceCommandProvider value={voiceHandlers}>{legacyTree}</VoiceCommandProvider>;
  }
  return (
    <VoiceCommandProvider value={voiceHandlers}>
      <AppShell layout={settings.layout} classic={legacyTree} modern={modernTree} />
    </VoiceCommandProvider>
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
