"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSettingsLogger, SETTINGS_LOG_DEBOUNCE_MS } from "./settings-log";
import { getAlertableTasks } from "./due-dates";
import { getBucketReminders } from "./budget-report";
import { t } from "./i18n";
import { useChatDispatcher } from "./use-chat-dispatcher";
import { useActivityLog } from "./use-activity-log";
import { useDueAlerts } from "./use-due-alerts";
import { useToast } from "./use-toast";
import { useSettings, writeSettings } from "./use-settings";
import { isViewEnabled, isModuleEnabled, deriveMode, type FeatureModuleId } from "./feature-modules";
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
import { type Resource, type BudgetBucket, type RaidItem, type ChangeItem } from "./types";
import { useFxRates } from "./use-fx-rates";
import { splitName, resourceDisplayName } from "./resource-foundation";
import { buildRaidByTaskIndex } from "./raid";
import { buildChangeByTaskIndex } from "./change-log";
import { FiltersProvider, useFilters } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { ToastProvider } from "./toast-context";
import { useChangeLog } from "./use-change-log";
import { useStakeholders } from "./use-stakeholders";
import {
  TaskFormProvider,
  useTaskForm,
} from "./task-form-context";
import { TasksSection } from "./tasks-section";
import { useResizable } from "./use-resizable";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";
import { AppHeader } from "./app-header";
import { BirthdayBanner, DueBanner, JiraTokenBanner, RaidReviewBanner, RaidReviewModal, StakeholderCommsBanner, StakeholderCommsModal, StorageBanner } from "./notifications";
import { tursoErrorKind, type StorageErrorKind } from "./storage-error";
import { getRaidReviewItems } from "./raid-review";
import { useStakeholderComms } from "./use-stakeholder-comms";
import { getJiraTokenAlert } from "./jira-token-status";
import { effectiveLeadDays } from "./notifications-lead";
import { WorkspaceSection } from "./workspace-section";
import { RolesPanel } from "./roles-panel";
import { getUpcomingBirthdays } from "./birthdays";
import { useBirthdayAlerts } from "./use-birthday-alerts";
import { useReminderSnooze } from "./use-reminder-snooze";
import { isReportPopoutTab, openPopoutWindow } from "./broadcast-sync";
import { AppShell } from "./app-shell";
import { ModernShell } from "./modern-shell";
import { useHashView } from "./use-hash-view";
import { navLabelKey, filterNavGroups } from "./nav-config";
import type { AppView } from "./nav-config";
import { useSnapshots } from "./use-snapshots";
import { computeDashboard } from "./dashboard";
import { getTursoConfig } from "./turso-config";
import { defaultExportConfig, defaultSnapshotSettings } from "./settings-types";
import { TaskEditView, TASK_EDIT_FORM_ID } from "./task-edit-view";
import { APP_VERSION_LABEL } from "./version";
import { ActionMenus } from "./action-menus";
import { makeEditGuard } from "./read-only-guard";
import { SettingsView } from "./settings-view";
import { ReadOnlyMirrorBanner } from "./read-only-mirror-banner";
import { VoiceCommandProvider } from "./voice-command-context";
import { AiUsageProvider } from "./ai-usage-context";
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
import type { AbsenceType, ProjectMeta } from "./types";
import {
  loadRegistry,
  saveRegistry,
  removeProject,
  getCurrentEntry,
  type ProjectsRegistry,
} from "./projects-registry";
import { deleteHandle } from "./project-file-handles";
import { exportWorkspace, type ExportFormat } from "./export";
import { ProjectEmptyState } from "./project-empty-state";
import type { ProjectSwitcherProps } from "./project-switcher";

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
  const { isPopout, activeTab, setActiveTab, requestOpen } = useWorkspaceTab();
  useHashView(settings.layout === "modern", settings.features);
  // Classic mode has no panel for the modern-only views; fall back to chat.
  useEffect(() => {
    if (
      settings.layout === "classic" &&
      (activeTab === "open-points" || activeTab === "settings" || activeTab === "edit")
    ) {
      setActiveTab("chat");
    }
  }, [settings.layout, activeTab, setActiveTab]);

  // If the active view belongs to a disabled module (e.g. after a Save+reload
  // into Simple mode, or a stale hash), redirect to a still-enabled view.
  // In classic layout, fall back to "chat" instead of "open-points" to avoid a
  // double-hop (open-points → chat) caused by the classic-fallback effect above.
  useEffect(() => {
    if (isViewEnabled(activeTab, settings.features)) return;
    const fallback = (isPopout || settings.layout === "classic") ? "chat" : "open-points";
    setActiveTab(isModuleEnabled("dashboard", settings.features) ? "dashboard" : fallback);
  }, [activeTab, settings.features, settings.layout, isPopout, setActiveTab]);

  const handleCommitFeatures = useCallback(
    (features: FeatureModuleId[]) => {
      writeSettings({ ...settings, features });
      window.location.reload();
    },
    [settings],
  );

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
    status,
    milestones,
    changes,
    fxRates,
    project,
    setProject,
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

  // Baseline/variance trend snapshots. Active only on a Turso backend in the
  // main window with recording enabled; the hook is a no-op otherwise.
  const snapshotsCfg = settings.snapshots ?? defaultSnapshotSettings;
  const trendsActive =
    settings.storageConfig.kind === "turso" && !isPopout && snapshotsCfg.enabled &&
    isModuleEnabled("trends", settings.features);
  const tursoConfig = getTursoConfig(
    settings.integrations?.turso?.databaseUrl,
    settings.integrations?.turso?.authToken,
  );
  // Turso storage connectivity status — set when a load/save/snapshot op fails
  // with an unreachable host or rejected token, cleared on the next success.
  // Drives the status bubble (red) and a sticky banner (mirrors the Jira token).
  const [storageError, setStorageError] = useState<{ kind: StorageErrorKind } | null>(null);
  const [storageErrorDismissed, setStorageErrorDismissed] = useState(false);
  const reportStorageOutcome = useCallback((err: unknown | null) => {
    if (err == null) {
      // Recovery: clear the error and the dismissal so a later failure re-shows
      // the banner (dismiss only hides the current failing run).
      setStorageError(null);
      setStorageErrorDismissed(false);
      return;
    }
    const kind = tursoErrorKind(err);
    if (kind) setStorageError({ kind });
  }, []);

  const snapshots = useSnapshots({
    active: trendsActive,
    cadence: snapshotsCfg.cadence,
    tursoConfig,
    today: new Date(),
    buildContext: () => {
      const model = computeDashboard({
        tasks,
        raid,
        budgets,
        plan,
        roles,
        resources,
        absences,
        workdayHours: settings.resources.workdayHours,
        holidaySet,
        status,
        activity: activityLog,
        today,
        milestones,
        changes,
      });
      return {
        model,
        tasks,
        milestones,
        planEndDate: plan.endDate,
        currency: plan.currency || "EUR",
      };
    },
    onError: (err) => {
      reportStorageOutcome(err);
      // Connectivity/auth failures surface as the sticky banner; only toast
      // other (e.g. manual-capture) errors so the banner isn't duplicated.
      if (!tursoErrorKind(err)) showToast("error", t(lang, "storageSaveFailed", String(err)));
    },
  });
  const trends = { ...snapshots, active: trendsActive };

  const raidEnabled = isModuleEnabled("raid", settings.features);
  const changesEnabled = isModuleEnabled("changes", settings.features);
  const stakeholdersEnabled = isModuleEnabled("stakeholders", settings.features);
  const milestonesEnabled = isModuleEnabled("milestones", settings.features);

  const { bannerDismissed, setBannerDismissed, dueModalOpen, setDueModalOpen, raidReviewModalOpen, setRaidReviewModalOpen } =
    useDueAlerts({ hydrated, tasks, holidaySet, absences, settings, today, showToast, raid, raidEnabled });

  const { birthdayDismissed, setBirthdayDismissed } = useBirthdayAlerts({
    hydrated, resources, today, settings, holidaySet, absences, showToast,
  });

  const dueSnooze = useReminderSnooze("due");
  const birthdaySnooze = useReminderSnooze("birthday");
  const jiraTokenSnooze = useReminderSnooze("jiraToken");
  const raidReviewSnooze = useReminderSnooze("raidReview");
  const [raidReviewDismissed, setRaidReviewDismissed] = useState(false);
  const stakeholderCommsSnooze = useReminderSnooze("stakeholderComms");
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

  // Observable copy of the portfolio registry. The storage hook persists the
  // registry inside its switch/create/load flows; it cannot setState here, so we
  // pass `onRegistryChange` (option b) and the hook calls it after every
  // saveRegistry. This keeps the switcher list, empty-state gate, and Projects
  // panel re-rendering without re-reading localStorage on a bump counter.
  // Popouts mirror the main window and never mutate the registry, so an empty
  // initial value is fine there (the empty-state is also gated off for popouts).
  const [registry, setRegistry] = useState<ProjectsRegistry>(() => loadRegistry());

  const {
    storageDescription, storageReady, onPickStorageFile, onGrantWriteAccess,
    onOpenStorageFile, onRequestStorageSwitch,
    switchToProject, createProject, loadProjectFromFile,
  } =
    useStorageBackend({ settings, lang, hydrated, isPopout, activityLog, setActivityLog, showToast, setStorageConfig: (storageConfig) => setSettings((s) => ({ ...s, storageConfig })), onStorageOutcome: reportStorageOutcome, onRegistryChange: setRegistry });

  const currentProjectId = registry.currentProjectId;
  const currentEntry = getCurrentEntry(registry);
  // Prefer the live in-memory project meta name; fall back to the registry
  // entry's stored name, then null (the switcher shows a "no project" label).
  const currentProjectName = project?.name ?? currentEntry?.name ?? null;

  // The status bubble must reflect real reachability: a stale Turso config is
  // `isReady()`-true (config present) but actually failing, so fold in the
  // observed error.
  const storageOk = storageReady && !storageError;

  // Reverse-lookup index for the "referenced by N RAID items" badge on
  // each task row. Map<taskId, RaidItem[]>. O(R) on every raid update,
  // then O(1) per row. Empty when `raid` is empty — the per-row check
  // bails out fast. Returns an empty map when the RAID module is disabled
  // so the badge is never rendered and the click-to-jump dead-end is avoided.
  const raidByTask = useMemo(
    () => (raidEnabled ? buildRaidByTaskIndex(raid) : new Map<number, RaidItem[]>()),
    [raid, raidEnabled],
  );
  // Same index, mirrored for the read-only "N changes" task-row badge.
  // Returns an empty map when the changes module is disabled.
  const changeByTask = useMemo(
    () => (changesEnabled ? buildChangeByTaskIndex(changes) : new Map<number, ChangeItem[]>()),
    [changes, changesEnabled],
  );

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

  // Change Log CRUD. The hook reads/writes `changes` via WorkspaceProvider.
  const { handleSaveChange, handleDeleteChange } = useChangeLog({ today, logActivity });

  // Stakeholder register / RACI / map CRUD. The hook reads/writes `stakeholders`
  // via WorkspaceProvider; the three panels source `resources`/`milestones` from
  // context inside WorkspaceSection.
  const { stakeholders, handleSaveStakeholder, handleDeleteStakeholder } =
    useStakeholders({ today, logActivity });

  // Stakeholder-comms reminder (mirrors the RAID-review reminder wiring above):
  // mode-gated via `flags`, surfaced as a banner + modal in the shared slots.
  const comms = useStakeholderComms({
    hydrated,
    today,
    showToast,
    stakeholders,
    milestones,
    raid,
    changes,
    settings,
    flags: { stakeholdersEnabled, milestonesEnabled, raidEnabled, changesEnabled },
  });

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
  const { fieldErrors, submitted, saveDisabled, handleSubmit, handleCancelEdit, openEditModal } = useTaskSubmit({
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
    return getAlertableTasks(tasks, effectiveLeadDays(settings.notifications, "banner"), today, holidaySet, absences);
  }, [tasks, settings.notifications, today, holidaySet, absences]);

  const birthdayItems = useMemo(
    () => settings.notifications.birthday.enabled
      ? getUpcomingBirthdays(resources, today, effectiveLeadDays(settings.notifications, "birthday"), holidaySet, absences)
      : [],
    [resources, settings.notifications, today, holidaySet, absences],
  );

  const raidReviewItems = useMemo(
    () => raidEnabled && settings.notifications.raidReview.enabled
      ? getRaidReviewItems(raid, today, settings.notifications.raidReviewIntervalDays)
      : [],
    [raidEnabled, raid, today, settings.notifications.raidReview, settings.notifications.raidReviewIntervalDays],
  );

  const dueModalItems = useMemo(() => {
    return getAlertableTasks(tasks, effectiveLeadDays(settings.notifications, "popup"), today, holidaySet, absences);
  }, [tasks, settings.notifications, today, holidaySet, absences]);

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

  // Log a coarse, debounced "settings.updated" activity entry on every
  // user-driven settings change. Guards:
  //   1. Pre-hydration: `hydrated` is false until localStorage is loaded;
  //      the effect skips all runs while false.
  //   2. Initial mount: even after hydration the very first run reflects the
  //      loaded value (not a user edit), so `settingsInitialRef` suppresses it.
  //   3. Secrets: `logActivity("settings.updated")` emits no field values.
  const settingsLoggerRef = useRef(
    createSettingsLogger(() => logActivity("settings.updated"), SETTINGS_LOG_DEBOUNCE_MS),
  );
  const settingsInitialRef = useRef(true);
  useEffect(() => {
    if (!hydrated) return;
    if (settingsInitialRef.current) {
      settingsInitialRef.current = false;
      return;
    }
    const logger = settingsLoggerRef.current;
    logger.notifyChange();
    return () => logger.cancel();
  }, [settings, hydrated]);

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

  const openRaidItem = useCallback((id: number) => requestOpen("raid", id), [requestOpen]);

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

  // --- Multi-project panel callbacks ----------------------------------
  //
  // Switch / create / load come straight from the storage hook (Task 10). The
  // remaining three are owned here because they touch task-manager-local state.

  // Edit the current project's metadata. The existing save effect persists the
  // workspace (which carries `project`) — no side effects in the updater.
  const handleUpdateCurrentProject = useCallback(
    (meta: ProjectMeta) => setProject(meta),
    [setProject],
  );

  // Navigate to the Projects view, whose panel hosts the create modal.
  const handleNewProject = useCallback(() => setActiveTab("projects"), [setActiveTab]);

  // Export the CURRENT project's workspace. Snapshot is assembled from context
  // (same field set the save effect uses), including `project`.
  const handleExportCurrentProject = useCallback(
    (format: string) => {
      const ws = {
        tasks, raid, absences, shifts, resources, roles, disciplines, grades,
        plan, budgets, fxRates, status, project, milestones, changes, stakeholders,
      };
      void exportWorkspace(ws, format as ExportFormat, settings.export ?? defaultExportConfig, lang);
    },
    [tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, project, milestones, changes, stakeholders, settings.export, lang],
  );

  // De-register a project: drop it from the registry (observable copy updated),
  // best-effort delete its stored file handle. If the deleted project was
  // current and others remain, switch to the new current; if none remain, the
  // empty-state takes over on the next render.
  const handleDeleteProject = useCallback(
    (id: string) => {
      const wasCurrent = registry.currentProjectId === id;
      const next = removeProject(registry, id);
      if (next === registry) return; // unknown id — nothing changed
      void deleteHandle(id);
      // removeProject re-points currentProjectId to the first survivor. When the
      // CURRENT project was deleted and a survivor exists, load that survivor's
      // data. switchToProject early-returns if currentProjectId already equals
      // the target, so we persist the registry with currentProjectId cleared and
      // let switchToProject re-point it after loading the survivor's workspace.
      const survivor = next.currentProjectId;
      if (wasCurrent && survivor) {
        const cleared = { ...next, currentProjectId: null };
        saveRegistry(cleared);
        setRegistry(cleared);
        void switchToProject(survivor);
      } else {
        // Deleted a non-current project (or none remain). Persist as-is; if none
        // remain the empty-state takes over on the next render.
        saveRegistry(next);
        setRegistry(next);
      }
    },
    [registry, switchToProject],
  );

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

  const filteredNavGroups = useMemo(
    () => filterNavGroups(settings.features),
    [settings.features],
  );

  const appMode = useMemo(() => deriveMode(settings.features), [settings.features]);

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
    changes,
    handleSaveChange: guardEdit(handleSaveChange),
    handleDeleteChange: guardEdit(handleDeleteChange),
    stakeholders,
    handleSaveStakeholder: guardEdit(handleSaveStakeholder),
    handleDeleteStakeholder: guardEdit(handleDeleteStakeholder),
    handleCreateMitigationTaskFromRaid: guardEdit(handleCreateMitigationTaskFromRaid),
    handleJumpToTaskFromRaid,
    activityLog,
    logActivity,
    handleClearActivityLog: guardEdit(handleClearActivityLog),
    handleOpenAddAbsence: guardEdit(handleOpenAddAbsence),
    handleEditAbsence: guardEdit(handleEditAbsence),
    handleOpenShiftEditor: guardEdit(handleOpenShiftEditor),
    manageRolesView: (
      <RolesPanel
        lang={lang}
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
      />
    ),
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
    trends,
    // Multi-project (Projects view). Mutating callbacks are no-ops in popouts
    // (the hook's project functions early-return on isPopout); the panel still
    // renders read-only there, matching how other panels behave.
    projects: registry.projects,
    currentProjectId,
    currentProject: project,
    projectStakeholderNames: stakeholders.map((s) => s.name),
    projectAddressBook: contactsList,
    onSwitchProject: switchToProject,
    onCreateProject: createProject,
    onUpdateCurrentProject: handleUpdateCurrentProject,
    onDeleteProject: handleDeleteProject,
    onExportCurrentProject: handleExportCurrentProject,
    onLoadProjectFromFile: () => { void loadProjectFromFile(); },
  };

  const workspaceEl = <WorkspaceSection {...workspaceProps} />;
  const workspaceFullBleedEl = <WorkspaceSection {...workspaceProps} fullBleed />;

  const tasksSectionEl = (
    <TasksSection
      lang={lang}
      today={today}
      fillHeight={settings.layout === "modern"}
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
      changeByTask={changeByTask}
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
        disabled={saveDisabled}
        className="rounded-md bg-AIPM-green px-4 py-1.5 text-sm font-semibold text-AIPM-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-AIPM-green disabled:cursor-not-allowed disabled:opacity-50"
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
      fieldErrors={fieldErrors}
      submitted={submitted}
      holidaySet={holidaySet}
      jiraProjectKey={settings.jira.projectKey}
      jiraDefaultIssueType={settings.jira.issueTypes[0]}
      onSubmit={handleSubmit}
      onRemoveContact={handleRemoveContact}
      onShowToast={showToast}
      onAddAssigneeToAddressBook={handleAddAssigneeToAddressBook}
      footer={editActions}
    />
  );

  const settingsViewEl = (
    <SettingsView
      lang={lang}
      settings={settings}
      onChange={setSettings}
      onCommitFeatures={handleCommitFeatures}
      storageDescription={storageDescription}
      storageReady={storageOk}
      onPickStorageFile={onPickStorageFile}
      onOpenStorageFile={onOpenStorageFile}
      onGrantStorageWrite={onGrantWriteAccess}
      onRequestStorageSwitch={onRequestStorageSwitch}
    />
  );

  // The action-cluster menus (Voice/Export/Help/Version) shared with the classic
  // AppHeader via ActionMenus. The modern TopBar renders the + and bell buttons
  // itself; this fills its trailing `children` slot.
  // Current-project indicator + switcher, shared by the classic AppHeader and the
  // modern TopBar. Popouts mirror the main window and don't switch projects, so
  // they get a READ-ONLY indicator (name only, no dropdown). The live `project`
  // meta is kept in sync via the "project" BroadcastChannel slice, so the popout
  // header updates when the main window switches projects.
  const projectSwitcher: ProjectSwitcherProps = isPopout
    ? {
        currentProjectName: project?.name ?? null,
        projects: [],
        currentProjectId: null,
        lang,
        onSwitch: () => {},
        onLoadFromFile: () => {},
        onNew: () => {},
        readOnly: true,
      }
    : {
        currentProjectName,
        projects: registry.projects,
        currentProjectId,
        lang,
        onSwitch: switchToProject,
        onLoadFromFile: () => { void loadProjectFromFile(); },
        onNew: handleNewProject,
      };

  const topBarMenus = (
    <ActionMenus
      lang={lang}
      onCommand={handleCommand}
      onVoiceError={(msg) => showToast("error", msg)}
      exportConfig={settings.export ?? defaultExportConfig}
    />
  );

  // The Due / Birthday / Jira-token reminder banners, shared by the classic tree
  // (rendered after AppHeader) and the modern tree (ModernShell `banners` slot).
  // Gates kept verbatim — popouts (`!isPopout`) still suppress all three.
  const bannersEl = (
    <>
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
      {!isPopout && jiraTokenAlert && !jiraTokenSnooze.isSnoozed && !jiraTokenDismissed && settings.notifications.jiraTokenError.enabled && (
        <JiraTokenBanner
          alert={jiraTokenAlert}
          lang={lang}
          onSnooze={jiraTokenSnooze.snooze}
          onDismiss={() => setJiraTokenDismissed(true)}
        />
      )}
      {!isPopout && storageError && settings.storageConfig.kind === "turso" && !storageErrorDismissed && (
        <StorageBanner
          kind={storageError.kind}
          lang={lang}
          onOpenSettings={() => setActiveTab("settings")}
          onDismiss={() => setStorageErrorDismissed(true)}
        />
      )}
      {!isPopout && !raidReviewSnooze.isSnoozed && !raidReviewDismissed && raidReviewItems.length > 0 && (
        <RaidReviewBanner
          items={raidReviewItems}
          lang={lang}
          onOpenList={() => setRaidReviewModalOpen(true)}
          onDismiss={() => setRaidReviewDismissed(true)}
          onSnooze={raidReviewSnooze.snooze}
        />
      )}
      {!isPopout && stakeholdersEnabled && !stakeholderCommsSnooze.isSnoozed && !comms.bannerDismissed && comms.items.length > 0 && (
        <StakeholderCommsBanner
          items={comms.items}
          lang={lang}
          onOpenList={() => comms.setReviewModalOpen(true)}
          onDismiss={() => comms.setBannerDismissed(true)}
          onSnooze={stakeholderCommsSnooze.snooze}
        />
      )}
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
        fieldErrors={fieldErrors}
        submitted={submitted}
        saveDisabled={saveDisabled}
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
        toast={toast}
      />
      {raidReviewModalOpen && (
        <RaidReviewModal
          items={raidReviewItems}
          lang={lang}
          onClose={() => setRaidReviewModalOpen(false)}
          onSelectRaid={(id) => { setRaidReviewModalOpen(false); openRaidItem(id); }}
        />
      )}
      {stakeholdersEnabled && comms.reviewModalOpen && (
        <StakeholderCommsModal
          items={comms.items}
          lang={lang}
          onClose={() => comms.setReviewModalOpen(false)}
        />
      )}
    </>
  );

  // The existing tree. Its root className already branches on isPopout, so this
  // single definition serves both the classic main window AND every popout.
  const appHeaderEl = (
    <AppHeader
      handleCancelEdit={handleCancelEdit}
      setTaskModalOpen={setTaskModalOpen}
      bannerItems={bannerItems}
      setBannerDismissed={setBannerDismissed}
      setDueModalOpen={setDueModalOpen}
      showToast={showToast}
      handleCommand={handleCommand}
      storageDescription={storageDescription}
      storageReady={storageOk}
      onPickStorageFile={onPickStorageFile}
      onOpenStorageFile={onOpenStorageFile}
      onGrantStorageWrite={onGrantWriteAccess}
      onRequestStorageSwitch={onRequestStorageSwitch}
      settings={settings}
      setSettings={setSettings}
      lang={lang}
      onOpenAiAssistant={() => openPopoutWindow("chat", settings.popout.reuseWindow)}
      projectSwitcher={projectSwitcher}
    />
  );

  // Popout windows keep the simple scrolling flow. The classic main window is a
  // viewport-height flex column: the header pins at the top, only the content
  // region (workspace + tasks) scrolls, and the footer (last child of
  // modalsBlock) stays visible at the bottom without scrolling the whole page.
  const legacyTree = isPopout ? (
    <div className="flex flex-1 flex-col p-4">
      {!isReportPopoutTab(activeTab) && <ReadOnlyMirrorBanner lang={lang} />}
      {bannersEl}
      {workspaceEl}
      {modalsBlock}
    </div>
  ) : (
    <div className="flex h-screen flex-col">
      <div className="mx-auto w-full max-w-[1536px] shrink-0 px-6 pt-6 sm:px-10 sm:pt-10">
        {appHeaderEl}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[1536px] px-6 pb-6 sm:px-10 sm:pb-10">
          {bannersEl}
          {workspaceEl}
          {tasksSectionEl}
        </div>
      </div>
      {/* Footer lives at the end of modalsBlock; the max-w wrapper restores its
          horizontal framing now that it sits outside the scroll region. Fixed
          modals/toast inside are unaffected by this plain wrapper. */}
      <div className="mx-auto w-full max-w-[1536px] shrink-0 px-6 sm:px-10">
        {modalsBlock}
      </div>
    </div>
  );

  const modernTree = (
    <>
      <ModernShell
        lang={lang}
        activeView={activeTab}
        onNavigate={(v) => setActiveTab(v)}
        version={APP_VERSION_LABEL}
        mode={appMode}
        bannerCount={bannerItems.length}
        onNewTask={() => { handleCancelEdit(); setTaskModalOpen(true); }}
        onShowAlerts={() => { setBannerDismissed(false); setDueModalOpen(true); }}
        onOpenAiAssistant={() => openPopoutWindow("chat", settings.popout.reuseWindow)}
        topBarMenus={topBarMenus}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebar}
        sidebarFooter={
          <SidebarFooter
            lang={lang}
            collapsed={sidebarCollapsed}
            storageDescription={storageDescription}
            storageReady={storageOk}
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
        banners={bannersEl}
        navGroups={filteredNavGroups}
        projectSwitcher={projectSwitcher}
      />
      {modalsBlock}
    </>
  );

  if (isPopout) {
    return (
      <AiUsageProvider lang={lang} ai={settings.ai} showToast={showToast}>
        <ToastProvider value={showToast}>
          <VoiceCommandProvider value={voiceHandlers}>{legacyTree}</VoiceCommandProvider>
        </ToastProvider>
      </AiUsageProvider>
    );
  }
  // Empty-state gate: on a fresh install (no registered projects) the user must
  // create or load a project before anything else. Rendered as the ONLY surface
  // — there is no interactive app chrome behind it — and covers both modern and
  // classic layouts. Popouts are handled above (they mirror the main window and
  // never see this). Gated on `hydrated` so SSR / pre-hydration (where
  // loadRegistry() is empty) doesn't flash the modal.
  const showEmptyState = hydrated && registry.projects.length === 0;

  return (
    <AiUsageProvider lang={lang} ai={settings.ai} showToast={showToast}>
      <ToastProvider value={showToast}>
        <VoiceCommandProvider value={voiceHandlers}>
          {showEmptyState ? (
            <ProjectEmptyState
              lang={lang}
              stakeholderNames={stakeholders.map((s) => s.name)}
              addressBook={contactsList}
              onCreate={createProject}
              onLoadFromFile={() => { void loadProjectFromFile(); }}
            />
          ) : (
            <AppShell layout={settings.layout} classic={legacyTree} modern={modernTree} />
          )}
        </VoiceCommandProvider>
      </ToastProvider>
    </AiUsageProvider>
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
