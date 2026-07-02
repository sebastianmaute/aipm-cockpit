"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSettingsLogger, SETTINGS_LOG_DEBOUNCE_MS } from "./settings-log";
import type { SettingsSectionId } from "./dashboard-coaching";
import { getBucketReminders } from "./budget-report";
import { type Lang, t } from "./i18n";
import { useChatDispatcher } from "./use-chat-dispatcher";
import { useActivityLog } from "./use-activity-log";
import { ActivityLogProvider } from "./activity-log-context";
import { useToast } from "./use-toast";
import { useSettings } from "./use-settings";
import { useApplyFavicon } from "./use-favicon";
import { useTemplates } from "./use-templates";
import { templateFromWorkspace, type SaveTemplateInput } from "./templates";
import { applyTemplate } from "./template-apply";
import { useCurrentWorkspace } from "./use-current-workspace";
import { ALL_MODULE_IDS, disabledViewRedirect, isModuleEnabled, deriveMode, type FeatureModuleId } from "./feature-modules";
import { useJiraSync } from "./use-jira-sync";
import { useStorageBackend } from "./use-storage-backend";
import { useResourcePlanner } from "./use-resource-planner";
import { useBulkOperations } from "./use-bulk-operations";
import { useColumnManager } from "./use-column-manager";
import { useContacts } from "./use-contacts";
import { useWorkspaceCollapsed } from "./use-workspace-collapsed";
import { useHolidaySet } from "./use-holiday-set";
import { useTaskRowHandlers } from "./use-task-row-handlers";
import { useCommTemplates } from "./use-comm-templates";
import { useOperatingGuides } from "./use-operating-guides";
import { useTaskSubmit } from "./use-task-submit";
import { useGanttHandlers } from "./use-gantt-handlers";
import { AppModals } from "./app-modals";
import { type Resource, type BudgetBucket, type RaidItem, type ChangeItem } from "./types";
import { useFxRates } from "./use-fx-rates";
import { splitName, resourceDisplayName, nextId as computeNextId } from "./resource-foundation";
import { buildRaidByTaskIndex } from "./raid";
import { buildChangeByTaskIndex } from "./change-log";
import { FiltersProvider, useFilters } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { useFeaturesSync } from "./use-features-sync";
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
import { GlobalSearchConnected } from "./global-search-box";
import { BirthdayBanner, JiraTokenBanner, StorageBanner } from "./notifications";
import { tursoErrorKind, type StorageErrorKind } from "./storage-error";
import { useStakeholderComms } from "./use-stakeholder-comms";
import { isReadOnlyIssue, jiraProjectKeyOf } from "./jira-projects";
import { getJiraTokenAlert } from "./jira-token-status";
import { effectiveLeadDays } from "./notifications-lead";
import { WorkspaceSection } from "./workspace-section";
import { CalendarPullSummaryModal } from "./calendar-pull-summary-modal";
import { useCalendarIntegrations } from "./use-calendar-integrations";
import { useActionCenterHandlers } from "./use-action-center-handlers";
import { RolesPanel } from "./roles-panel";
import { getUpcomingBirthdays } from "./birthdays";
import { useBirthdayAlerts } from "./use-birthday-alerts";
import { useReminderSnooze } from "./use-reminder-snooze";
import { useActionSnooze } from "./use-action-snooze";
import { useActionNotifications } from "./use-action-notifications";
import { isReportPopoutTab, openPopoutWindow } from "./broadcast-sync";
import { ModernShell } from "./modern-shell";
import { AskClaudeMenu } from "./ask-claude-menu";
import { useHashView } from "./use-hash-view";
import { navLabelKey, filterNavGroups } from "./nav-config";
import type { AppView } from "./nav-config";
import { useSnapshots } from "./use-snapshots";
import { useVersionHistory } from "./use-version-history";
import { DEFAULT_VERSION_RETENTION } from "./version-history";
import { workspaceToJson, jsonToWorkspace, type Workspace } from "./workspace";
import { buildDashboardInput, computeDashboard } from "./dashboard";
import { getTursoConfig } from "./turso-config";
import { aiKeyIfEnabled, defaultExportConfig, defaultNextActionsLearning, defaultSnapshotSettings, isAiEnabled, resolveNextActionsConfig, type Settings } from "./settings-types";
import { buildSuggestionContext } from "./weight-suggestion-ai";
import { type SuggestionScope } from "./next-actions-tuning";
import { TaskEditView, TASK_EDIT_FORM_ID } from "./task-edit-view";
import { TaskDeleteButton, TaskEditorActions } from "./task-editor-actions";
import { APP_VERSION_LABEL } from "./version";
import { ActionMenus } from "./action-menus";
import { makeEditGuard } from "./read-only-guard";
import { SettingsView } from "./settings-view";
import { LearningInsights } from "./learning-insights";
import { useActionLearning } from "./use-action-learning";
import { ReadOnlyMirrorBanner } from "./read-only-mirror-banner";
import { VoiceCommandProvider } from "./voice-command-context";
import { AiUsageProvider } from "./ai-usage-context";
import { useMsAuth } from "./use-ms-auth";
import { useCommSend } from "./use-comm-send";
import { CommSendPreviewModal } from "./comm-send-preview-modal";
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
import { SecretUnlockGate } from "./secret-unlock-gate";
import { isPassphraseLocked } from "./secrets-store";
import { unlockSecret } from "./use-secrets";
import type { ProjectSwitcherProps } from "./project-switcher";
import { useTour } from "./use-tour";
import { TourOverlay } from "./tour-overlay";
import { TOUR_ANCHORS } from "./app-tour";
import { loadPortfolioMode, type PortfolioMode } from "./portfolio-mode";
import { listProjects, listArchivedProjects } from "./turso-portfolio";
import { useTursoProjects } from "./use-turso-projects";
import type { ProjectListEntry } from "./turso-tenant-schema";
import type { ProjectRegistryEntry } from "./projects-registry";
import { computeNextActions } from "./next-actions";
import { buildActionInput } from "./next-actions-input";
import { useActionAnalysis } from "./use-action-analysis";
import { buildAnalysisContext, buildGroundingIndex, groundEntity, type AiAction } from "./action-ai";
import { useScheduledJobs } from "./use-scheduled-jobs";
import { useScheduledJobRunner } from "./use-scheduled-job-runner";
import { buildWorkloadAlerts } from "./next-actions-workload";
import type { SuggestedAction } from "./next-actions";
import { computeActionTrends, summarizeTrendsForPrompt } from "./next-actions/trends";
import { todayInZone, resolveTimezone } from "./timezone";
import { DisplayTimezoneProvider, useDisplayTimezone } from "./display-timezone-context";
import { DisplayTzSwitcher } from "./display-tz-switcher";

// Today (YYYY-MM-DD) in the resolved effective zone. A module fn so the
// `new Date()` read stays out of the render body (react-hooks purity rule).
// Connected display-timezone switcher. A module-level wrapper (static-components
// rule) so it can read the DisplayTimezoneContext that wraps both shells — the
// header element it produces is rendered inside the provider in both layouts.
function DisplayTzSwitcherConnected({ lang, additionalTimezones }: { lang: Lang; additionalTimezones: readonly string[] }) {
  const ctx = useDisplayTimezone();
  return <DisplayTzSwitcher lang={lang} ctx={ctx} additionalTimezones={additionalTimezones} />;
}

function effectiveToday(tz: string): string {
  return todayInZone(new Date(), tz);
}

// Idle window before an auto version is captured after a save. Coalesces a
// burst of saves into a single version.
const VERSION_IDLE_MS = 180_000; // 3 minutes

// Cap on the per-kind lines in the SP-C weight-suggestion learning summary,
// keeping the AI context token-bounded.
const MAX_LEARNING_SUMMARY_ENTRIES = 20;

