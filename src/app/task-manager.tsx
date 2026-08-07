"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSettingsLogger, SETTINGS_LOG_DEBOUNCE_MS } from "./settings-log";
import type { SettingsSectionId } from "./dashboard-coaching";
import { computeBudgetReport, getBucketReminders, type ProjectReport } from "./budget-report";
import { buildAllocationsSnapshot, type AllocationsSnapshot } from "./alloc-plan/alloc-plan";
import { PanelSkeleton } from "./skeleton";
import { t } from "./i18n";
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
import { useTaskEditorBuffer, type RaidSpec, type LinkSpec } from "./use-task-editor-buffer";
import { useTaskBudgetLink } from "./use-task-budget-link";
import { useBudgetBuckets } from "./use-budget-buckets";
import { TaskLinkedTaskModal, type LinkedTaskDraft } from "./task-linked-task-modal";
import { applyTaskLink } from "./task-link";
import { useGanttHandlers } from "./use-gantt-handlers";
import { AppModals } from "./app-modals";
import { type Resource, type RaidItem, type ChangeItem, type Task, DEFAULT_TASK_STATUS } from "./types";
import { NotesWindow } from "./notes-window";
import { useNotesWindow } from "./use-notes-window";
import { applyStatusChange } from "./task-status";
import { sanitizeRaidItem } from "./sanitize";
import { useFxRates } from "./use-fx-rates";
import { splitName, resourceDisplayName, effectivePersonName, backfillTaskResourceFks } from "./resource-foundation";
import { descriptionText } from "./rich-text-projection";
import { mintId, peekMintId, seedMintFromWorkspace } from "./id-mint-session";
import { buildRaidByTaskIndex, nextRaidId } from "./raid";
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
import { GlobalSearchConnected } from "./global-search-box";
import { BirthdayBanner, JiraTokenBanner, StorageBanner } from "./notifications";
import { classifyStorageError, type StorageErrorKind } from "./storage-error";
import { useStakeholderComms } from "./use-stakeholder-comms";
import { isReadOnlyIssue, jiraProjectKeyOf } from "./jira-projects";
import { getJiraTokenAlert } from "./jira-token-status";
import { effectiveLeadDays } from "./notifications-lead";
import { WorkspaceSection } from "./workspace-section";
import { CalendarSummaryModals } from "./calendar-summary-modals";
import { useCalendarIntegrations } from "./use-calendar-integrations";
import { useActionCenterHandlers } from "./use-action-center-handlers";
import { useAiOrchestration } from "./use-ai-orchestration";
import { buildShellChrome } from "./shell-chrome";
import { useUndoStack } from "./undo/use-undo-stack";
import { useUndoHotkey } from "./use-undo-hotkey";
import { UndoControl, RedoControl } from "./undo/undo-control";
import { buildMoveAbsenceHandler } from "./absence-move-handler";
import { RolesPanel } from "./roles-panel";
import { rematerializeDayBasisRoles } from "./role-rates";
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
import { useSnapshots } from "./use-snapshots";
import { useVersionHistory } from "./use-version-history";
import { DEFAULT_VERSION_RETENTION } from "./version-history";
import { workspaceToJson, jsonToWorkspace, type Workspace } from "./workspace";
import { buildDashboardInput, computeDashboard } from "./dashboard";
import { detectInsights, type InsightInput } from "./insights/detect";
import { insightsMateriallyEqual, reconcileInsights } from "./insights/reconcile";
import { loadLandingState } from "./landing-state";
import type { Insight, InsightActions, InsightRecommendation } from "./insights/insight";
import { ALLOWED_REC_TOOLS } from "./insights/insight";
import { metricAtActionPatch } from "./insights/outcome";
import { useInsightRecommend } from "./use-insight-recommend";
import { useInsightRecommendRunner } from "./use-insight-recommend-runner";
import { buildRecommendContext } from "./insights/recommend-context";
import { describeRecommendationPlan } from "./insights/recommend-plan";
import { RecommendationReviewModal } from "./insights/recommendation-review-modal";
import { buildGroundingIndex } from "./action-ai";
import { executeActionCta } from "./action-cta-exec";
import { runTool } from "./chat-tools";
import { getTursoConfig } from "./turso-config";
import { aiKeyIfEnabled, isAiEnabled, DEFAULT_INSIGHT_REC_INTERVAL_MIN, defaultExportConfig, defaultNextActionsLearning, defaultSnapshotSettings, type JiraExtraProject, type Settings } from "./settings-types";
import { resolveEffectiveSettings } from "./settings-effective";
import { TaskDeleteButton, TaskEditorActions, TaskEditorExtras } from "./task-editor-actions";
import { APP_VERSION_LABEL } from "./version";
import { makeEditGuard } from "./read-only-guard";
import { SettingsView } from "./settings-view";
import { LearningInsights } from "./learning-insights";
import { useActionLearning } from "./use-action-learning";
import { ReadOnlyMirrorBanner } from "./read-only-mirror-banner";
import { VoiceCommandProvider } from "./voice-command-context";
import { AiUsageProvider } from "./ai-usage-context";
import { useMsAuth } from "./use-ms-auth";
import { useMeetingReportActions } from "./use-meeting-report-actions";
import { useCommSend } from "./use-comm-send";
import { CommSendPreviewModal } from "./comm-send-preview-modal";
import { SidebarFooter } from "./sidebar-footer";
import { useSidebarCollapsed } from "./use-sidebar-collapsed";
import { useOutlookContacts } from "./use-outlook-contacts";
import { OutlookImportModal } from "./outlook-import-modal";
import { contactsFromImported, canImportOutlookContacts, type OutlookContact } from "./outlook-contacts";
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
import { exportWorkspace, type ExportFormat } from "./export"; import { reportCapabilityGap, reportSilentFailure } from "./guard-feedback";
import { ProjectEmptyState } from "./project-empty-state";
import { SecretUnlockGate } from "./secret-unlock-gate";
import { isPassphraseLocked } from "./secrets-store";
import { unlockSecret } from "./use-secrets";
import type { ProjectSwitcherProps } from "./project-switcher";
import { useTour } from "./use-tour";
import { useDictationHotkey } from "./use-dictation-hotkey";
import { TourOverlay } from "./tour-overlay";
import { TOUR_ANCHORS } from "./app-tour";
import { loadPortfolioMode, type PortfolioMode } from "./portfolio-mode";
import { listProjects, listArchivedProjects } from "./turso-portfolio";
import { useTursoProjects } from "./use-turso-projects";
import type { ProjectListEntry } from "./turso-tenant-schema";
import type { ProjectRegistryEntry } from "./projects-registry";
import { computeNextActions } from "./next-actions";
import { buildActionInput } from "./next-actions-input";
import { buildWorkloadAlerts } from "./next-actions-workload";
import type { SuggestedAction } from "./next-actions";
import { computeActionTrends } from "./next-actions/trends";
import { todayInZone, resolveTimezone } from "./timezone";
import { DisplayTimezoneProvider } from "./display-timezone-context";
import { ConfirmProvider } from "./confirm-dialog";

// Today (YYYY-MM-DD) in the resolved effective zone. A module fn so the
// `new Date()` read stays out of the render body (react-hooks purity rule).
// Connected display-timezone switcher. A module-level wrapper (static-components
// rule) so it can read the DisplayTimezoneContext that wraps both shells — the
// header element it produces is rendered inside the provider in both layouts.

function effectiveToday(tz: string): string {
  return todayInZone(new Date(), tz);
}

// Idle window before an auto version is captured after a save. Coalesces a
// burst of saves into a single version.
const VERSION_IDLE_MS = 180_000; // 3 minutes

// Debounce before the insights detect→reconcile runner fires, so a burst of
// edits collapses into one recompute (#6B Insights → Action Loop, SP1).
const INSIGHTS_RECONCILE_DEBOUNCE_MS = 4_000;

// Cap on any free-text field folded into the linked-entity digest of an insight
// recommendation prompt — the digest rides a billed call, so an unbounded
// description must not blow up the token count (SP3).
const ENTITY_DIGEST_TEXT_CAP = 200;

// Stable empty fallback so an unset `settings.jira.extraProjects` doesn't create
// a fresh `[]` each render — that churns the task row context value and
// re-renders every row (audit #6).
const NO_JIRA_EXTRA_PROJECTS: readonly JiraExtraProject[] = [];

// Cap on the per-kind lines in the SP-C weight-suggestion learning summary,
// keeping the AI context token-bounded.