// TaskManagerInner consumes the FiltersProvider context. The default
// export below wraps this in <FiltersProvider> so useFilters() works.
function TaskManagerInner() {
  const { settings, setSettings, hydrated, i18nReady, lang } = useSettings();
  useApplyFavicon(settings.branding?.favicon ?? null);
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
  const { isPopout, activeTab, setActiveTab, requestOpen, pendingOpen, clearPendingOpen, requestChat, requestFlash, requestHelpConcept } = useWorkspaceTab();
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
    const target = disabledViewRedirect(activeTab, settings.features, settings.layout, isPopout);
    if (target !== activeTab) setActiveTab(target);
  }, [activeTab, settings.features, settings.layout, isPopout, setActiveTab]);

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
    setRaid,
    absences,
    setAbsences,
    shifts,
    setShifts,
    resources,
    setResources,
    roles,
    setRoles,
    disciplines,
    setDisciplines,
    grades,
    setGrades,
    setBudgets,
    setFxRates,
    budgets,
    plan,
    setPlan,
    status,
    setStatus,
    milestones,
    setMilestones,
    changes,
    setChanges,
    setStakeholders,
    steeringCommittee,
    setSteeringCommittee,
    setFieldVisibility,
    fxRates,
    project,
    setProject,
    setFeatures,
  } = useWorkspace();

  // Mirror the active project's per-project `Workspace.features` into the
  // reactive `settings.features` (the source the 45 module consumers read), so
  // mode changes and project switches re-render instead of reloading the page.
  useFeaturesSync(setSettings);

  // Committing a mode/feature change just writes the per-project features;
  // useFeaturesSync propagates it into settings reactively (no reload).
  const handleCommitFeatures = useCallback(
    (features: FeatureModuleId[]) => {
      setFeatures(features);
    },
    [setFeatures],
  );

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
  // When a deep-link opened the full-page editor, remember the task id so we can
  // flash its row/card on the list once the editor closes and the list re-mounts.
  const flashOnEditReturnRef = useRef<number | null>(null);
  useEffect(() => {
    if (!useEditView) return;
    if (taskModalOpen && activeTab !== "edit") {
      editorReturnRef.current = activeTab;
      setActiveTab("edit");
    } else if (!taskModalOpen && activeTab === "edit") {
      const back = editorReturnRef.current;
      setActiveTab(back);
      if (flashOnEditReturnRef.current !== null) {
        const flashTaskId = flashOnEditReturnRef.current;
        flashOnEditReturnRef.current = null;
        if (back === "open-points") requestFlash("open-points", flashTaskId);
      }
    }
  }, [useEditView, taskModalOpen, activeTab, setActiveTab, requestFlash]);

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

  const effectiveTz = resolveTimezone(settings.timezone, project?.operatingTimezone);
  const today = effectiveToday(effectiveTz);

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

  const tursoConfig = useMemo(
    () => getTursoConfig(settings.integrations?.turso?.databaseUrl, settings.integrations?.turso?.authToken),
    [settings.integrations?.turso?.databaseUrl, settings.integrations?.turso?.authToken],
  );

  // Action Center learning layer: records CTA/snooze outcomes and feeds a learned
  // per-kind bias back into the ranking. Inert (no-op record, empty bias) when
  // disabled or in a popout.
  const learning = useActionLearning({
    config: settings.nextActionsLearning ?? defaultNextActionsLearning,
    tursoConfig,
    isPopout,
  });
  // Turso storage connectivity status — set when a load/save/snapshot op fails
  // with an unreachable host or rejected token, cleared on the next success.
  // Drives the status bubble (red) and a sticky banner (mirrors the Jira token).
  const [storageError, setStorageError] = useState<{ kind: StorageErrorKind } | null>(null);
  const [storageErrorDismissed, setStorageErrorDismissed] = useState(false);
  // Bridges a successful save into the version-history idle-capture timer. The
  // hook is instantiated later, so this ref is wired up via an effect below.
  const versionNotifyRef = useRef<() => void>(() => {});
  const reportStorageOutcome = useCallback((err: unknown | null) => {
    if (err == null) {
      // Recovery: clear the error and the dismissal so a later failure re-shows
      // the banner (dismiss only hides the current failing run).
      setStorageError(null);
      setStorageErrorDismissed(false);
      versionNotifyRef.current(); // arm version-history idle capture on a good save
      return;
    }
    const kind = tursoErrorKind(err);
    if (kind) setStorageError({ kind });
  }, []);

  // Observable copy of the portfolio registry. The storage hook persists the
  // registry inside its switch/create/load flows; it cannot setState here, so we
  // pass `onRegistryChange` (option b) and the hook calls it after every
  // saveRegistry. This keeps the switcher list, empty-state gate, and Projects
  // panel re-rendering without re-reading localStorage on a bump counter.
  // Popouts mirror the main window and never mutate the registry, so an empty
  // initial value is fine there (the empty-state is also gated off for popouts).
  const [registry, setRegistry] = useState<ProjectsRegistry>(() => loadRegistry());

  // Portfolio storage mode. It only changes via the Settings toggle, which
  // persists the new mode and reloads the page, so reading it once at mount is
  // correct. In FILE mode the localStorage ProjectsRegistry drives everything;
  // in TURSO mode the shared DB's `projects` table is the source of truth.
  const [portfolioMode] = useState<PortfolioMode>(loadPortfolioMode());
  const [tursoProjects, setTursoProjects] = useState<ProjectListEntry[]>([]);
  const [tursoArchived, setTursoArchived] = useState<ProjectListEntry[]>([]);
  const [tursoListLoaded, setTursoListLoaded] = useState(false);

  const {
    storageDescription, storageReady, onPickStorageFile, onGrantWriteAccess,
    onOpenStorageFile, onRequestStorageSwitch,
    switchToProject, createProject, createDemoProject, loadProjectFromFile,
    switchToTursoProject, createTursoProject, migrateCurrentProjectToTurso, archiveTursoProject,
    restoreTursoProject, hardDeleteTursoProject, tursoProjectId,
  } =
    useStorageBackend({ settings, lang, hydrated, isPopout, activityLog, setActivityLog, showToast, setStorageConfig: (storageConfig) => setSettings((s) => ({ ...s, storageConfig })), onStorageOutcome: reportStorageOutcome, onRegistryChange: setRegistry });

  // Refresh the Turso project list (active + archived) from the shared DB. The
  // list is the source of truth in Turso mode; this is called on first load and
  // after every create/archive/restore/hard-delete. Only flips `tursoListLoaded`
  // on success so a transient connectivity failure doesn't flash the empty-state.
  // Returns the fetched ACTIVE list (null on failure/not-applicable) so callers
  // like repointAfterRemoval can reuse it instead of fetching it a second time.
  const refreshTursoProjects = useCallback(async (): Promise<ProjectListEntry[] | null> => {
    if (portfolioMode !== "turso") return null;
    const cfg = getTursoConfig(
      settings.integrations?.turso?.databaseUrl,
      settings.integrations?.turso?.authToken,
    );
    if (!cfg) return null;
    try {
      const [active, archived] = await Promise.all([listProjects(cfg), listArchivedProjects(cfg)]);
      setTursoProjects(active);
      setTursoArchived(archived);
      setTursoListLoaded(true);
      reportStorageOutcome(null);
      return active;
    } catch (err) {
      reportStorageOutcome(err);
      // Do NOT set tursoListLoaded on error (avoids a false empty-state).
      return null;
    }
  }, [portfolioMode, settings.integrations?.turso?.databaseUrl, settings.integrations?.turso?.authToken, reportStorageOutcome]);

  useEffect(() => {
    if (!hydrated || portfolioMode !== "turso") return;
    // IIFE so the setState calls inside refreshTursoProjects run in a later
    // microtask (after the first await), never synchronously in the effect body.
    void (async () => {
      await refreshTursoProjects();
    })();
  }, [hydrated, portfolioMode, refreshTursoProjects]);

  // Baseline/variance trend snapshots. Active when the project's data lives in
  // Turso — either the single-DB Turso storage backend (storageConfig.kind) OR
  // turso portfolio mode (Move-to-Turso) — in the main window with recording on.
  const snapshotsCfg = settings.snapshots ?? defaultSnapshotSettings;
  const trendsActive =
    (settings.storageConfig.kind === "turso" || portfolioMode === "turso") &&
    // Require a usable Turso config: storage kind can be "turso" while the URL /
    // token are still unset or quarantined, and snapshot capture must not run
    // (and throw StorageNotReadyError) against a null config.
    tursoConfig !== null &&
    !isPopout && snapshotsCfg.enabled &&
    isModuleEnabled("trends", settings.features);
  const snapshots = useSnapshots({
    active: trendsActive,
    cadence: snapshotsCfg.cadence,
    tursoConfig,
    projectId: portfolioMode === "turso" ? (tursoProjectId ?? "") : "",
    today: new Date(),
    buildContext: () => {
      const model = computeDashboard(
        buildDashboardInput(
          { tasks, raid, budgets, plan, roles, resources, absences, milestones, changes },
          { workdayHours: settings.resources.workdayHours, holidaySet, status, activity: activityLog, today },
        ),
      );
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

  // Aggregate-metric trend directions for the next-actions confidence ranking.
  // Only meaningful when snapshots are recorded (Turso); undefined otherwise.
  const actionTrends = useMemo(
    () => (trendsActive ? computeActionTrends(snapshots.snapshots) : undefined),
    [trendsActive, snapshots.snapshots],
  );

  const raidEnabled = isModuleEnabled("raid", settings.features);
  const changesEnabled = isModuleEnabled("changes", settings.features);
  const stakeholdersEnabled = isModuleEnabled("stakeholders", settings.features);
  const milestonesEnabled = isModuleEnabled("milestones", settings.features);

  const { birthdayDismissed, setBirthdayDismissed } = useBirthdayAlerts({
    hydrated, resources, today, settings, holidaySet, absences, showToast,
  });

  const birthdaySnooze = useReminderSnooze("birthday");
  const jiraTokenSnooze = useReminderSnooze("jiraToken");
  const actionSnooze = useActionSnooze();
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

  const currentProjectId = registry.currentProjectId;
  const currentEntry = getCurrentEntry(registry);
  // Prefer the live in-memory project meta name (set by the active backend's
  // load — file OR turso tenant); fall back to the file registry entry's stored
  // name (file mode only), then null (the switcher shows a "no project" label).
  const currentProjectName =
    project?.name ?? (portfolioMode === "turso" ? null : currentEntry?.name) ?? null;

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

  const nextId = computeNextId(tasks);

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
  } = useResourcePlanner({ lang, today, logActivity, showToast, workdayHours: settings.resources.workdayHours, holidaySet });

  // Change Log CRUD. The hook reads/writes `changes` via WorkspaceProvider.
  const { handleSaveChange, handleDeleteChange } = useChangeLog({ today, logActivity });

  // Stakeholder register / RACI / map CRUD. The hook reads/writes `stakeholders`
  // via WorkspaceProvider; the three panels source `resources`/`milestones` from
  // context inside WorkspaceSection.
  const { stakeholders, handleSaveStakeholder, handleDeleteStakeholder } =
    useStakeholders({ today, logActivity });

  // Save/Apply template wiring for the action cluster. `buildCurrentWorkspace`
  // assembles a Workspace from the live workspace-context collections the same
  // way the app hands one to storage, so the captured template + applied seed
  // match exactly what would be persisted. Features are NOT applied on apply
  // (only fieldVisibility + optional seed); the setters trigger the autosave.
  const { templates: projectTemplates, addTemplate } = useTemplates();
  const buildCurrentWorkspace = useCurrentWorkspace();
  const handleSaveTemplate = useCallback(
    (input: SaveTemplateInput) => {
      addTemplate(
        templateFromWorkspace(buildCurrentWorkspace(), settings.features, input, crypto.randomUUID()),
      );
      showToast("info", t(lang, "templateSaved"));
    },
    [addTemplate, buildCurrentWorkspace, settings.features, showToast, lang],
  );
  const handleApplyTemplate = useCallback(
    (id: string, opts: { includeSeed: boolean }) => {
      const tpl = projectTemplates.find((x) => x.id === id);
      if (!tpl) return;
      const next = applyTemplate(buildCurrentWorkspace(), tpl, opts);
      setFieldVisibility(next.fieldVisibility);
      // Apply the template's functions to the current project too (reactive via
      // useFeaturesSync, persisted via autosave). Filter through ALL_MODULE_IDS so
      // only valid ids in registry order are set — mirrors creation behavior.
      setFeatures(ALL_MODULE_IDS.filter((id) => tpl.features.includes(id)));
      if (opts.includeSeed) {
        setTasks(next.tasks);
        setMilestones(next.milestones ?? []);
        setRaid(next.raid);
        setChanges(next.changes ?? []);
        setStakeholders(next.stakeholders ?? []);
        setBudgets(next.budgets ?? []);
      }
      showToast("info", t(lang, "templateApplied"));
    },
    [projectTemplates, buildCurrentWorkspace, setFieldVisibility, setFeatures, setTasks, setMilestones, setRaid, setChanges, setStakeholders, setBudgets, showToast, lang],
  );

  // Stakeholder-comms reminder items. The banner/modal/toast surfaces moved into
  // the Action Center; `comms.items` still feeds buildActionInput (commsReminders).
  const comms = useStakeholderComms({
    today,
    stakeholders,
    milestones,
    raid,
    changes,
    settings,
    flags: { stakeholdersEnabled, milestonesEnabled, raidEnabled, changesEnabled },
  });

  // Render-scope dashboard model — same args as the snapshot buildContext above,
  // but memoized so nextActions and the dashboard panel share one computation.
  const dashboardModel = useMemo(
    () =>
      computeDashboard(
        buildDashboardInput(
          { tasks, raid, budgets, plan, roles, resources, absences, milestones, changes },
          { workdayHours: settings.resources.workdayHours, holidaySet, status, activity: activityLog, today },
        ),
      ),
    [tasks, raid, budgets, plan, roles, resources, absences, settings.resources.workdayHours, holidaySet, status, activityLog, today, milestones, changes],
  );

  // Pre-computed workload alerts (over-allocated / overload) for the `workload`
  // next-actions provider; computed once on the surface and fed into the engine.
  const workloadAlerts = useMemo(
    () => buildWorkloadAlerts({
      resources, tasks, absences, shifts, raid, plan, today,
      workdayHours: settings.resources.workdayHours, holidaySet,
      overdueThreshold: settings.nextActions?.workloadOverdueThreshold,
      overAllocatedPct: settings.nextActions?.workloadAllocatedPct,
    }),
    [resources, tasks, absences, shifts, raid, plan, today, settings.resources.workdayHours, holidaySet, settings.nextActions],
  );

  // Hoisted so the memo/callbacks can depend on these directly (exhaustive-deps
  // rejects an `obj.member` dep like `learning.bias` / `learning.record`).
  const learnedBias = learning.bias;
  const recordLearning = learning.record;
  // Suggested next-actions engine. Reuses comms.items (already computed above)
  // so we don't run getStakeholderCommsItems a second time.
  const nextActions = useMemo(
    () =>
      computeNextActions(
        buildActionInput({
          tasks,
          raid,
          changes,
          milestones,
          stakeholders,
          steeringCommittee,
          dashboard: dashboardModel,
          commsReminders: comms.items,
          features: settings.features,
          projectName: project?.name ?? "",
          today,
          now: new Date(),
          reminderLeadDays: settings.notifications.reminderLeadDays,
          dueSoonWorkdays: settings.notifications.dueSoonWorkdays,
          raidReviewIntervalDays: settings.notifications.raidReviewIntervalDays,
          scopePendingRed: settings.nextActions?.scopePendingRed,
          scheduleSpiWarn: settings.nextActions?.scheduleSpiWarn,
          scheduleSpiCritical: settings.nextActions?.scheduleSpiCritical,
          workloadAllocatedCritical: settings.nextActions?.workloadAllocatedCritical,
          workloadOverdueUrgent: settings.nextActions?.workloadOverdueUrgent,
          trends: actionTrends,
          clarityBonus: settings.nextActions?.clarityBonus,
          semiClarityBonus: settings.nextActions?.semiClarityBonus,
          staticPenalty: settings.nextActions?.staticPenalty,
          // Due actions stay always-on (core). The RAID review toggle below
          // defaults true and is a safe gate.
          raidReviewEnabled: settings.notifications.raidReview.enabled,
          workloadAlerts,
          dismissed: actionSnooze.dismissed,
          learnedBias,
        }),
      ),
    [tasks, raid, changes, milestones, stakeholders, steeringCommittee, dashboardModel, comms.items, settings.features, settings.notifications, settings.nextActions, project, today, workloadAlerts, actionSnooze.dismissed, actionTrends, learnedBias],
  );
  const nowCount = nextActions.filter((a) => a.tier === "now").length;
  // Stakeholder ids with a pending stakeholder-comms next-action. Feeds the
  // influence/interest matrix's "needs communication" jump-to-Action-Center icon.
  const commsPendingStakeholderIds = useMemo(() => {
    const ids = new Set<number>();
    for (const a of nextActions) {
      if (a.source === "stakeholder-comms" && a.cta.kind === "open") {
        ids.add(Number(a.cta.id));
      }
    }
    return ids;
  }, [nextActions]);
  // Deep-link to the Action Center for this stakeholder (uses the shared
  // requestOpen primitive: switches to the actions view + sets #actions/<id>).
  const jumpToComms = useCallback(
    (stakeholderId: number) => requestOpen("actions", stakeholderId),
    [requestOpen],
  );
  const onJumpToComms = isPopout ? undefined : jumpToComms;
  // Deep-link the Action Center's "Learning is ON/OFF" pill to the Next-actions
  // settings section (where the learning controls live) — not the bare Settings
  // root. The nonce re-fires navigation even on a repeat click.
  const [settingsSectionRequest, setSettingsSectionRequest] = useState<{ id: SettingsSectionId; nonce: number } | undefined>(undefined);
  // Monotonic nonce (a ref, never reset) so each deep-link request is distinct
  // even after the previous one was consumed/cleared — robust whether SettingsView
  // remounts (modern) or stays mounted.
  const settingsSectionNonceRef = useRef(0);
  const onOpenSettingsSection = useCallback((id: SettingsSectionId) => {
    settingsSectionNonceRef.current += 1;
    setSettingsSectionRequest({ id, nonce: settingsSectionNonceRef.current });
    setActiveTab("settings");
  }, [setActiveTab]);
  const onOpenLearningSettings = useCallback(() => onOpenSettingsSection("nextActions"), [onOpenSettingsSection]);
  const clearSettingsSectionRequest = useCallback(() => setSettingsSectionRequest(undefined), []);
  const openAction = useCallback(
    (a: SuggestedAction) => {
      if (a.cta.kind === "open") requestOpen(a.cta.view, Number(a.cta.id));
    },
    [requestOpen],
  );
  const openActionCenter = useCallback(() => {
    if (typeof window !== "undefined") window.focus();
    setActiveTab("open-points");
  }, [setActiveTab]);

  // Action Center "Analyze with AI": one forced-tool Anthropic call (no agentic
  // loop). Reuses the live in-memory key; surfaced via the aiAnalysisBundle prop.
  const actionAnalysis = useActionAnalysis({
    apiKey: aiKeyIfEnabled(settings.ai),
    model: settings.ai?.model ?? "claude-sonnet-4-6",
  });
  // Hoisted member reads (exhaustive-deps rejects `obj.member` deps; the hook
  // returns a fresh object each render so depending on the whole thing defeats
  // every downstream memo).
  const aiAnalyze = actionAnalysis.analyze;
  const groundingIndex = useMemo(
    () => buildGroundingIndex({ tasks, raid, milestones, changes, stakeholders }),
    [tasks, raid, milestones, changes, stakeholders],
  );
  // Shared workspace digest builder — used by the Action Center "Analyze with
  // AI" button AND the SP5 scheduled-job runner (both feed the same SP4 call).
  const buildAiContext = useCallback(
    () =>
      buildAnalysisContext({
        projectName: project?.name ?? "",
        today,
        mode: deriveMode(settings.features),
        enabledModules: settings.features,
        taskCount: tasks.length,
        tasks: tasks.map((x) => ({ id: x.id, title: x.taskName })),
        raid: raid.map((x) => ({ id: x.id, title: x.title })),
        milestones: milestones.map((x) => ({ id: x.id, title: x.name })),
        changes: changes.map((x) => ({ id: x.id, title: x.title })),
        stakeholders: stakeholders.map((x) => ({ id: x.id, name: x.name })),
        queue: nextActions.map((a) => ({
          title: t(lang, a.title.key, ...(a.title.params ?? [])),
          why: t(lang, a.why.key, ...(a.why.params ?? [])),
          tier: a.tier,
        })),
      }),
    [project, today, settings.features, tasks, raid, milestones, changes, stakeholders, nextActions, lang],
  );
  const runActionAnalysis = useCallback(() => {
    void aiAnalyze(buildAiContext());
  }, [aiAnalyze, buildAiContext]);
  // SP-C: compact, token-bounded context for the AI weight-suggestion call.
  // The workspace digest is reused from the SP4/SP5 builder; the learning
  // summary is one line per signal kind (act/snooze/dismiss counts). Trends
  // are a compact direction summary of the live snapshot trends when active
  // (Turso); otherwise a "(no snapshots)" sentinel.
  const learningState = learning.state;
  const learningEnabled = (settings.nextActionsLearning ?? defaultNextActionsLearning).enabled;
  const buildWeightSuggestionContext = useCallback(
    (scope: SuggestionScope) => {
      const kinds = Object.entries(learningState);
      const learningSummary = !learningEnabled
        ? "(learning disabled)"
        : kinds.length === 0
          ? "(no history)"
          : kinds
              .slice(0, MAX_LEARNING_SUMMARY_ENTRIES)
              .map(([kind, s]) => `- ${kind}: acted ${s.acted}, snoozed ${s.snoozed}, dismissed ${s.dismissed}`)
              .join("\n");
      return buildSuggestionContext({
        workspaceDigest: buildAiContext(),
        current: resolveNextActionsConfig(settings.nextActions),
        scope,
        learning: learningSummary,
        trends: trendsActive && actionTrends ? summarizeTrendsForPrompt(actionTrends) : "(no snapshots)",
        learningEnabled,
      });
    },
    [buildAiContext, settings.nextActions, learningState, learningEnabled, trendsActive, actionTrends],
  );
  const onActAi = useCallback(
    (a: AiAction) => {
      const g = groundEntity(a.entity, groundingIndex);
      if (g) requestOpen(g.view as AppView, g.id);
      else requestChat(`${a.title}\n\n${a.why}`, true);
    },
    [groundingIndex, requestOpen, requestChat],
  );
  // Hoisted member reads (exhaustive-deps rejects `obj.member` deps).
  const aiClear = actionAnalysis.clear;
  const aiCancel = actionAnalysis.cancel;
  const aiBusy = actionAnalysis.busy;
  const aiError = actionAnalysis.error;
  const aiResult = actionAnalysis.result;
  const aiEnabled = isAiEnabled(settings.ai) && settings.ai?.actionSuggestions !== false;
  const aiAnalysisBundle = useMemo(
    () => ({ enabled: aiEnabled, busy: aiBusy, error: aiError, result: aiResult, onAnalyze: runActionAnalysis, onCancel: aiCancel, onClear: aiClear, onActAi }),
    [aiEnabled, aiBusy, aiError, aiResult, runActionAnalysis, aiCancel, aiClear, onActAi],
  );

  useActionNotifications({
    actions: nextActions,
    enabled: settings.notifications.desktopUrgent.enabled,
    isPopout,
    lang,
    requestOpen,
    openActionCenter,
  });

  // SP5 scheduled jobs: recurring advisory analysis runs (due-on-open / tick).
  // Opt-in (default OFF), key required, never in popouts. Reuses the SP4
  // context builder + analysis call; results surface as a desktop notification
  // and in the Settings "Scheduled jobs" run history.
  const scheduledJobs = useScheduledJobs({ config: tursoConfig });
  const notifyScheduledJob = useCallback(
    (jobName: string, summary: string) => {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      try {
        new Notification(t(lang, "scheduledJobNotifyTitle", jobName), {
          body: t(lang, "scheduledJobNotifyBody", summary),
        });
      } catch {
        /* notification fire is best-effort */
      }
    },
    [lang],
  );
  useScheduledJobRunner({
    enabled: !isPopout && isAiEnabled(settings.ai) && settings.ai?.scheduledJobs === true,
    jobs: scheduledJobs.jobs,
    recordRun: scheduledJobs.recordRun,
    buildContext: buildAiContext,
    ai: { apiKey: aiKeyIfEnabled(settings.ai), model: settings.ai?.model ?? "claude-sonnet-4-6" },
    notify: notifyScheduledJob,
  });

  const snoozeAction = useCallback(
    (a: SuggestedAction, ms: number) => { void recordLearning(a, "snoozed"); actionSnooze.snooze(a.id, ms); },
    [actionSnooze, recordLearning],
  );

  // Lazily serialize the CURRENT workspace for a version-history capture. Same
  // field set the export handler and save effect use. Placed after the
  // stakeholders hook so all referenced values are in scope.
  const getVersionPayload = useCallback(
    () => workspaceToJson({
      tasks, raid, absences, shifts, resources, roles, disciplines, grades,
      plan, budgets, fxRates, status, project, milestones, changes, stakeholders,
    }),
    [tasks, raid, absences, shifts, resources, roles, disciplines, grades,
     plan, budgets, fxRates, status, project, milestones, changes, stakeholders],
  );

  // Fan a restored workspace into every setter (mirrors use-storage-backend's
  // applyWorkspace). Used by selective version restore to apply the new state.
  const applyRestoredWorkspace = useCallback((w: Workspace) => {
    setTasks(w.tasks ?? []); setRaid(w.raid ?? []); setAbsences(w.absences ?? []); setShifts(w.shifts ?? []);
    setResources(w.resources ?? []); setRoles(w.roles ?? []); setDisciplines(w.disciplines ?? []); setGrades(w.grades ?? []);
    if (w.plan) setPlan(w.plan); setBudgets(w.budgets ?? []); setFxRates(w.fxRates ?? null); setStatus(w.status ?? {});
    setProject(w.project); setMilestones(w.milestones ?? []); setChanges(w.changes ?? []); setStakeholders(w.stakeholders ?? []);
    setSteeringCommittee(w.steeringCommittee);
  }, [setTasks, setRaid, setAbsences, setShifts, setResources, setRoles, setDisciplines, setGrades, setPlan, setBudgets, setFxRates, setStatus, setProject, setMilestones, setChanges, setStakeholders, setSteeringCommittee]);

  // Guided tour (SP-F): modern-shell, non-popout only. Auto-launches once for a
  // first-run user; re-launchable from the Help panel. State lives above the
  // view so it survives the view remount that the modern shell performs.
  const tour = useTour({
    layout: settings.layout,
    isPopout,
    hydrated,
    tourSeen: settings.tourSeen,
    completedTours: settings.completedTours,
    features: settings.features,
    setSettings,
  });
  const startTour = tour.start;

  // Load the curated sample workspace as a REAL, deletable demo project and kick
  // off the tour. The CTA is empty-state-only (no real project to clobber), so
  // registering it is safe; registering is also what flips the empty-state gate
  // off so the views + tour overlay actually mount. Errors toast, never crash.
  const loadDemo = useCallback(async () => {
    try {
      const mod = await import("../../sample-workspace-small.json");
      const ws = jsonToWorkspace(
        JSON.stringify((mod as { default?: unknown }).default ?? mod),
      );
      await createDemoProject(ws);
      startTour();
    } catch {
      showToast("error", t(lang, "tourDemoError"));
    }
  }, [createDemoProject, startTour, showToast, lang]);

  // Stable onError so useVersionHistory's `refresh` callback keeps a stable
  // identity — an inline arrow here re-creates refresh every render, re-running
  // its effect and (on the Turso path) re-fetching the version list on every
  // render. See use-version-history.ts for the matching inactive-path guard.
  const handleVersionError = useCallback(
    (err: unknown) => {
      // Mirror the snapshot hook: connectivity/auth failures surface as the
      // sticky banner (via reportStorageOutcome → tursoErrorKind); any other
      // capture failure toasts rather than being silently swallowed. Version
      // capture is best-effort and never blocks the main save.
      reportStorageOutcome(err);
      if (!tursoErrorKind(err)) showToast("error", t(lang, "storageSaveFailed", String(err)));
    },
    [reportStorageOutcome, showToast, lang],
  );

  // Version history. Turso-only, main-window-only; the hook is inert otherwise.
  const versionHistory = useVersionHistory({
    config: tursoConfig,
    projectId: portfolioMode === "turso" ? (tursoProjectId ?? "") : "",
    enabled: settings.storageConfig.kind === "turso" && !isPopout && isModuleEnabled("history", settings.features),
    idleMs: VERSION_IDLE_MS,
    retention: settings.versionHistoryRetention ?? DEFAULT_VERSION_RETENTION,
    getPayload: getVersionPayload,
    applyWorkspace: applyRestoredWorkspace,
    logActivity,
    onError: handleVersionError,
  });
  useEffect(() => { versionNotifyRef.current = versionHistory.notifySaved; }, [versionHistory.notifySaved]);

  const [fillTaskAssigneeOnSave, setFillTaskAssigneeOnSave] = useState(false);

  const handleAddAssigneeToAddressBook = useCallback((name: string, email: string) => {
    const { firstName, lastName } = splitName(name);
    setFillTaskAssigneeOnSave(true);
    handleOpenAddResource({ firstName, lastName, email: email.trim() || undefined });
  }, [handleOpenAddResource]);

  const handleCreateResource = useCallback(
    (name: string, email: string): number => {
      const { firstName, lastName } = splitName(name);
      const id = computeNextId(resources);
      // Mirror handleSaveResource's new-resource commit: stamp localModifiedAt
      // (change-tracking / Turso sync) and log resource.created for activity-log
      // completeness — a picker-created person must behave like a Resources-view one.
      setResources((prev) => [
        ...prev,
        { id, firstName, lastName, email: email.trim() || undefined, roleId: null, utilizationMode: "percent", utilization: {}, localModifiedAt: new Date().toISOString() },
      ]);
      logActivity("resource.created", id, `${firstName} ${lastName}`.trim());
      return id;
    },
    [resources, setResources, logActivity],
  );

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
  const commSend = useCommSend({ mode: settings.commTemplateSendMode ?? "mailto", msAuth, lang, showToast });
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
  const pendingLinkRaidIdRef = useRef<number | null>(null);
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
    raid,
    setRaid,
    pendingLinkRaidIdRef,
  });

  // Deep-link: when a suggested-action chip requests opening a task, open its
  // edit modal once and clear the pending signal so it does not re-fire.
  useEffect(() => {
    if (pendingOpen?.view !== "open-points") return;
    const task = tasks.find((t) => t.id === pendingOpen.id);
    if (task) {
      if (useEditView) flashOnEditReturnRef.current = task.id;
      openEditModal(task);
    }
    clearPendingOpen();
  }, [pendingOpen, tasks, openEditModal, clearPendingOpen, useEditView]);

  const commTemplatesActive = tursoConfig !== null && !isPopout;
  const commTemplates = useCommTemplates({ active: commTemplatesActive, config: tursoConfig });
  const operatingGuides = useOperatingGuides({ config: tursoConfig });
  // Stable callback (its own useCallback) — depend on this, not the whole hook
  // object, so consumers don't re-create on every render.
  const resolveCommBody = commTemplates.resolveTemplateBody;

  const {
    expandedNotes,
    pushingIds,
    onToggleNoteExpanded,
    onJumpToRaid,
    onToggleComplete,
    onSendInquiry,
    onPushToJira,
    onStatusChange,
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
    resolveTemplateBody: resolveCommBody,
    sendCommTemplate: commSend.send,
  });

  // Action-Center CTA handlers (assign / create-task / mark-done / clear-blocker
  // / draft-message / escalate / rebaseline / reschedule) extracted to
  // useActionCenterHandlers. Called AFTER useTaskRowHandlers because
  // draft-message reads onSendInquiry. Same names as the former inline defs.
  const {
    assignOwnerBundle,
    handleCreateTaskFromAction,
    handleMarkDoneFromAction,
    handleClearBlockerFromAction,
    handleDraftMessageFromAction,
    escalateBundle,
    rebaselineBundle,
    rescheduleBundle,
  } = useActionCenterHandlers({
    isPopout,
    lang,
    today,
    resources,
    tasks,
    stakeholders,
    raid,
    milestones,
    project,
    trendsActive,
    snapshots,
    commSend,
    onSendInquiry,
    resolveCommBody,
    handleCreateResource,
    handleCancelEdit,
    setForm,
    setTaskModalOpen,
    setTasks,
    setRaid,
    setMilestones,
    pendingLinkRaidIdRef,
    recordLearning,
    showToast,
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

  const birthdayItems = useMemo(
    () => settings.notifications.birthday.enabled
      ? getUpcomingBirthdays(resources, today, effectiveLeadDays(settings.notifications, "birthday"), holidaySet, absences)
      : [],
    [resources, settings.notifications, today, holidaySet, absences],
  );

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

  const shiftExistingAssigneeKeys = useMemo(
    () =>
      new Set(
        shifts
          .filter((s) => editingShift === null || s.id !== editingShift.shift.id)
          .map((s) => s.assignee.trim().toLowerCase()),
      ),
    [shifts, editingShift],
  );

  const dispatcher = useChatDispatcher({
    settings,
    today,
    setSelectedIds,
    setSettings,
    isReadOnly: isPopout,
    currentView: activeTab,
  });

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

  // Empty-state "Load from file": in Turso mode this also flips the portfolio to
  // file mode (loadProjectFromFile persists the switch + reloads on success), so
  // the loaded project is reachable instead of being re-hidden by the Turso
  // empty-state gate. In file mode it is the plain picker.
  const handleLoadFromFileEmptyState = useCallback(() => {
    void loadProjectFromFile(
      undefined,
      portfolioMode === "turso" ? { switchPortfolioToFileOnSuccess: true } : undefined,
    );
  }, [loadProjectFromFile, portfolioMode]);

  // Empty-state "Restore an archived project": un-archive, refresh the list, and
  // switch to it. The archived project's workspace is still in memory (archive
  // doesn't clear it), so restoring the last-active id needs no reload; restoring
  // a different archived id loads it via switchToTursoProject. Each callee surfaces
  // its own error toast.
  const handleRestoreFromEmptyState = useCallback((id: string) => {
    void (async () => {
      await restoreTursoProject(id);
      await refreshTursoProjects();
      await switchToTursoProject(id);
    })();
  }, [restoreTursoProject, refreshTursoProjects, switchToTursoProject]);

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
      // Persist + update the observable copy; a failed localStorage write
      // (quota / disabled) is surfaced as a toast — the in-memory list stays
      // consistent for this session, only reload persistence is at risk.
      const persist = (reg: ProjectsRegistry) => {
        if (!saveRegistry(reg)) {
          showToast("error", t(lang, "projectsRegistrySaveFailed"));
        }
        setRegistry(reg);
      };
      const survivor = next.currentProjectId;
      if (wasCurrent && survivor) {
        persist({ ...next, currentProjectId: null });
        void switchToProject(survivor);
      } else {
        // Deleted a non-current project (or none remain). Persist as-is; if none
        // remain the empty-state takes over on the next render.
        persist(next);
      }
    },
    [registry, switchToProject, lang, showToast],
  );

  // --- Mode-aware portfolio derivations + handlers --------------------------
  //
  // FILE mode reads the localStorage registry; TURSO mode maps the shared DB's
  // project-list rows into the SAME ProjectRegistryEntry shape the UI expects.

  const portfolioProjects: ProjectRegistryEntry[] =
    portfolioMode === "turso"
      ? tursoProjects.map((e) => ({
          id: e.id,
          name: e.meta.name,
          code: e.meta.code,
          storageConfig: { kind: "turso" as const },
        }))
      : registry.projects;
  const portfolioArchived: ProjectRegistryEntry[] =
    portfolioMode === "turso"
      ? tursoArchived.map((e) => ({
          id: e.id,
          name: e.meta.name,
          code: e.meta.code,
          storageConfig: { kind: "turso" as const },
        }))
      : [];
  const portfolioCurrentId =
    portfolioMode === "turso" ? tursoProjectId : currentProjectId;

  // Switch — same navigation target ("New project" → projects view) in both
  // modes; the switch itself routes to the active backend's handler.
  const handleSwitchProjectByMode = useCallback(
    (id: string) =>
      portfolioMode === "turso" ? void switchToTursoProject(id) : void switchToProject(id),
    [portfolioMode, switchToTursoProject, switchToProject],
  );

  // Create / update-meta / archive / restore / hard-delete — extracted to
  // use-turso-projects.ts, which also surfaces failed Turso operations as
  // error toasts (they used to vanish silently).
  const {
    handleCreateProjectByMode,
    handleUpdateCurrentProjectByMode,
    handleArchiveTursoProject,
    handleRestoreTursoProject,
    handleHardDeleteTursoProject,
  } = useTursoProjects({
    portfolioMode,
    lang,
    showToast,
    tursoDatabaseUrl: settings.integrations?.turso?.databaseUrl,
    tursoAuthToken: settings.integrations?.turso?.authToken,
    tursoProjectId,
    switchToTursoProject,
    createTursoProject,
    archiveTursoProject,
    restoreTursoProject,
    hardDeleteTursoProject,
    refreshTursoProjects,
    setProject,
    createFileProject: createProject,
    updateCurrentFileProject: handleUpdateCurrentProject,
  });

  const editingTask =
    editingId !== null
      ? tasks.find((row) => row.id === editingId) ?? null
      : null;
  const editingIsJiraLinked = !!editingTask?.jiraKey;

  const editingReadOnlyJiraProjectName = (() => {
    if (!editingTask?.jiraKey) return undefined;
    if (!isReadOnlyIssue(editingTask.jiraKey, settings.jira)) return undefined;
    const proj = jiraProjectKeyOf(editingTask.jiraKey);
    const extra = (settings.jira.extraProjects ?? []).find((p) => p.key === proj);
    return extra?.name || extra?.key || proj;
  })();

  // Render gate: hold first paint until the active-language dictionary is
  // in memory. Lifts in the next microtask for en-US/en-GB (no fetch);
  // briefly delays initial paint for de while ./i18n.de loads. Must come
  // AFTER every hook so the rules-of-hooks invariant holds.
  const guardEdit = makeEditGuard(isPopout, () =>
    showToast("info", t(lang, "popoutReadOnly")),
  );

  const filteredNavGroups = useMemo(
    () => filterNavGroups(settings.features, settings.storageConfig.kind),
    [settings.features, settings.storageConfig.kind],
  );

  const appMode = useMemo(() => deriveMode(settings.features), [settings.features]);

  const voiceHandlers = useMemo(
    () => (isPopout ? null : { onCommand: handleCommand, onError: (msg: string) => showToast("error", msg) }),
    [isPopout, handleCommand, showToast],
  );

  // All Outlook calendar write-back (push/pull/background auto-sync) for
  // milestones, the steering committee, and the four two-way entities lives in
  // useCalendarIntegrations (extracted). Called unconditionally; returns the
  // same names the block declared inline, so downstream wiring is unchanged.
  const {
    calendarProjectId,
    calendarPushEnabled,
    calendarPushToOutlook,
    calendarPushBusy,
    calendarPull,
    committeePush,
    pushableRaid,
    pushableChanges,
    pushableAbsences,
    calendarRaidEnabled,
    onToggleCalendarRaid,
    pushRaidToOutlook,
    calendarRaidPushBusy,
    raidPull,
    calendarChangeEnabled,
    onToggleCalendarChange,
    pushChangeToOutlook,
    calendarChangePushBusy,
    changePull,
    calendarAbsenceEnabled,
    onToggleCalendarAbsence,
    pushAbsenceToOutlook,
    calendarAbsencePushBusy,
    absencePull,
  } = useCalendarIntegrations({
    isPopout,
    settings,
    m365Enabled,
    portfolioCurrentId,
    project,
    lang,
    today,
    logActivity,
    setSettings,
    milestones,
    setMilestones,
    steeringCommittee,
    setSteeringCommittee,
    tasks,
    setTasks,
    raid,
    setRaid,
    changes,
    setChanges,
    absences,
    setAbsences,
  });

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
    handleGanttBarUpdate: guardEdit(handleGanttBarUpdate),
    handleCancelEdit,
    setTaskModalOpen,
    contactsList,
    onCreateResource: handleCreateResource,
    handleClearRaidTaskFilter,
    handleSaveRaidItem: guardEdit(handleSaveRaidItem),
    handleDeleteRaidItem: guardEdit(handleDeleteRaidItem),
    m365Configured: m365Enabled,
    calendarRaidEnabled,
    onToggleCalendarRaid,
    pushRaidToOutlook,
    calendarRaidPushBusy,
    pullRaidFromOutlook: calendarRaidEnabled ? raidPull.pull : undefined,
    calendarRaidPullBusy: calendarRaidEnabled ? raidPull.busy : undefined,
    calendarChangeEnabled,
    onToggleCalendarChange,
    pushChangeToOutlook,
    calendarChangePushBusy,
    pullChangeFromOutlook: calendarChangeEnabled ? changePull.pull : undefined,
    calendarChangePullBusy: calendarChangeEnabled ? changePull.busy : undefined,
    calendarAbsenceEnabled,
    onToggleCalendarAbsence,
    pushAbsenceToOutlook,
    calendarAbsencePushBusy,
    pullAbsenceFromOutlook: calendarAbsenceEnabled ? absencePull.pull : undefined,
    calendarAbsencePullBusy: calendarAbsenceEnabled ? absencePull.busy : undefined,
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
        currency={plan.currency || "EUR"}
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
    versionHistory,
    // Multi-project (Projects view). Mutating callbacks are no-ops in popouts
    // (the hook's project functions early-return on isPopout); the panel still
    // renders read-only there, matching how other panels behave. Mode-aware: in
    // turso mode the list/current id come from the shared DB and the destructive
    // action is Archive (with Restore/Hard-delete on archived rows).
    mode: portfolioMode,
    projects: portfolioProjects,
    currentProjectId: portfolioCurrentId,
    currentProject: project,
    archivedProjects: portfolioArchived,
    projectStakeholderNames: stakeholders.map((s) => s.name),
    projectAddressBook: contactsList,
    projectResources: resources,
    projectSettings: settings,
    onChangeProjectSettings: (next: Settings) => setSettings(() => next),
    onSwitchProject: handleSwitchProjectByMode,
    onCreateProject: handleCreateProjectByMode,
    onUpdateCurrentProject: handleUpdateCurrentProjectByMode,
    onDeleteProject: handleDeleteProject,
    onExportCurrentProject: handleExportCurrentProject,
    onLoadProjectFromFile: () => { void loadProjectFromFile(); },
    onMigrateProjectToTurso: () => { void migrateCurrentProjectToTurso(); },
    onArchiveProject: handleArchiveTursoProject,
    onRestoreProject: handleRestoreTursoProject,
    onHardDeleteProject: handleHardDeleteTursoProject,
    nextActions,
    onOpenAction: openAction,
    onSnooze: snoozeAction,
    onCreateTask: isPopout ? undefined : handleCreateTaskFromAction,
    onDraftMessage: isPopout ? undefined : handleDraftMessageFromAction,
    commsPendingStakeholderIds,
    onJumpToComms,
    assignOwner: assignOwnerBundle,
    escalate: escalateBundle,
    rebaseline: rebaselineBundle,
    reschedule: rescheduleBundle,
    onMarkDone: isPopout ? undefined : handleMarkDoneFromAction,
    onClearBlocker: isPopout ? undefined : handleClearBlockerFromAction,
    learningEnabled: settings.nextActionsLearning?.enabled ?? false,
    expertMode: settings.expertMode === true,
    onOpenLearningSettings,
    onOpenSettingsSection: isPopout ? undefined : onOpenSettingsSection,
    onStartTour: settings.layout === "modern" && !isPopout ? tour.start : undefined,
    catalogTours: tour.catalogTours,
    completedTours: tour.completedTours,
    aiAnalysis: isPopout ? undefined : aiAnalysisBundle,
    onPushMilestonesToOutlook: calendarPushEnabled ? calendarPushToOutlook : undefined,
    calendarPushBusy: calendarPushEnabled ? calendarPushBusy : undefined,
    onPullMilestonesFromOutlook: calendarPushEnabled ? calendarPull.pull : undefined,
    calendarPullBusy: calendarPushEnabled ? calendarPull.busy : undefined,
    committeeOutlookPush:
      calendarPushEnabled && !isPopout
        ? { onPush: committeePush.pushToOutlook, busy: committeePush.busy }
        : undefined,
    guides: operatingGuides.guides,
    guidesReady: operatingGuides.ready,
  };

  const workspaceEl = <WorkspaceSection {...workspaceProps} />;
  const workspaceFullBleedEl = <WorkspaceSection {...workspaceProps} fullBleed />;

  const tasksSectionEl = (
    <TasksSection
      lang={lang}
      today={today}
      fillHeight={settings.layout === "modern"}
      nextActions={nextActions}
      onOpenAction={openAction}
      onShowActions={() => setActiveTab("actions")}
      showViewHints={settings.showViewHints !== false}
      isPopout={isPopout}
      onLearnMoreHint={requestHelpConcept}
      projectId={calendarProjectId}
      m365Configured={m365Enabled}
      jiraSiteUrl={settings.jira.siteUrl}
      jiraExtraProjects={settings.jira.extraProjects ?? []}
      onToggleSelect={onToggleSelect}
      onToggleNoteExpanded={onToggleNoteExpanded}
      onJumpToRaid={onJumpToRaid}
      onToggleComplete={onToggleComplete}
      onSendInquiry={onSendInquiry}
      onPushToJira={onPushToJira}
      onStatusChange={onStatusChange}
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

  // Send inquiry / Push to Jira — only for an EXISTING task, never in popouts
  // (read-only). Push is additionally hidden for unconfigured Jira or an
  // already-synced task. Shared by the modern TaskEditView footer and the
  // classic TaskFormModal (threaded as leadingActions).
  const editorActions =
    editingTask && !isPopout ? (
      <TaskEditorActions
        lang={lang}
        task={editingTask}
        jiraConfigured={settings.jira.enabled && !!settings.jira.projectKey}
        onSendInquiry={onSendInquiry}
        onPushToJira={(id) => {
          void onPushToJira(id);
        }}
      />
    ) : null;

  // Delete button — left side of footer, only for an EXISTING task, never in popouts.
  const editorDeleteAction =
    editingTask && !isPopout ? (
      <TaskDeleteButton lang={lang} taskId={editingTask.id} onDelete={onDelete} />
    ) : null;

  const editActions = (
    <>
      {editorActions}
      {editingIsJiraLinked && settings.jira.enabled && (
        <button
          type="button"
          onClick={() => { void handleJiraSync(); }}
          disabled={jiraSyncing}
          className="rounded-md border border-line bg-surface px-4 py-1.5 text-sm font-medium text-AIPM-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 dark:border-line dark:bg-surface dark:text-AIPM-light-grey dark:hover:bg-surface-muted"
        >
          {t(lang, jiraSyncing ? "jiraSyncing" : "jiraSync")}
        </button>
      )}
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
        className="rounded-md bg-AIPM-green px-4 py-1.5 text-sm font-semibold text-AIPM-dark-blue hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-AIPM-green disabled:cursor-not-allowed disabled:opacity-50"
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
      resources={resources}
      onCreateResource={handleCreateResource}
      absences={absences}
      tasksForDeps={tasks}
      uniqueGroups={uniqueGroups}
      uniqueLabels={uniqueLabels}
      editingIsJiraLinked={editingIsJiraLinked}
      readOnlyJiraProjectName={editingReadOnlyJiraProjectName}
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
      heading={editingId !== null ? t(lang, "taskEditTitle") : t(lang, "tabNewTask")}
      onClose={handleCancelEdit}
      footer={editActions}
      footerLeading={editorDeleteAction}
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
      onMigrateToTurso={() => { void migrateCurrentProjectToTurso(); }}
      commTemplatesEnabled={commTemplatesActive}
      commTemplates={commTemplates}
      commTemplatesConfig={tursoConfig}
      scheduledJobsConfig={tursoConfig}
      operatingGuides={operatingGuides}
      learningConfig={settings.nextActionsLearning ?? defaultNextActionsLearning}
      buildWeightSuggestionContext={isPopout ? undefined : buildWeightSuggestionContext}
      onChangeLearningConfig={isPopout ? undefined : (c) => setSettings((s) => ({ ...s, nextActionsLearning: c }))}
      onResetLearning={isPopout ? undefined : () => { void learning.reset(); }}
      onOpenInsights={isPopout ? undefined : () => setActiveTab("learning-insights")}
      requestSection={settingsSectionRequest}
      onSectionConsumed={clearSettingsSectionRequest}
      isPopout={isPopout}
    />
  );

  const learningInsightsEl = (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => setActiveTab("settings")}
        className="self-start rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted"
      >
        {t(lang, "wizardBack")}
      </button>
      <LearningInsights
        lang={lang}
        state={learning.state}
        overrides={learning.overrides}
        onSetOverride={(kind, override) => { void learning.setOverride(kind, override); }}
        onReset={() => { void learning.reset(); }}
      />
    </div>
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
        projects: portfolioProjects,
        currentProjectId: portfolioCurrentId,
        lang,
        mode: portfolioMode,
        onSwitch: handleSwitchProjectByMode,
        onLoadFromFile: () => { void loadProjectFromFile(); },
        onNew: handleNewProject,
        dataTourId: TOUR_ANCHORS.projectSwitcher,
      };

  // Ask-Claude pill. In the modern layout it sits in the TopBar's LEFT cluster
  // beside the project switcher (passed as projectSwitcherTrailing); the classic
  // AppHeader wires its own copy beside the switcher under the title. Both sites
  // must render it (dual-header rule) or it disappears in whichever layout is missed.
  const askClaudeEl = (
    <span data-tour-id={TOUR_ANCHORS.askClaude}>
      <AskClaudeMenu
        lang={lang}
        currentView={activeTab}
        onAsk={(body) => requestChat(body, true)}
      />
    </span>
  );

  // Session display-timezone switcher. Sits in both header sites alongside the
  // Ask-Claude pill (dual-header rule); never in popouts (they have no header).
  const displayTzSwitcherEl = settings.showDisplayTzSwitcher ? (
    <DisplayTzSwitcherConnected lang={lang} additionalTimezones={settings.additionalTimezones ?? []} />
  ) : null;

  const topBarMenus = (
    <>
      {displayTzSwitcherEl}
      <ActionMenus
        lang={lang}
        onCommand={handleCommand}
        onVoiceError={(msg) => showToast("error", msg)}
        exportConfig={settings.export ?? defaultExportConfig}
        templates={projectTemplates}
        onSaveTemplate={handleSaveTemplate}
        onApplyTemplate={handleApplyTemplate}
        expertMode={settings.expertMode}
      />
    </>
  );

  // The Birthday / Jira-token / Storage reminder banners, shared by the classic
  // tree (rendered after AppHeader) and the modern tree (ModernShell `banners`
  // slot). Due / RAID-review / stakeholder-comms nudges moved into the Action
  // Center. Gates kept verbatim — popouts (`!isPopout`) still suppress these.
  const bannersEl = (
    <>
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
    </>
  );

  const modalsBlock = (
    <>
      {(() => {
        const plan = calendarPull.result?.plan;
        if (!plan) return null;
        const nameOf = (id: number) => milestones.find((m) => m.id === id)?.name ?? String(id);
        return (
          <CalendarPullSummaryModal
            lang={lang}
            open={!!calendarPull.result}
            onClose={calendarPull.clearResult}
            applied={plan.applies.map((a) => ({ id: a.id, name: nameOf(a.id), newDate: a.newDate }))}
            conflicts={plan.conflicts.map((c) => ({ id: c.id, eventId: c.eventId, name: nameOf(c.id), appDate: c.appDate, outlookDate: c.outlookDate }))}
            deletions={plan.deletions.map((d) => ({ id: d.id, name: nameOf(d.id) }))}
            onKeepApp={calendarPull.keepApp}
            onTakeOutlook={(c) => calendarPull.applyMove(c.id, c.eventId, c.outlookDate)}
          />
        );
      })()}
      {(() => {
        const plan = raidPull.result?.plan;
        if (!plan) return null;
        const nameOf = (id: number) => pushableRaid.find((x) => x.id === id)?.title ?? String(id);
        return (
          <CalendarPullSummaryModal
            lang={lang}
            open={!!raidPull.result}
            onClose={raidPull.clearResult}
            applied={plan.applies.map((a) => ({ id: a.id, name: nameOf(a.id), newDate: a.newDate }))}
            conflicts={plan.conflicts.map((c) => ({ id: c.id, eventId: c.eventId, name: nameOf(c.id), appDate: c.appDate, outlookDate: c.outlookDate }))}
            deletions={plan.deletions.map((d) => ({ id: d.id, name: nameOf(d.id) }))}
            onKeepApp={raidPull.keepApp}
            onTakeOutlook={(c) => raidPull.applyMove(c.id, c.eventId, c.outlookDate)}
          />
        );
      })()}
      {(() => {
        const plan = changePull.result?.plan;
        if (!plan) return null;
        const nameOf = (id: number) => pushableChanges.find((x) => x.id === id)?.title ?? String(id);
        return (
          <CalendarPullSummaryModal
            lang={lang}
            open={!!changePull.result}
            onClose={changePull.clearResult}
            applied={plan.applies.map((a) => ({ id: a.id, name: nameOf(a.id), newDate: a.newDate }))}
            conflicts={plan.conflicts.map((c) => ({ id: c.id, eventId: c.eventId, name: nameOf(c.id), appDate: c.appDate, outlookDate: c.outlookDate }))}
            deletions={plan.deletions.map((d) => ({ id: d.id, name: nameOf(d.id) }))}
            onKeepApp={changePull.keepApp}
            onTakeOutlook={(c) => changePull.applyMove(c.id, c.eventId, c.outlookDate)}
          />
        );
      })()}
      {(() => {
        const plan = absencePull.result?.plan;
        if (!plan) return null;
        const nameOf = (id: number) => {
          const a = pushableAbsences.find((x) => x.id === id);
          // Include startDate so two same-type absences for the same person get
          // a row-UNIQUE accessible name in the conflict list (WCAG 2.4.6).
          return a ? `${a.assignee} (${a.type}) – ${a.startDate}` : String(id);
        };
        return (
          <CalendarPullSummaryModal
            lang={lang}
            open={!!absencePull.result}
            onClose={absencePull.clearResult}
            applied={plan.applies.map((a) => ({ id: a.id, name: nameOf(a.id), newDate: a.newDate, newEndDate: a.newEndDate }))}
            conflicts={plan.conflicts.map((c) => ({ id: c.id, eventId: c.eventId, name: nameOf(c.id), appDate: c.appDate, outlookDate: c.outlookDate, appEndDate: c.appEndDate, outlookEndDate: c.outlookEndDate }))}
            deletions={plan.deletions.map((d) => ({ id: d.id, name: nameOf(d.id) }))}
            onKeepApp={absencePull.keepApp}
            onTakeOutlook={(c) => absencePull.applyMove(c.id, c.eventId, c.outlookDate, c.outlookEndDate)}
          />
        );
      })()}
      <CommSendPreviewModal
        open={commSend.previewModal.open}
        req={commSend.previewModal.req}
        busy={commSend.previewModal.busy}
        onSend={commSend.previewModal.onSend}
        onCancel={commSend.previewModal.onCancel}
        labels={{
          title: t(lang, "commSendPreviewTitle"),
          to: t(lang, "commSendPreviewTo"),
          subject: t(lang, "commSendPreviewSubject"),
          send: t(lang, "commSendPreviewSend"),
          cancel: t(lang, "commSendPreviewCancel"),
        }}
      />
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
        taskEditorActions={editorActions}
        taskDeleteAction={editorDeleteAction}
        jiraConflicts={jiraConflicts}
        handleResolveConflicts={handleResolveConflicts}
        clearConflicts={clearConflicts}
        editingAbsence={editingAbsence}
        absenceKnownAssignees={absenceKnownAssignees}
        handleSaveAbsence={handleSaveAbsence}
        handleDeleteAbsence={handleDeleteAbsence}
        handleCloseAbsenceModal={handleCloseAbsenceModal}
        editingShift={editingShift}
        shiftExistingAssigneeKeys={shiftExistingAssigneeKeys}
        handleSaveShift={handleSaveShift}
        handleDeleteShift={handleDeleteShift}
        handleCloseShiftModal={handleCloseShiftModal}
        today={today}
        nextId={nextId}
        contactsList={contactsList}
        resources={resources}
        onCreateResource={handleCreateResource}
        absences={absences}
        tasksForDeps={tasks}
        uniqueGroups={uniqueGroups}
        uniqueLabels={uniqueLabels}
        editingIsJiraLinked={editingIsJiraLinked}
        readOnlyJiraProjectName={editingReadOnlyJiraProjectName}
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
    </>
  );

  // The existing tree. Its root className already branches on isPopout, so this
  // single definition serves both the classic main window AND every popout.
  const appHeaderEl = (
    <AppHeader
      handleCancelEdit={handleCancelEdit}
      setTaskModalOpen={setTaskModalOpen}
      bannerCount={nowCount}
      onShowAlerts={() => setActiveTab("actions")}
      showToast={showToast}
      handleCommand={handleCommand}
      storageDescription={storageDescription}
      storageReady={storageOk}
      onPickStorageFile={onPickStorageFile}
      onOpenStorageFile={onOpenStorageFile}
      onGrantStorageWrite={onGrantWriteAccess}
      onRequestStorageSwitch={onRequestStorageSwitch}
      onMigrateToTurso={() => { void migrateCurrentProjectToTurso(); }}
      settings={settings}
      setSettings={setSettings}
      lang={lang}
      onOpenAiAssistant={() => openPopoutWindow("chat", settings.popout.reuseWindow)}
      currentView={activeTab}
      onAskClaude={(body) => requestChat(body, true)}
      projectSwitcher={projectSwitcher}
      trailing={
        <div className="flex items-center gap-2">
          <GlobalSearchConnected lang={lang} />
          {displayTzSwitcherEl}
        </div>
      }
    />
  );

  // Popout windows keep the simple scrolling flow. The classic main window is a
  // viewport-height flex column: the header pins at the top, only the content
  // region (workspace + tasks) scrolls, and the footer (last child of
  // modalsBlock) stays visible at the bottom without scrolling the whole page.
  const legacyTree = isPopout ? (
    <main id="main-content" className="flex flex-1 flex-col p-4">
      {!isReportPopoutTab(activeTab) && <ReadOnlyMirrorBanner lang={lang} />}
      {bannersEl}
      {workspaceEl}
      {modalsBlock}
    </main>
  ) : (
    <div className="flex h-screen flex-col">
      <div className="mx-auto w-full max-w-[1536px] shrink-0 px-6 pt-6 sm:px-10 sm:pt-10">
        {appHeaderEl}
      </div>
      {/* The classic layout's single <main> landmark — the scrollable content
          region below the header (the modern layout's lives in ModernShell). */}
      <main id="main-content" className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[1536px] px-6 pb-6 sm:px-10 sm:pb-10">
          {bannersEl}
          {workspaceEl}
          {tasksSectionEl}
        </div>
      </main>
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
        bannerCount={nowCount}
        onShowAlerts={() => setActiveTab("actions")}
        onOpenAiAssistant={() => openPopoutWindow("chat", settings.popout.reuseWindow)}
        search={<GlobalSearchConnected lang={lang} />}
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
        settingsView={settingsViewEl}
        learningInsightsView={learningInsightsEl}
        banners={bannersEl}
        navGroups={filteredNavGroups}
        projectSwitcher={projectSwitcher}
        projectSwitcherTrailing={askClaudeEl}
        navBadges={{ actions: nowCount }}
      />
      {tour.isOpen && settings.layout === "modern" && !isPopout && (
        <TourOverlay
          lang={lang}
          tourTitleKey={tour.activeTourTitleKey}
          steps={tour.steps}
          index={tour.index}
          onBack={tour.back}
          onNext={tour.next}
          onSkip={tour.skip}
          onDone={tour.done}
          onShowMe={(step) => tour.showMe(step, setActiveTab)}
        />
      )}
      {modalsBlock}
    </>
  );

  if (isPopout) {
    return (
      <ActivityLogProvider value={logActivity}>
        <AiUsageProvider lang={lang} ai={settings.ai} showToast={showToast}>
          <ToastProvider value={showToast}>
            <VoiceCommandProvider value={voiceHandlers}>
              <DisplayTimezoneProvider effectiveTz={effectiveTz} showSwitcher={!!settings.showDisplayTzSwitcher}>{legacyTree}</DisplayTimezoneProvider>
            </VoiceCommandProvider>
          </ToastProvider>
        </AiUsageProvider>
      </ActivityLogProvider>
    );
  }
  // Empty-state gate: on a fresh install (no registered projects) the user must
  // create or load a project before anything else. Rendered as the ONLY surface
  // — there is no interactive app chrome behind it — and covers both modern and
  // classic layouts. Popouts are handled above (they mirror the main window and
  // never see this). Gated on `hydrated` so SSR / pre-hydration (where
  // loadRegistry() is empty) doesn't flash the modal.
  // FILE mode: the localStorage registry is synchronous, so gate on hydration +
  // zero projects. TURSO mode: gate additionally on `tursoListLoaded` so the
  // empty-state never flashes before the first fetch and never shows when the DB
  // is unreachable (the fetch only flips the flag on success).
  const showEmptyState =
    portfolioMode === "turso"
      ? hydrated && tursoListLoaded && tursoProjects.length === 0
      : hydrated && registry.projects.length === 0;

  // Turso boot unlock gate: when the auth token is sealed under a passphrase and
  // not yet held in memory, nothing can load — prompt for the passphrase first.
  // Takes priority over the empty-state and the main app. (synchronous localStorage
  // read in render is pure — fine, do not move into an effect.)
  const showTursoUnlock =
    hydrated &&
    portfolioMode === "turso" &&
    isPassphraseLocked("tursoAuthToken") &&
    !(settings.integrations?.turso?.authToken ?? "").trim();

  return (
    <ActivityLogProvider value={logActivity}>
      <AiUsageProvider lang={lang} ai={settings.ai} showToast={showToast}>
        <ToastProvider value={showToast}>
          <VoiceCommandProvider value={voiceHandlers}>
            <DisplayTimezoneProvider effectiveTz={effectiveTz} showSwitcher={!!settings.showDisplayTzSwitcher}>
            {showTursoUnlock ? (
              <SecretUnlockGate
                lang={lang}
                messageKey="secretUnlockTursoToken"
                onUnlock={async (pw) => {
                  const v = await unlockSecret("tursoAuthToken", pw);
                  if (!v) return false;
                  setSettings((s) => ({
                    ...s,
                    integrations: {
                      ...s.integrations,
                      turso: { ...(s.integrations?.turso ?? { enabled: true }), authToken: v },
                    },
                  }));
                  return true;
                }}
              />
            ) : showEmptyState ? (
              <ProjectEmptyState
                lang={lang}
                mode={portfolioMode}
                stakeholderNames={stakeholders.map((s) => s.name)}
                addressBook={contactsList}
                resources={resources}
                settings={settings}
                onChangeSettings={(next) => setSettings(() => next)}
                onCreate={handleCreateProjectByMode}
                onLoadFromFile={handleLoadFromFileEmptyState}
                onLoadDemo={() => { void loadDemo(); }}
                archivedProjects={tursoArchived.map((e) => ({ id: e.id, name: e.meta.name }))}
                onRestore={handleRestoreFromEmptyState}
                onDeleteArchived={handleHardDeleteTursoProject}
              />
            ) : settings.layout === "classic" ? (
              legacyTree
            ) : (
              modernTree
            )}
            </DisplayTimezoneProvider>
          </VoiceCommandProvider>
        </ToastProvider>
      </AiUsageProvider>
    </ActivityLogProvider>
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