// TaskManagerInner consumes the FiltersProvider context. The default
// export below wraps this in <FiltersProvider> so useFilters() works.
function TaskManagerInner() {
  const { settings, setSettings, hydrated, i18nReady, lang } = useSettings();
  useApplyFavicon(settings.branding?.favicon ?? null);
  const { activityLog, setActivityLog, logActivity, logActivityChanges, handleClearActivityLog } =
    useActivityLog();
  const { toast, showToast, showToastAction, pause: pauseToast, resume: resumeToast } = useToast();
  // Local in-memory undo (deletes / clear-all / bulk-edit across every entity).
  // capture is threaded into each entity hook below; undo/control are surfaces.
  const undoApi = useUndoStack({ lang, logActivity, showToast, showToastAction });
  useUndoHotkey(undoApi.undo, undoApi.redo);
  // Stable identity so ToastProvider consumers don't re-render on every parent render.
  const toastApi = useMemo(() => ({ showToast, showToastAction }), [showToast, showToastAction]);

  const { workspaceCollapsed, setWorkspaceCollapsed } = useWorkspaceCollapsed();
  const { collapsed: sidebarCollapsed, toggle: toggleSidebar } = useSidebarCollapsed();
  const {
    sizedWidths,
    hiddenCols,
    setHiddenCols,
    colConfigOpen,
    setColConfigOpen,
    colConfigRef,
    resetColWidths,
    startColResize,
  } = useColumnManager();
  const { isPopout, activeTab, setActiveTab, requestOpen, pendingOpen, clearPendingOpen, requestChat, requestHelpConcept } = useWorkspaceTab();
  useHashView(settings.layout === "modern", settings.features);
  // Classic mode has no panel for the modern-only views; fall back to chat.
  useEffect(() => {
    if (
      settings.layout === "classic" &&
      (activeTab === "open-points" || activeTab === "settings")
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

  const { setRaidFilterTaskId, resetFilterValues, setAssigneeFilter, setHealthFilter } = useFilters();
  // Tasks data + derivations owned by WorkspaceProvider (Slice 2 of the
  // task-manager decomposition; see
  // docs/superpowers/specs/2026-05-18-workspace-context-slice2-design.md).
  // The default export wraps this component in <WorkspaceProvider> inside
  // <FiltersProvider>.
  const {
    tasks,
    setTasks,
    uniqueAssignees,
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
    timelogLinks,
    setTimelogLinks,
    setKnowledgeItems,
    insights,
    setInsights, setDocuments, setDocumentVersions,
    settingsOverrides,
    setSettingsOverrides,
    setCalendarEvents,
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
    setTaskModalOpen,
  } = useTaskForm();

  // Populated after useBulkOperations is called below; onDelete calls through
  // this ref so it doesn't depend on deselectId being defined first.
  const deselectIdRef = useRef<(id: number) => void>(() => {});

  // Resizable surfaces. See `use-resizable.ts` — each has its own
  // localStorage key, only deliberate corner-drag gestures are persisted.
  const { ref: tableRef, reset: resetTableSize } = useResizable(
    "aipm-cockpit:task-table-size",
  );
  const { ref: workspaceRef, reset: resetWorkspaceSize } = useResizable(
    "aipm-cockpit:workspace-size",
  );
  const { ref: modalRef } = useResizable("aipm-cockpit:task-modal-size");

  // Per-project EFFECTIVE settings: fold the project's POLICY overrides
  // (Workspace.settingsOverrides) onto the device settings. Appearance is Phase 6
  // (undefined here). With no override this is identity (=== device fields), so
  // every consumer below is behavior-preserving for the common case; only the
  // specific overridable-field READS (nextActions ranking / notifications
  // reminders / timezone) switch to the effective value.
  const effectiveSettings = useMemo(
    () => resolveEffectiveSettings(settings, settingsOverrides, undefined),
    [settings, settingsOverrides],
  );
  // Hoisted scalars so the ranking/reminder memos depend on these, not the fresh
  // `effectiveSettings` object each render (exhaustive-deps hygiene).
  const effectiveNextActions = effectiveSettings.nextActions;
  const effectiveNotifications = effectiveSettings.notifications;

  const effectiveTz = resolveTimezone(effectiveSettings.timezone, project?.operatingTimezone);
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
    // Classify EVERY failure (Turso kinds when recognized, else "generic") so a
    // file/CSV/MD/IndexedDB save/load failure raises the sticky banner too — it
    // was previously Turso-only. The transient TOAST already comes from the
    // backend load/save catches (use-storage-backend), which show a
    // hint-specific message — we only add the persistent banner here (adding a
    // toast too would double-fire and mislabel a load failure as a save).
    setStorageError({ kind: classifyStorageError(err) });
  }, []);

  // Settings persistence failure bridge: use-settings has no toast context, so
  // it dispatches this window event on the healthy→failing edge (quota / storage
  // disabled). Surface it once so the user knows their settings won't stick.
  useEffect(() => {
    const onSettingsWriteFailed = () => showToast("error", t(lang, "settingsWriteFailed"));
    window.addEventListener("aipm-cockpit-settings-write-failed", onSettingsWriteFailed);
    return () => window.removeEventListener("aipm-cockpit-settings-write-failed", onSettingsWriteFailed);
  }, [showToast, lang]);

  // A device-sealed credential exists but couldn't be decrypted on load (corrupt
  // ciphertext / device-key mismatch). use-settings dispatches this; tell the
  // user once so they re-enter it rather than silently seeing it as unconfigured.
  useEffect(() => {
    const onSecretUnreadable = () => showToast("error", t(lang, "secretUnreadable"));
    window.addEventListener("aipm-cockpit-secret-unreadable", onSecretUnreadable);
    return () => window.removeEventListener("aipm-cockpit-secret-unreadable", onSecretUnreadable);
  }, [showToast, lang]);

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
    storageDescription, storageReady, workspaceLoaded, onPickStorageFile, onGrantWriteAccess,
    onOpenStorageFile, onRequestStorageSwitch, reloadCurrentProject, allowDestructiveSave,
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
    active: trendsActive, cadence: snapshotsCfg.cadence, tasks, workspaceReady: workspaceLoaded,
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
      // reportStorageOutcome now owns both the banner (all kinds) and the
      // one-shot generic toast, so no explicit fallback toast is needed here.
      reportStorageOutcome(err);
    },
    showToast, lang,
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
    // Effective so birthday desktop-alert lead days follow a project's
    // notifications override (the hook reads only settings.notifications).
    hydrated, resources, today, settings: effectiveSettings, holidaySet, absences, showToast,
  });

  const birthdaySnooze = useReminderSnooze("birthday");
  const jiraTokenSnooze = useReminderSnooze("jiraToken");
  const actionSnooze = useActionSnooze();
  const [jiraTokenDismissed, setJiraTokenDismissed] = useState(false);
  const jiraTokenAlert = useMemo(
    () => getJiraTokenAlert(settings.jira, today, effectiveNotifications.reminderLeadDays),
    [settings.jira, today, effectiveNotifications.reminderLeadDays],
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

  // Display-only preview of the id the next created task will receive. Uses the
  // session minter's non-advancing peek so the "#N" shown matches what
  // use-task-submit will actually mint (a plain max+1 would under-predict after
  // a same-session delete of the current max task).
  const nextId = peekMintId("task", tasks);

  const {
    editingAbsence,
    editingShift,
    handleSaveRaidItem,
    handleDeleteRaidItem,
    handleSendRaidInquiry,
    captureRaidBulkUndo,
    handleOpenAddAbsence,
    handleEditAbsence,
    handleCloseAbsenceModal,
    handleSaveAbsence,
    handleDeleteAbsence,
    calendarEvents,
    editingCalendarEvent,
    handleOpenAddCalendarEvent,
    handleEditCalendarEvent,
    handleCloseCalendarEventModal,
    handleSaveCalendarEvent,
    handleDeleteCalendarEvent,
    handleOpenShiftEditor,
    handleCloseShiftModal,
    handleSaveShift,
    handleDeleteShift,
    handleCreateMitigationTaskFromRaid,
    handleSaveRole,
    handleDeleteRole,
    resolveOrCreateRole,
    handleAssignRoleById,
    handleAddDiscipline,
    handleRenameDiscipline,
    onDeleteDiscipline,
    onReorderDisciplines,
    onReorderRoles,
    handleAddGrade,
    handleRenameGrade,
    onDeleteGrade,
    onReorderGrades,
    handleSetUtilization,
    handleSetAbsenceOverride,
    handleSetPlanWindow,
    handleSetBudgetFollowsPlan,
    editingResource,
    handleOpenAddResource,
    handleEditResource,
    handleSaveResource,
    handleDeleteResource,
    handleBulkEditResources,
    handleBulkDeleteResources,
    handleImportResources,
    handleImportAbsences,
    handleCloseResourceModal,
    handleSetAllUtilizationMode,
  } = useResourcePlanner({ lang, today, logActivity, logActivityChanges, showToast, workdayHours: settings.resources.workdayHours, holidaySet, capture: undoApi.capture, captureComposite: undoApi.captureComposite, captureFieldEdit: undoApi.captureFieldEdit });

  // Day rates are the rate card's source of truth; the hourly cost rate every
  // budget/EVM consumer reads is DERIVED from workday hours. When that setting
  // changes, each day-basis role's materialized hourly goes stale — re-derive it
  // here via a guarded render-time reconcile (NOT an effect; set-state-in-effect
  // is banned) so cost figures stay correct without waiting for a manual re-edit.
  const workdayHoursNow = settings.resources.workdayHours;
  const [wdhForRoles, setWdhForRoles] = useState(workdayHoursNow);
  // Object.is (not !==) so a corrupted NaN workdayHours can't loop forever
  // (NaN !== NaN is always true → infinite render); Object.is(NaN,NaN)===true.
  if (!Object.is(workdayHoursNow, wdhForRoles)) {
    setWdhForRoles(workdayHoursNow);
    setRoles((prev) => rematerializeDayBasisRoles(prev, workdayHoursNow));
  }

  // Change Log CRUD. The hook reads/writes `changes` via WorkspaceProvider.
  const { handleSaveChange, handleDeleteChange, captureBulkUndo: captureChangeBulk } = useChangeLog({ today, lang, showToast, logActivity, logActivityChanges, capture: undoApi.capture, captureFieldEdit: undoApi.captureFieldEdit });

  // Stakeholder register / RACI / map CRUD. The hook reads/writes `stakeholders`
  // via WorkspaceProvider; the three panels source `resources`/`milestones` from
  // context inside WorkspaceSection.
  const { stakeholders, handleSaveStakeholder, handleDeleteStakeholder, captureBulkUndo: captureStakeholderBulk } =
    useStakeholders({ today, lang, showToast, logActivity, logActivityChanges, capture: undoApi.capture, captureFieldEdit: undoApi.captureFieldEdit });

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
    // Effective so stakeholder-comms reminder lead days follow a project's
    // notifications override (the hook reads only settings.notifications).
    settings: effectiveSettings,
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

  // --- Insights → Action Loop (#6B SP1) --------------------------------------
  // Assemble the detection input from live entities. `plan` is always present
  // here (workspace-context seeds defaultResourcePlan) so it is passed as-is;
  // `budgets` are forwarded raw (the budgetVariance detector self-gates on an
  // empty list), mirroring the dashboardModel inputs above. `roles`/`resources`
  // feed the budget engine so budgetFollowsPlan buckets derive real hours.
  // `priorOverdueCount` (SP2) reads the prior overdue snapshot from the
  // per-project landing-state — the SAME key workspace-section writes
  // (portfolioCurrentId ?? "default") — so a rising overdue count surfaces the
  // overdueTrend insight. A fresh project has no snapshot yet → null → the
  // detector stays inert (nothing to compare). ★ Deliberately keyed ONLY on
  // landingProjectId (captured once per project, mirroring use-landing-delta's
  // mount-time capture) — NOT re-read on every entity/activity change: the
  // companion debounced advance effect (use-landing-delta) overwrites the
  // stored snapshot with the LIVE overdue count ~4s after the Dashboard
  // mounts, so a live-recomputed read here would quickly start comparing
  // "current" against a snapshot of itself and never fire again this session.
  const landingProjectId = portfolioMode === "turso" ? (tursoProjectId ?? "default") : (currentProjectId ?? "default");
  const priorOverdueCount = useMemo(
    () => loadLandingState(landingProjectId).metrics?.overdue ?? null,
    [landingProjectId],
  );
  const buildInsightInput = useCallback(
    (): InsightInput => ({
      tasks,
      milestones,
      raid,
      budgets,
      roles,
      resources,
      plan,
      priorOverdueCount,
      holidaySet,
    }),
    [tasks, milestones, raid, budgets, roles, resources, plan, priorOverdueCount, holidaySet],
  );

  // Detect → reconcile runner. Debounced so a burst of edits collapses into one
  // recompute. Keyed on the DETECTION INPUTS (via buildInsightInput identity +
  // today), NEVER on `insights`, so the setInsights below cannot re-trigger this
  // effect — that would be the reconcile→setInsights→re-run loop (occurrences
  // would climb without bound). Writes via the setter only (a side effect, not
  // render-phase setState). Popout is read-only; pre-hydration is skipped.
  useEffect(() => {
    if (!hydrated || isPopout) return;
    const timer = setTimeout(() => {
      const detected = detectInsights(buildInsightInput(), today);
      setInsights((prev) => {
        const base = prev ?? [];
        const next = reconcileInsights(base, detected, today);
        return insightsMateriallyEqual(base, next) ? base : next;
      });
    }, INSIGHTS_RECONCILE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [buildInsightInput, today, hydrated, isPopout, setInsights]);

  // Lifecycle handlers (threaded to the dashboard as an insightActions bag; the
  // review UI that invokes them is built in Task 6/7). Each is a functional
  // setter so a burst can't drop writes; popout is a no-op. Stamps use `today`
  // (date-only) to match reconcile's own firstSeenAt/lastSeenAt convention.
  const onAcknowledgeInsight = useCallback(
    (id: number) => {
      if (isPopout) return;
      setInsights((prev) =>
        (prev ?? []).map((i) =>
          i.id === id ? { ...i, status: "acknowledged" as const, acknowledgedAt: today } : i,
        ),
      );
    },
    [isPopout, setInsights, today],
  );
  const onActInsight = useCallback(
    (id: number) => {
      if (isPopout) return;
      const target = (insights ?? []).find((i) => i.id === id);
      setInsights((prev) =>
        (prev ?? []).map((i) =>
          i.id === id
            ? {
                ...i,
                status: "acted" as const,
                actedAt: today,
                // SP3: baseline for outcome measurement. metricAtActionPatch is a
                // no-op when a baseline already exists (first act wins) or when the
                // insight has no extractable metric.
                ...metricAtActionPatch(i),
              }
            : i,
        ),
      );
      // Route to the referenced entity via the shared deep-link channel.
      if (target?.entityRef) requestOpen(target.entityRef.view, target.entityRef.id);
    },
    [isPopout, insights, setInsights, today, requestOpen],
  );
  const onDismissInsight = useCallback(
    (id: number, reason?: string) => {
      if (isPopout) return;
      setInsights((prev) =>
        (prev ?? []).map((i) =>
          i.id === id
            ? { ...i, status: "dismissed" as const, dismissedAt: today, ...(reason ? { dismissReason: reason } : {}) }
            : i,
        ),
      );
    },
    [isPopout, setInsights, today],
  );
  // The SP2 generate/apply/reject handlers (+ the `insightActions` assembly
  // that references them) need `dispatcher` (apply replays proposed tool calls
  // through it), so they're defined further down, right after `dispatcher` is
  // created — see "Insights → Action Loop (#6B SP2)" below.

  // Pre-computed workload alerts (over-allocated / overload) for the `workload`
  // next-actions provider; computed once on the surface and fed into the engine.
  const workloadAlerts = useMemo(
    () => buildWorkloadAlerts({
      resources, tasks, absences, shifts, raid, plan, today,
      workdayHours: settings.resources.workdayHours, holidaySet,
      overdueThreshold: effectiveNextActions?.workloadOverdueThreshold,
      overAllocatedPct: effectiveNextActions?.workloadAllocatedPct,
    }),
    [resources, tasks, absences, shifts, raid, plan, today, settings.resources.workdayHours, holidaySet, effectiveNextActions],
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
          reminderLeadDays: effectiveNotifications.reminderLeadDays,
          dueSoonWorkdays: effectiveNotifications.dueSoonWorkdays,
          raidReviewIntervalDays: effectiveNotifications.raidReviewIntervalDays,
          scopePendingRed: effectiveNextActions?.scopePendingRed,
          scheduleSpiWarn: effectiveNextActions?.scheduleSpiWarn,
          scheduleSpiCritical: effectiveNextActions?.scheduleSpiCritical,
          workloadAllocatedCritical: effectiveNextActions?.workloadAllocatedCritical,
          workloadOverdueUrgent: effectiveNextActions?.workloadOverdueUrgent,
          trends: actionTrends,
          clarityBonus: effectiveNextActions?.clarityBonus,
          semiClarityBonus: effectiveNextActions?.semiClarityBonus,
          staticPenalty: effectiveNextActions?.staticPenalty,
          // Due actions stay always-on (core). The RAID review toggle below
          // defaults true and is a safe gate.
          raidReviewEnabled: effectiveNotifications.raidReview.enabled,
          workloadAlerts,
          dismissed: actionSnooze.dismissed,
          learnedBias,
        }),
      ),
    [tasks, raid, changes, milestones, stakeholders, steeringCommittee, dashboardModel, comms.items, settings.features, effectiveNotifications, effectiveNextActions, project, today, workloadAlerts, actionSnooze.dismissed, actionTrends, learnedBias],
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
      executeActionCta(a.cta, {
        requestOpen, resetFilterValues, setAssigneeFilter, setHealthFilter, setActiveTab,
        // The live options the assignee <select> offers, so an "open this
        // person's tasks" CTA resolves to the STORED spelling instead of
        // orphaning the filter (which silently reads "All").
        assigneeOptions: uniqueAssignees,
        // ...and when the person is in NO option — hideExternalTasks keeps their
        // tasks out of uniqueAssignees while the workload engine still raises
        // their overload — the CTA filters nothing and explains itself rather
        // than presenting the project's whole red backlog as their overdue work.
        onUnresolvedAssignee: () =>
          reportCapabilityGap(showToast, lang, "actions.assigneeFilterUnavailable", "guardActionAssigneeUnavailable"),
      });
    },
    [requestOpen, resetFilterValues, setAssigneeFilter, setHealthFilter, setActiveTab, uniqueAssignees, showToast, lang],
  );
  const openActionCenter = useCallback(() => {
    if (typeof window !== "undefined") window.focus();
    setActiveTab("open-points");
  }, [setActiveTab]);

  // AI advisory orchestration (Action-Center analyze + weight-suggestion
  // context builder + SP5 scheduled-job runner) extracted to useAiOrchestration.
  const { aiAnalysisBundle, buildWeightSuggestionContext } = useAiOrchestration({
    isPopout,
    settings,
    lang,
    today,
    project,
    tasks,
    raid,
    milestones,
    changes,
    stakeholders,
    nextActions,
    learning,
    trendsActive,
    actionTrends,
    tursoConfig,
    requestOpen,
    requestChat,
  });

  useActionNotifications({
    actions: nextActions,
    enabled: effectiveNotifications.desktopUrgent.enabled,
    isPopout,
    lang,
    onOpenAction: openAction,
    openActionCenter,
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
      steeringCommittee, timelogLinks,
    }),
    [tasks, raid, absences, shifts, resources, roles, disciplines, grades,
     plan, budgets, fxRates, status, project, milestones, changes, stakeholders,
     steeringCommittee, timelogLinks],
  );

  // Fan a restored workspace into every setter — the SECOND load funnel, so it
  // repeats applyWorkspace's task-FK backfill (but NOT `workspaceLoaded`: see it).
  const applyRestoredWorkspace = useCallback((w: Workspace) => {
    setTasks(backfillTaskResourceFks(w.resources ?? [], w.tasks ?? [])); setRaid(w.raid ?? []); setAbsences(w.absences ?? []); setShifts(w.shifts ?? []);
    setResources(w.resources ?? []); setRoles(w.roles ?? []); setDisciplines(w.disciplines ?? []); setGrades(w.grades ?? []);
    if (w.plan) setPlan(w.plan); setBudgets(w.budgets ?? []); setFxRates(w.fxRates ?? null); setStatus(w.status ?? {});
    setProject(w.project); setMilestones(w.milestones ?? []); setChanges(w.changes ?? []); setStakeholders(w.stakeholders ?? []);
    setSteeringCommittee(w.steeringCommittee); setTimelogLinks(w.timelogLinks); setKnowledgeItems(w.knowledgeItems);
    setInsights(w.insights); setDocuments(w.documents ?? []); setDocumentVersions(w.documentVersions ?? []);
    setSettingsOverrides(w.settingsOverrides);
    setCalendarEvents(w.calendarEvents);
    // Version restore replaces the SAME project's data — RAISE the id-minter
    // high-water (never lower it) so an id freed by restoring an older (smaller)
    // snapshot can't be reused this session. Side-effecting; runs on restore
    // (callback), not during render.
    seedMintFromWorkspace(w, "raise");
  }, [setTasks, setRaid, setAbsences, setShifts, setResources, setRoles, setDisciplines, setGrades, setPlan, setBudgets, setFxRates, setStatus, setProject, setMilestones, setChanges, setStakeholders, setSteeringCommittee, setTimelogLinks, setKnowledgeItems, setInsights, setDocuments, setDocumentVersions, setSettingsOverrides, setCalendarEvents]);

  // Guided tour (SP-F): modern-shell, non-popout only. Auto-launches once for a
  // first-run user; re-launchable from the Help panel. State lives above the
  // view so it survives the view remount that the modern shell performs.
  const tour = useTour({
    layout: settings.layout, isPopout, hydrated, tourSeen: settings.tourSeen,
    completedTours: settings.completedTours, features: settings.features, setSettings,
  });
  const startTour = tour.start;

  // Global push-to-talk hotkey: held combo drives the focused field's mic (dictation-target); disabled in popouts.
  useDictationHotkey(settings.dictation?.hotkey, isPopout);

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
      // reportStorageOutcome owns the sticky banner (all kinds) + the one-shot
      // generic toast; version capture is best-effort and never blocks the main
      // save.
      reportStorageOutcome(err);
    },
    [reportStorageOutcome],
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
      const id = mintId("resource", resources);
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
  const msAuth = useMsAuth(m365Enabled, { clientId: settings.integrations?.m365?.clientId, tenantId: settings.integrations?.m365?.tenantId });
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
  }, [fetchOutlookContacts, lang, setImportOpen, setImportError, setImportContacts, setImportLoading]);

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
    [handleImportResources, setContacts, showToast, lang, setImportOpen],
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
  }, [fetchOutlookEvents, today, lang, setCalImportOpen, setCalImportError, setCalImportEvents, setCalImportLoading]);

  const handleConfirmCalendarImport = useCallback(
    (rows: { event: OutlookEvent; type: AbsenceType }[]) => {
      handleImportAbsences(rows, calendarTarget);
      setCalImportOpen(false);
      showToast("info", t(lang, "outlookCalImportedN", rows.length));
    },
    [handleImportAbsences, calendarTarget, showToast, lang, setCalImportOpen],
  );

  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  // Live mirror of the RAID list so RAID created from the task editor mints ids +
  // logs OUTSIDE the setState updater (updaters must be pure — strict mode double-
  // invokes them), while staying fresh across a buffer flush loop (N in one tick).
  const raidRef = useRef(raid);
  useEffect(() => {
    raidRef.current = raid;
  }, [raid]);

  const onPushToJiraRef = useRef<(taskId: number) => Promise<boolean>>(
    () => Promise.resolve(false),
  );
  const pendingLinkRaidIdRef = useRef<number | null>(null);

  // Task editor: create RAID (Task 7) + linked tasks (Task 8) from the editor.
  // Edit-mode applies immediately; create-mode stages in `editorBuffer` and
  // flushes once the new parent id is resolved on save.
  const applyRaidFromTask = useCallback(
    (taskId: number, spec: RaidSpec) => {
      const id = nextRaidId(raidRef.current);
      const raw = {
        id,
        category: spec.category,
        title: spec.title,
        raisedDate: today,
        linkedTaskIds: [taskId],
      } as RaidItem;
      const clean = sanitizeRaidItem(raw);
      if (!clean) return; // malformed (e.g. empty title) → skip rather than persist raw
      const next = [...raidRef.current, clean];
      raidRef.current = next; // keep back-to-back flushes minting distinct ids
      setRaid(next);
      logActivity("raid.created", clean.id, clean.title);
    },
    [setRaid, today, logActivity],
  );
  const applyLinkFromTask = useCallback(
    (parentId: number, spec: LinkSpec) => {
      setTasks((prev) => applyTaskLink(prev, parentId, spec));
    },
    [setTasks],
  );
  const { commitBuckets } = useBudgetBuckets({ budgets, setBudgets, capture: undoApi.capture, captureComposite: undoApi.captureComposite, logActivity });
  const editorBuffer = useTaskEditorBuffer({ applyRaid: applyRaidFromTask, applyLink: applyLinkFromTask });
  const { flush: flushEditorBuffer, discard: discardEditorBuffer, stageRaid: stageEditorRaid, stageLink: stageEditorLink } = editorBuffer;
  const { budgetLink, onTaskCreated: onTaskCreatedWithBucket, onEditorDiscard: onEditorDiscardWithBucket } = useTaskBudgetLink({ enabled: isModuleEnabled("budget", settings.features), budgets, editingId, commitBuckets, flushEditorBuffer, discardEditorBuffer });

  // create-RAID (Task 7): apply immediately in edit-mode, stage in create-mode.
  const handleAddRaidFromEditor = useCallback(
    (spec: RaidSpec) => {
      if (editingId !== null) applyRaidFromTask(editingId, spec);
      else stageEditorRaid(spec);
    },
    [editingId, applyRaidFromTask, stageEditorRaid],
  );

  // create linked task (Task 8): mirror the normal create path (mint id,
  // functional setTasks, route status through applyStatusChange), then wire the
  // parent↔child link (immediate for an existing parent, staged for a new one).
  const [linkedTaskOpen, setLinkedTaskOpen] = useState(false);
  const handleCreateLinkedTask = useCallback(
    (draft: LinkedTaskDraft) => {
      const childId = mintId("task", tasksRef.current);
      const base: Task = {
        id: childId,
        taskName: draft.taskName,
        assignee: draft.assignee,
        assigneeEmail: "",
        dueDate: draft.dueDate,
        lastUpdateDate: today,
        priority: draft.priority,
        status: DEFAULT_TASK_STATUS,
        blockers: "",
        description: "",
        inquiriesSent: 0,
        dependencies: [],
      };
      const child = applyStatusChange(base, DEFAULT_TASK_STATUS, today);
      const nextList = [...tasksRef.current, child];
      tasksRef.current = nextList;
      setTasks(nextList);
      logActivity("task.created", childId, child.taskName);
      const spec: LinkSpec = { childId, direction: draft.direction, type: "FS" };
      if (editingId !== null) applyLinkFromTask(editingId, spec);
      else stageEditorLink(spec);
      // NOTE (by design): the child task is committed here immediately (real id),
      // while for a NEW parent only the LINK is staged. Cancelling the parent
      // editor discards the staged link but keeps the child task — a nested child
      // is a real task the moment it's saved, independent of the parent's outcome.
      setLinkedTaskOpen(false);
    },
    [today, setTasks, logActivity, editingId, applyLinkFromTask, stageEditorLink, setLinkedTaskOpen],
  );

  // Shared floating note-log window (tasks + RAID), popout-gated at the mount below (see use-notes-window.ts).
  const { openTaskNotes, openRaidNotes, notesWindowProps, notePanelPropsFor } = useNotesWindow({ tasks, raid, setTasks, setRaid, selfResourceId: settings.selfResourceId, resources, lang, logActivity });

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
    logActivityChanges,
    showToast,
    onPushToJiraRef,
    raid,
    setRaid,
    pendingLinkRaidIdRef,
    onTaskCreated: onTaskCreatedWithBucket,
    onEditorDiscard: onEditorDiscardWithBucket,
    captureFieldEdit: undoApi.captureFieldEdit,
  });

  // Deep-link: when a suggested-action chip requests opening a task, open its
  // edit modal once and clear the pending signal so it does not re-fire. The
  // editor is the floating TaskFormModal in every layout, so the list stays
  // mounted underneath and its own useDeepLinkRowFlash flashes the row (the
  // immediate path) — no full-page return-flash channel is needed here.
  useEffect(() => {
    if (pendingOpen?.view !== "open-points") return;
    const task = tasks.find((t) => t.id === pendingOpen.id);
    if (task) openEditModal(task);
    clearPendingOpen();
  }, [pendingOpen, tasks, openEditModal, clearPendingOpen]);

  const commTemplatesActive = tursoConfig !== null && !isPopout;
  const commTemplates = useCommTemplates({ active: commTemplatesActive, config: tursoConfig });
  const operatingGuides = useOperatingGuides({ config: tursoConfig });
  const meetingReportActions = useMeetingReportActions({
    lang,
    isPopout,
    settings,
    committee: steeringCommittee,
    resources,
    setSteeringCommittee,
    tursoConfig,
    m365Configured: m365Enabled,
    acquireToken: msAuth.acquireToken,
    showToast,
    getDashboardModel: () => dashboardModel,
    aiKey: aiKeyIfEnabled(settings.ai),
    aiModel: settings.ai.model,
    projectId: portfolioMode === "turso" ? (tursoProjectId ?? "") : "",
  });
  // Stable callback (its own useCallback) — depend on this, not the whole hook
  // object, so consumers don't re-create on every render.
  const resolveCommBody = commTemplates.resolveTemplateBody;

  // Directory map for resolving a linked assignee's LIVE email on outbound
  // inquiries (the cached assigneeEmail can go stale after a rename/re-link).
  const resourcesById = useMemo(() => new Map(resources.map((r) => [r.id, r])), [resources]);

  const {
    pushingIds,
    onJumpToRaid,
    onSendInquiry,
    onPushToJira,
    onStatusChange,
    onSwimlaneDrop,
    onEdit,
    onDelete,
    handleClearRaidTaskFilter,
    handleJumpToTaskFromRaid,
  } = useTaskRowHandlers({
    tasksRef,
    resourcesById,
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
    capture: undoApi.capture,
    captureFieldEdit: undoApi.captureFieldEdit,
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

  // Voice `clearAll` requests the type-to-confirm dialog. It also navigates to
  // the Tasks view so the dialog can open from ANY view (TasksSection mounts
  // only for the active view). Monotonic non-null nonce = a pending request;
  // TasksSection consumes it (→ null) so a remount can't re-fire a stale one.
  const clearAllReqSeqRef = useRef(0);
  const [clearAllRequestNonce, setClearAllRequestNonce] = useState<number | null>(null);
  const onClearAllRequestConsumed = useCallback(() => setClearAllRequestNonce(null), []);

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
    handleBulkDelete,
    handleClearAll,
    handleCommand,
  } = useBulkOperations({
    lang,
    // Effective settings so bulk-op day-boundary math (`args.settings.timezone`)
    // follows the per-project timezone override; the device writer stays on
    // `setSettings`.
    settings: effectiveSettings,
    setSettings,
    handlers: { onEdit, onDelete, onSendInquiry },
    onCancelEdit: handleCancelEdit,
    logActivity,
    capture: undoApi.capture, commitBuckets,
    showToast, allowDestructiveSave,
    // Day-boundary context for the health filter, so the hook's idea of a
    // visible row matches the Open Points pane's exactly.
    today, holidaySet,
    requestClearAllConfirm: () => {
      setActiveTab("open-points");
      setClearAllRequestNonce((clearAllReqSeqRef.current += 1));
    },
  });
  // Sync deselectIdRef so onDelete (defined above) can call it without
  // depending on useBulkOperations being declared first. Written in an effect
  // (after commit) because onDelete only reads it from its event handler.
  useEffect(() => {
    deselectIdRef.current = deselectId;
  });
  const { handleGanttBarUpdate } = useGanttHandlers({ tasksRef, setTasks, today });

  const birthdayItems = useMemo(
    () => effectiveNotifications.birthday.enabled
      ? getUpcomingBirthdays(resources, today, effectiveLeadDays(effectiveNotifications, "birthday"), holidaySet, absences)
      : [],
    [resources, effectiveNotifications, today, holidaySet, absences],
  );

  const bucketReminders = useMemo(
    () => getBucketReminders(budgets, effectiveNotifications.reminderLeadDays, today),
    [budgets, effectiveNotifications.reminderLeadDays, today],
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

  // Deliberately NOT memoized: this runs only when the assistant calls
  // get_dashboard_snapshot, so an unused read tool costs nothing per render.
  // Passes `tasks` (which the dashboard's own computeBudgetReport call omits),
  // so earnedValue / costPerformanceIndex here are the real figures.
  const getBudgetRollup = (): ProjectReport | null => {
    if (!isModuleEnabled("budget", settings.features)) return null;
    return computeBudgetReport(
      budgets,
      plan,
      roles,
      resources,
      settings.resources.workdayHours,
      holidaySet,
      absences,
      tasks,
    ).project;
  };

  // Deliberately NOT memoized: this runs only when the assistant calls
  // list_allocations, so an unused read tool costs nothing per render.
  const getAllocationsSnapshot = (): AllocationsSnapshot =>
    buildAllocationsSnapshot({
      resources,
      plan,
      absences,
      workdayHours: settings.resources.workdayHours,
      holidaySet,
    });

  const dispatcher = useChatDispatcher({
    settings,
    today,
    setSelectedIds,
    setSettings,
    isReadOnly: isPopout,
    currentView: activeTab, settingsProjectId: landingProjectId, holidaySet, logActivity,
    getDashboardModel: () => dashboardModel,
    getBudgetRollup,
    getAllocationsSnapshot,
  });

  // --- Insights → Action Loop (#6B SP2) ---------------------------------
  // Generate/apply/reject handlers for an insight's AI recommendation. Apply
  // replays the recommendation's proposed tool calls through the SAME
  // dispatcher the chat/inline-edit tools use (runTool re-sanitizes per
  // entity — the security boundary — and no-ops a stale id gracefully), so
  // these live here, after `dispatcher` exists.
  const buildInsightGroundingIndex = useCallback(
    () => buildGroundingIndex({ tasks, raid, milestones, changes, stakeholders }),
    [tasks, raid, milestones, changes, stakeholders],
  );
  // Resolve an insight's entityRef to a compact title + field digest for the
  // recommendation context. Only milestoneSlip/raidAging carry an entityRef —
  // the other detectors are project-level singletons, so there is deliberately
  // no resolver for them. Bounded: a short fixed field list per view, never the
  // whole row, and free text is capped — this text rides a billed prompt. The
  // fields chosen EXCLUDE what `insight.data` already carries (name/date/
  // daysOverdue, title/targetDate/daysSinceUpdate) so the digest adds signal
  // rather than repeating it.
  const resolveInsightEntity = useCallback(
    (insight: Insight) => {
      const ref = insight.entityRef;
      if (!ref) return undefined;
      if (ref.view === "milestones") {
        const m = milestones.find((x) => x.id === ref.id);
        if (!m) return undefined;
        return {
          view: ref.view,
          id: m.id,
          title: m.name,
          fields: [
            `achieved: ${m.achievedDate ?? "no"}`,
            `linkedTasks: ${m.linkedTaskIds.length}`,
            `description: ${descriptionText(m.description).slice(0, ENTITY_DIGEST_TEXT_CAP) || "(none)"}`,
          ].join("\n"),
        };
      }
      if (ref.view === "raid") {
        const r = raid.find((x) => x.id === ref.id);
        if (!r) return undefined;
        // Owner via the shared live-name helper — the cached `owner` string can
        // be stale after a rename/re-link (same rule every other surface uses).
        const owner = effectivePersonName(r.owner ?? "", r.ownerResourceId, resourcesById);
        return {
          view: ref.view,
          id: r.id,
          title: r.title,
          fields: [
            `category: ${r.category}`,
            `status: ${r.status}`,
            `severity: ${r.severity ?? "(unset)"}`,
            `owner: ${owner || "(unassigned)"}`,
            // Worth the extra field despite the free text: it tells the model what
            // has ALREADY been tried, so it stops re-proposing the existing plan.
            `mitigation: ${descriptionText(r.mitigation).slice(0, ENTITY_DIGEST_TEXT_CAP) || "(none)"}`,
          ].join("\n"),
        };
      }
      return undefined;
    },
    [milestones, raid, resourcesById],
  );
  const buildInsightRecommendContext = useCallback(
    (insight: Insight) => {
      const entity = resolveInsightEntity(insight);
      return buildRecommendContext({
        projectName: project?.name ?? "",
        today,
        insightType: insight.type,
        severity: insight.severity,
        data: insight.data,
        ...(entity ? { entity } : {}),
        relatedTasks: tasks.map((tk) => ({ id: tk.id, title: tk.taskName })),
      });
    },
    [project, today, tasks, resolveInsightEntity],
  );
  const applyInsightRecommendation = useCallback(
    (id: number, rec: InsightRecommendation) => {
      setInsights((prev) => (prev ?? []).map((i) => (i.id === id ? { ...i, recommendation: rec } : i)));
    },
    [setInsights],
  );
  const { generatingId: insightGeneratingId, generate: generateInsightRecommendation } = useInsightRecommend({
    insights: insights ?? [],
    ai: { apiKey: aiKeyIfEnabled(settings.ai), model: settings.ai?.model ?? "claude-sonnet-4-6" },
    today,
    buildIndex: buildInsightGroundingIndex,
    buildContextFor: buildInsightRecommendContext,
    applyRecommendation: applyInsightRecommendation,
    isPopout,
    onError: (kind) => {
      showToast("error", t(lang, kind === "limit" ? "aiUsageLimitReached" : "insightRecommendationError"));
    },
  });
  useInsightRecommendRunner({
    enabled: isAiEnabled(settings.ai) && settings.ai.insightRecommendations === true && !isPopout,
    insights: insights ?? [],
    ai: { apiKey: aiKeyIfEnabled(settings.ai), model: settings.ai?.model ?? "claude-sonnet-4-6" },
    today,
    intervalMinutes: settings.ai.insightRecommendationIntervalMinutes ?? DEFAULT_INSIGHT_REC_INTERVAL_MIN,
    buildIndex: buildInsightGroundingIndex,
    buildContextFor: buildInsightRecommendContext,
    applyRecommendation: applyInsightRecommendation,
  });

  const onGenerateRecommendationInsight = useCallback(
    (id: number) => { void generateInsightRecommendation(id); },
    [generateInsightRecommendation],
  );
  // Opens the review modal; the modal's Confirm button runs the actual apply
  // (confirmInsightRecommendation, below — it needs the live insight + its
  // recommendation, read at confirm time so a stale id is a safe no-op).
  const [reviewInsightId, setReviewInsightId] = useState<number | null>(null);
  const onApplyRecommendationInsight = useCallback((id: number) => { setReviewInsightId(id); }, [setReviewInsightId]);
  const onRejectRecommendationInsight = useCallback(
    (id: number) => {
      if (isPopout) return;
      setInsights((prev) =>
        (prev ?? []).map((i) =>
          i.id === id && i.recommendation
            ? { ...i, recommendation: { ...i.recommendation, status: "rejected" as const } }
            : i,
        ),
      );
    },
    [isPopout, setInsights],
  );
  const insightActions: InsightActions = useMemo(
    () => ({
      onAcknowledge: onAcknowledgeInsight, onAct: onActInsight, onDismiss: onDismissInsight,
      onGenerateRecommendation: onGenerateRecommendationInsight,
      onApplyRecommendation: onApplyRecommendationInsight,
      onRejectRecommendation: onRejectRecommendationInsight,
    }),
    [onAcknowledgeInsight, onActInsight, onDismissInsight, onGenerateRecommendationInsight,
      onApplyRecommendationInsight, onRejectRecommendationInsight],
  );

  // The insight currently under review + a live preview of its recommendation's
  // proposed calls (re-grounded against the CURRENT workspace, since a
  // background-generated recommendation can be stale by the time it's reviewed).
  const reviewInsight = (insights ?? []).find((i) => i.id === reviewInsightId) ?? null;
  const reviewPlan = useMemo(
    () =>
      reviewInsight?.recommendation
        ? describeRecommendationPlan(reviewInsight.recommendation.proposedCalls, {
            tasks, raid, changes, milestones, stakeholders,
          })
        : null,
    [reviewInsight, tasks, raid, changes, milestones, stakeholders],
  );
  const confirmInsightRecommendation = useCallback(async () => {
    const insight = (insights ?? []).find((i) => i.id === reviewInsightId);
    const rec = insight?.recommendation;
    // Close the modal FIRST (before any await) — this is also the re-entrancy
    // guard: a rapid double-click on Confirm finds reviewInsightId already null
    // on the second fire and early-returns, so the same recommendation can't be
    // applied twice (which would duplicate create_* entities). The insight/rec
    // needed for the apply are already captured in this closure.
    setReviewInsightId(null);
    if (!insight || !rec) return;
    // Security: re-enforce the allow-set at apply — a persisted/imported blob must
    // never drive a destructive tool (delete_*/update_settings) through runTool,
    // even if it slipped a stale load path. Load-time sanitize also strips these.
    const calls = rec.proposedCalls.filter((c) => ALLOWED_REC_TOOLS.has(c.name));
    // Per-call, NON-transactional apply. Each runTool is its own try/catch so one
    // call that THROWS (e.g. an enum/date the entity's sanitizer rejects) can't
    // abort the remaining calls. (A stale update id does NOT throw — the
    // dispatcher's id-based find no-ops it — so `failed` counts hard errors, not
    // silently-skipped stale updates.) We ALWAYS advance the insight to
    // acted/applied afterwards (even on partial failure) so a retry can never
    // re-run the calls that DID commit — that would duplicate create_* entities.
    let failed = 0;
    for (const call of calls) {
      try {
        await runTool(dispatcher, call.name, call.input as Record<string, unknown>);
      } catch {
        failed++;
      }
    }
    setInsights((prev) =>
      (prev ?? []).map((i) =>
        i.id === insight.id
          ? {
              ...i,
              status: "acted" as const,
              actedAt: today,
              // SP3: same shared baseline capture as the manual Act path.
              ...metricAtActionPatch(i),
              recommendation: { ...rec, status: "applied" as const, appliedAt: today, appliedSummary: rec.summary },
            }
          : i,
      ),
    );
    logActivity("ai.insightRecommendation", insight.id, rec.summary);
    showToast(
      failed > 0 ? "error" : "info",
      t(lang, failed > 0 ? "insightRecommendationApplyFailed" : "insightRecommendationApplied"),
    );
  }, [insights, reviewInsightId, dispatcher, setInsights, setReviewInsightId, today, logActivity, showToast, lang]);

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
      void exportWorkspace(ws, format as ExportFormat, settings.export ?? defaultExportConfig, lang).catch((e) => reportSilentFailure(showToast, lang, "export.failed", e, "guardExportFailed"));
    },
    [tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, project, milestones, changes, stakeholders, settings.export, lang, showToast],
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
    onOpenNotes: openRaidNotes,
    handleSaveRaidItem: guardEdit(handleSaveRaidItem),
    handleDeleteRaidItem: guardEdit(handleDeleteRaidItem),
    onSendRaidInquiry: isPopout ? undefined : handleSendRaidInquiry,
    onCaptureRaidBulk: captureRaidBulkUndo,
    onCaptureUndo: undoApi.capture,
    onCaptureFieldEdit: undoApi.captureFieldEdit,
    m365Configured: m365Enabled,
    raidCalendar: {
      enabled: calendarRaidEnabled,
      onToggle: onToggleCalendarRaid,
      onPush: pushRaidToOutlook,
      pushBusy: calendarRaidPushBusy,
      onPull: calendarRaidEnabled ? raidPull.pull : undefined,
      pullBusy: calendarRaidEnabled ? raidPull.busy : undefined,
    },
    changeCalendar: {
      enabled: calendarChangeEnabled,
      onToggle: onToggleCalendarChange,
      onPush: pushChangeToOutlook,
      pushBusy: calendarChangePushBusy,
      onPull: calendarChangeEnabled ? changePull.pull : undefined,
      pullBusy: calendarChangeEnabled ? changePull.busy : undefined,
    },
    absenceCalendar: {
      enabled: calendarAbsenceEnabled,
      onToggle: onToggleCalendarAbsence,
      onPush: pushAbsenceToOutlook,
      pushBusy: calendarAbsencePushBusy,
      onPull: calendarAbsenceEnabled ? absencePull.pull : undefined,
      pullBusy: calendarAbsenceEnabled ? absencePull.busy : undefined,
    },
    changes,
    handleSaveChange: guardEdit(handleSaveChange),
    handleDeleteChange: guardEdit(handleDeleteChange),
    onCaptureChangeBulk: captureChangeBulk,
    stakeholders,
    handleSaveStakeholder: guardEdit(handleSaveStakeholder),
    handleDeleteStakeholder: guardEdit(handleDeleteStakeholder),
    onCaptureStakeholderBulk: captureStakeholderBulk,
    handleCreateMitigationTaskFromRaid: guardEdit(handleCreateMitigationTaskFromRaid),
    handleJumpToTaskFromRaid,
    activityLog,
    logActivity,
    logActivityChanges,
    handleClearActivityLog: guardEdit(handleClearActivityLog),
    handleOpenAddAbsence: guardEdit(handleOpenAddAbsence),
    handleEditAbsence: guardEdit(handleEditAbsence),
    // Absence drag-move/resize/reassign on the Resources → Calendar grid (R5
    // S2) — see absence-move-handler.ts for why undo capture lives there and
    // not inside handleSaveAbsence.
    handleMoveAbsence: guardEdit(buildMoveAbsenceHandler(absences, setAbsences, undoApi.captureFieldEdit, handleSaveAbsence, lang)),
    // Recurring meetings (Resources → Calendar band + series editor). Data
    // passes through unguarded (a popout mirror still shows the band); the
    // TRIGGERS/handlers are guardEdit-wrapped — the resources-panel is a pure
    // passthrough for this entity, mirroring onAddAbsence/onEditAbsence.
    // handleSaveCalendarEvent is threaded here too for the band's own
    // drag-reschedule path (buildMoveOccurrenceHandler), a NON-modal write —
    // distinct from the modal's save/delete, which never traverses the panel.
    calendarEvents,
    handleOpenAddCalendarEvent: guardEdit(handleOpenAddCalendarEvent),
    handleEditCalendarEvent: guardEdit(handleEditCalendarEvent),
    handleSaveCalendarEvent: guardEdit(handleSaveCalendarEvent),
    handleOpenShiftEditor: guardEdit(handleOpenShiftEditor),
    manageRolesView: (
      <RolesPanel
        lang={lang}
        currency={plan.currency || "EUR"}
        workdayHours={settings.resources.workdayHours}
        roles={roles}
        disciplines={disciplines}
        grades={grades}
        onSaveRole={handleSaveRole}
        onDeleteRole={handleDeleteRole}
        onResolveOrCreateRole={resolveOrCreateRole}
        onReorderRoles={onReorderRoles}
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
    onAssignRoleById: guardEdit(handleAssignRoleById),
    onSetUtilization: guardEdit(handleSetUtilization),
    // Same threshold the over-allocation ALERT uses so the workload cell's pink
    // highlight fires exactly when the alert does (#24 review).
    overAllocatedPct: effectiveNextActions?.workloadAllocatedPct ?? 100,
    // Workload overdue-task triage (#24) — functional setter so bulk edits from
    // the popover compose; reassign copies the resource's identity onto the task.
    onReassignTask: guardEdit((taskId: number, resource: Resource | null) =>
      setTasks((prev) =>
        prev.map((tk) =>
          tk.id === taskId
            ? {
                ...tk,
                assignee: resource ? resourceDisplayName(resource) : "",
                assigneeEmail: resource?.email ?? "",
                resourceId: resource?.id ?? undefined,
              }
            : tk,
        ),
      ),
    ),
    onRescheduleTask: guardEdit((taskId: number, iso: string) => setTasks((prev) => prev.map((tk) => (tk.id === taskId ? { ...tk, dueDate: iso } : tk)))),
    // Clear an unlinked workload row (an owner string matching NO resource, so a
    // name/email string match can't hit a managed resource's record; a task
    // linked by resourceId keeps that link — we only touch the free-text field).
    // Tasks + RAID support an empty assignee/owner, so they are UNASSIGNED and
    // kept. Absences + shifts REQUIRE an assignee (sanitizeAbsence/sanitizeShift
    // drop an empty one on reload — an "unassigned absence" isn't representable),
    // so the stray records are REMOVED outright.
    onClearUnlinked: guardEdit((row: { display: string; email: string; firstName: string; lastName: string }) => {
      const name = row.display.trim().toLowerCase();
      const email = row.email.trim().toLowerCase();
      const matchName = (s: string | undefined | null) => !!name && !!s && s.trim().toLowerCase() === name;
      const matchEmail = (e: string | undefined | null) => !!email && !!e && e.trim().toLowerCase() === email;
      setTasks((prev) => prev.map((tk) =>
        matchName(tk.assignee) || matchEmail(tk.assigneeEmail) ? { ...tk, assignee: "", assigneeEmail: "" } : tk));
      setRaid((prev) => prev.map((r) => matchName(r.owner) ? { ...r, owner: "" } : r));
      setAbsences((prev) => prev.filter((a) => !matchName(a.assignee)));
      setShifts((prev) => prev.filter((s) => !matchName(s.assignee)));
    }),
    onSetAllUtilizationMode: guardEdit(handleSetAllUtilizationMode),
    onSetAbsenceOverride: guardEdit(handleSetAbsenceOverride),
    onSetPlanWindow: guardEdit(handleSetPlanWindow),
    onSetBudgetFollowsPlan: guardEdit(handleSetBudgetFollowsPlan),
    onEditResource: guardEdit(handleEditResource),
    onBulkEditResources: guardEdit(handleBulkEditResources),
    onBulkDeleteResources: guardEdit(handleBulkDeleteResources),
    onAddResource: guardEdit(handleOpenAddResource),
    onImportOutlook:
      canImportOutlookContacts({ m365Enabled, isPopout, importLoading })
        ? guardEdit(() => { void handleOpenOutlookImport(); })
        : undefined,
    onImportOutlookCalendar:
      outlookCalendarEnabled && msAuth.account
        ? guardEdit(() => { void handleOpenCalendarImport(); })
        : undefined,
    onEditTask: openEditModal,
    onChangeBudgets: guardEdit(commitBuckets), // ★★★ keep guarded — why, and why onCreateResource can't be: task-manager.popout-guard.test.tsx
    onRefreshFx: () => { void refreshFx().then((err) => { if (err) reportSilentFailure(showToast, lang, "fx.refreshFailed", new Error(err), "guardFxRefreshFailed"); }); },
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
    // Insights lifecycle bag (#6B SP1/SP2).
    insightActions: isPopout ? undefined : insightActions,
    // Which insight (if any) currently has an AI recommendation generating —
    // lets a card/row show a busy state (rendering lands in Task 10).
    insightGeneratingId: isPopout ? undefined : insightGeneratingId,
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
        ? { onPush: committeePush.pushToOutlook, pushingTarget: committeePush.pushingTarget, onPushRow: committeePush.pushToOutlook }
        : undefined,
    committeeReport: meetingReportActions,
    guides: operatingGuides.guides,
    guidesReady: operatingGuides.ready,
  };

  const workspaceEl = <WorkspaceSection {...workspaceProps} />;
  const workspaceFullBleedEl = <WorkspaceSection {...workspaceProps} fullBleed />;

  const tasksSectionEl = (
    <TasksSection
      lang={lang}
      today={today}
      // The SAME holidaySet useBulkOperations gets — the pane and the hook must
      // not derive the health filter's day context independently.
      holidaySet={holidaySet}
      fillHeight={settings.layout === "modern"}
      nextActions={nextActions}
      onOpenAction={openAction}
      onShowActions={() => setActiveTab("actions")}
      showViewHints={settings.showViewHints !== false}
      isPopout={isPopout}
      onLearnMoreHint={requestHelpConcept}
      projectId={calendarProjectId}
      settingsProjectId={portfolioCurrentId ?? "default"}
      m365Configured={m365Enabled}
      dispatcher={dispatcher}
      logActivity={logActivity}
      captureFieldEdit={undoApi.captureFieldEdit}
      captureMerge={undoApi.capture}
      jiraSiteUrl={settings.jira.siteUrl}
      jiraExtraProjects={settings.jira.extraProjects ?? NO_JIRA_EXTRA_PROJECTS}
      onToggleSelect={onToggleSelect}
      onOpenNotes={openTaskNotes}
      onJumpToRaid={onJumpToRaid}
      onSendInquiry={onSendInquiry}
      onPushToJira={onPushToJira}
      onStatusChange={onStatusChange}
      onSwimlaneDrop={onSwimlaneDrop}
      onEdit={onEdit}
      onDelete={onDelete}
      hiddenCols={hiddenCols}
      setHiddenCols={setHiddenCols}
      sizedWidths={sizedWidths}
      colConfigOpen={colConfigOpen}
      setColConfigOpen={setColConfigOpen}
      colConfigRef={colConfigRef}
      startColResize={startColResize}
      resetColWidths={resetColWidths}
      tableRef={tableRef}
      resetTableSize={resetTableSize}
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
      clearAllRequestNonce={clearAllRequestNonce}
      onClearAllRequestConsumed={onClearAllRequestConsumed}
      selectedIds={selectedIds}
      allVisibleSelected={allVisibleSelected}
      selectedJiraCount={selectedJiraCount}
      toggleSelectAllVisible={toggleSelectAllVisible}
      clearSelection={clearSelection}
      handleBulkSendInquiry={handleBulkSendInquiry}
      handleBulkDelete={handleBulkDelete}
      applyBulkEdit={applyBulkEdit}
      cancelBulkEdit={cancelBulkEdit}
    />
  );

  // Send inquiry / Push to Jira — only for an EXISTING task, never in popouts
  // (read-only). Push is additionally hidden for unconfigured Jira or an
  // already-synced task. Threaded into the TaskFormModal footer as leadingActions.
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

  // Footer leading actions for the modal editor: send-inquiry/push-Jira plus the
  // two-way Jira sync button for a Jira-linked task (was the full-page editor's
  // footer; now shared by the modal in every layout).
  const editorLeadingActions = (
    <>
      {editorActions}
      {editingIsJiraLinked && settings.jira.enabled && (
        <button
          type="button"
          onClick={() => { void handleJiraSync(); }}
          disabled={jiraSyncing}
          className="rounded-md border border-line bg-surface px-4 py-1.5 text-sm font-medium text-ui-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 dark:border-line dark:bg-surface dark:text-ui-light-grey dark:hover:bg-surface-muted"
        >
          {t(lang, jiraSyncing ? "jiraSyncing" : "jiraSync")}
        </button>
      )}
    </>
  );

  // Delete button — left side of footer, only for an EXISTING task, never in popouts.
  const editorDeleteAction =
    editingTask && !isPopout ? (
      <TaskDeleteButton lang={lang} taskId={editingTask.id} onDelete={onDelete} />
    ) : null;

  // Shared editor extras (create-RAID mini-form + new-linked-task button, on
  // one row), mounted below the fields in the modal editor. Never in popouts.
  const editorExtrasEl = !isPopout ? (
    <TaskEditorExtras
      lang={lang}
      onAddRaid={handleAddRaidFromEditor}
      pendingRaid={editorBuffer.pendingRaid}
      onNewLinkedTask={() => setLinkedTaskOpen(true)}
    />
  ) : null;

  const settingsViewEl = (
    <SettingsView
      lang={lang}
      settings={settings}
      onChange={setSettings}
      // portfolioCurrentId (NOT raw currentProjectId) — matches the key the views
      // read appearance under (workspace-section uses portfolioCurrentId), so a
      // per-project appearance override applies in Turso portfolio mode too.
      projectId={portfolioCurrentId ?? "default"}
      onCommitFeatures={handleCommitFeatures}
      storageDescription={storageDescription}
      storageReady={storageOk}
      onPickStorageFile={onPickStorageFile}
      onOpenStorageFile={onOpenStorageFile}
      onGrantStorageWrite={onGrantWriteAccess}
      onRequestStorageSwitch={onRequestStorageSwitch}
      onReloadProject={isPopout ? undefined : () => { void reloadCurrentProject(); }}
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
      resources={resources}
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
        onReload: () => { void reloadCurrentProject(); },
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

  // Both header mounts (classic AppHeader + modern TopBar trailing slot) are
  // built together in buildShellChrome so a new top-bar control lands in BOTH.
  const undoControlEl = isPopout ? null : (
    <>
      <UndoControl lang={lang} depth={undoApi.stack.length} onUndo={undoApi.undo} nextLabel={undoApi.stack[undoApi.stack.length - 1]?.label} />
      <RedoControl lang={lang} depth={undoApi.redoStack.length} onRedo={undoApi.redo} nextLabel={undoApi.redoStack[undoApi.redoStack.length - 1]?.label} />
    </>
  );
  const { appHeaderEl, topBarMenus } = buildShellChrome({
    handleCancelEdit,
    setTaskModalOpen,
    showToast,
    handleCommand,
    storageDescription,
    storageOk,
    onPickStorageFile,
    onOpenStorageFile,
    onGrantWriteAccess,
    onRequestStorageSwitch,
    setSettings,
    settings,
    additionalTimezones: effectiveSettings.additionalTimezones ?? [],
    projectSwitcher,
    lang,
    activeTab,
    nowCount,
    setActiveTab,
    migrateCurrentProjectToTurso,
    openPopoutWindow,
    requestChat,
    projectTemplates,
    handleSaveTemplate,
    handleApplyTemplate,
    undoControl: undoControlEl,
  });

  // The Birthday / Jira-token / Storage reminder banners, shared by the classic
  // tree (rendered after AppHeader) and the modern tree (ModernShell `banners`
  // slot). Due / RAID-review / stakeholder-comms nudges moved into the Action
  // Center. Gates kept verbatim — popouts (`!isPopout`) still suppress these.
  const bannersEl = (
    <>
      {!isPopout && !birthdaySnooze.isSnoozed && !birthdayDismissed && birthdayItems.length > 0 && (
        <BirthdayBanner items={birthdayItems} lang={lang} onDismiss={() => setBirthdayDismissed(true)} onSnooze={birthdaySnooze.snooze} />
      )}
      {!isPopout && jiraTokenAlert && !jiraTokenSnooze.isSnoozed && !jiraTokenDismissed && effectiveNotifications.jiraTokenError.enabled && (
        <JiraTokenBanner
          alert={jiraTokenAlert}
          lang={lang}
          onSnooze={jiraTokenSnooze.snooze}
          onDismiss={() => setJiraTokenDismissed(true)}
        />
      )}
      {!isPopout && storageError && !storageErrorDismissed && (
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
      {!isPopout && reviewInsight?.recommendation && reviewPlan && (
        <RecommendationReviewModal
          lang={lang}
          summary={reviewInsight.recommendation.summary}
          plan={reviewPlan}
          onConfirm={() => { void confirmInsightRecommendation(); }}
          onCancel={() => setReviewInsightId(null)}
        />
      )}
      <CalendarSummaryModals
        lang={lang}
        milestones={milestones}
        pushableRaid={pushableRaid}
        pushableChanges={pushableChanges}
        pushableAbsences={pushableAbsences}
        calendarPull={calendarPull}
        raidPull={raidPull}
        changePull={changePull}
        absencePull={absencePull}
      />
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
          sending: t(lang, "commSendPreviewSending"),
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
        taskEditorActions={editorLeadingActions}
        taskDeleteAction={editorDeleteAction}
        taskEditorExtras={editorExtrasEl}
        taskOnOpenNotes={editingId !== null ? () => openTaskNotes(editingId) : undefined /* existing task only; a new draft has no id to target */}
        taskNotePanel={editingId !== null ? notePanelPropsFor("task", editingId) : undefined /* existing task only; a new draft has no id to write to */}
        budgetLink={budgetLink}
        jiraConflicts={jiraConflicts}
        handleResolveConflicts={handleResolveConflicts}
        clearConflicts={clearConflicts}
        editingAbsence={editingAbsence}
        absenceKnownAssignees={absenceKnownAssignees}
        handleSaveAbsence={handleSaveAbsence}
        handleDeleteAbsence={handleDeleteAbsence}
        handleCloseAbsenceModal={handleCloseAbsenceModal}
        editingCalendarEvent={editingCalendarEvent}
        handleSaveCalendarEvent={handleSaveCalendarEvent}
        handleDeleteCalendarEvent={handleDeleteCalendarEvent}
        handleCloseCalendarEventModal={handleCloseCalendarEventModal}
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
        onAddAssigneeToAddressBook={handleAddAssigneeToAddressBook}
        editingResource={editingResource}
        onSaveResource={handleSaveResourceFromAnywhere}
        onDeleteResource={handleDeleteResource}
        onCloseResourceModal={handleCloseResourceFromAnywhere}
        toast={toast}
        onToastPause={pauseToast}
        onToastResume={resumeToast}
      />
      {linkedTaskOpen && (
        <TaskLinkedTaskModal
          lang={lang}
          today={today}
          onCreate={handleCreateLinkedTask}
          onClose={() => setLinkedTaskOpen(false)}
        />
      )}
      {!isPopout && <NotesWindow {...notesWindowProps} />}
    </>
  );

  // The existing tree. Its root className already branches on isPopout, so this
  // single definition serves both the classic main window AND every popout.

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
        onNavigate={setActiveTab}
        version={APP_VERSION_LABEL}
        mode={appMode}
        bannerCount={nowCount}
        onShowAlerts={() => setActiveTab("actions")}
        onOpenAiAssistant={() => openPopoutWindow("chat", settings.popout.reuseWindow)}
        search={
          <div className="w-44 max-w-[55vw] sm:w-72 lg:w-96">
            <GlobalSearchConnected lang={lang} />
          </div>
        }
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
              void msAuth.signOut().catch((e) => reportSilentFailure(showToast, lang, "msauth.signInFailed", e, "guardMsSignInFailed"));
            }}
          />
        }
        tasksSection={tasksSectionEl}
        workspace={workspaceFullBleedEl}
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
          <ToastProvider value={toastApi}>
            <VoiceCommandProvider value={voiceHandlers}>
              <ConfirmProvider lang={lang}>
                <DisplayTimezoneProvider effectiveTz={effectiveTz} showSwitcher={!!settings.showDisplayTzSwitcher}>{legacyTree}</DisplayTimezoneProvider>
              </ConfirmProvider>
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

  // Turso-mode load gate: the project list is fetched async after hydrate, and
  // `showEmptyState` can only decide once it lands. Cover that window with a
  // loading placeholder — otherwise the main app renders over an empty in-memory
  // workspace and then bounces to the empty-state when an empty list resolves
  // (the "full app flash before the new-project screen" bug on portfolio switch).
  // ★ Gate on `!storageError`: if the list fetch FAILS (unreachable DB / bad
  // token), `tursoListLoaded` never flips, so without this the skeleton would
  // render forever with no banner/nav. Falling through to the app tree on an
  // error restores the storage-error banner + Settings recovery path.
  const showTursoListLoading =
    hydrated && portfolioMode === "turso" && !tursoListLoaded && !showTursoUnlock && !storageError;

  return (
    <ActivityLogProvider value={logActivity}>
      <AiUsageProvider lang={lang} ai={settings.ai} showToast={showToast}>
        <ToastProvider value={toastApi}>
          <VoiceCommandProvider value={voiceHandlers}>
            <ConfirmProvider lang={lang}>
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
            ) : showTursoListLoading ? (
              <PanelSkeleton lang={lang} />
            ) : settings.layout === "classic" ? (
              legacyTree
            ) : (
              modernTree
            )}
            </DisplayTimezoneProvider>
            </ConfirmProvider>
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
