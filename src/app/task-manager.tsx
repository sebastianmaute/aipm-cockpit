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
import { splitName, resourceDisplayName, backfillTaskResourceFks } from "./resource-foundation";
import { mintId, peekMintId, seedMintFromWorkspace } from "./id-mint-session";
import { buildRaidByTaskIndex, nextRaidId } from "./raid";
import { buildChangeByTaskIndex } from "./change-log";
import { indexDocumentsByEntity } from "./document-ref";
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
import { BirthdayBanner, JiraTokenBanner, StorageBanner, SavingPausedBanner } from "./notifications";
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
// The repo-wide partition key for "no project id to give". Named in the assets
// schema because that is where the policy is written down, but the policy is
// general — see its docstring before spelling a bare "default" anywhere.
import { ASSET_PARTITION_FALLBACK } from "./document-assets-schema";
import { workspaceToJson, jsonToWorkspace, type Workspace } from "./workspace";
import { buildDashboardInput, computeDashboard } from "./dashboard";
import { detectInsights, type InsightInput } from "./insights/detect";
import { insightsMateriallyEqual, reconcileInsights } from "./insights/reconcile";
import { loadLandingState } from "./landing-state";
import { metricAtActionPatch } from "./insights/outcome";
import { useInsightRecommendations } from "./use-insight-recommendations";
import { RecommendationReviewModal } from "./insights/recommendation-review-modal";
import { executeActionCta } from "./action-cta-exec";
import { getTursoConfig } from "./turso-config";
import { aiAssistantOpener, aiKeyIfEnabled, isAiEnabled, defaultExportConfig, defaultNextActionsLearning, defaultSnapshotSettings, type JiraExtraProject, type Settings } from "./settings-types";
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
import { resolveTimezone, createProjectClock } from "./timezone";
import { DisplayTimezoneProvider } from "./display-timezone-context";
import { ConfirmProvider } from "./confirm-dialog";

// ★ `effectiveToday(tz)` lived here until §159; `createProjectClock` (timezone.ts) now owns that derivation and keeps the day welded to its zone. Do NOT reintroduce a local one — a second producer of `today` is what let an inconsistent pair exist.
// Connected display-timezone switcher. A module-level wrapper (static-components
// rule) so it can read the DisplayTimezoneContext that wraps both shells — the
// header element it produces is rendered inside the provider in both layouts.

// Idle window before an auto version is captured after a save. Coalesces a
// burst of saves into a single version.
const VERSION_IDLE_MS = 180_000; // 3 minutes

// Debounce before the insights detect→reconcile runner fires, so a burst of
// edits collapses into one recompute (#6B Insights → Action Loop, SP1).
const INSIGHTS_RECONCILE_DEBOUNCE_MS = 4_000;

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
  // ★★★ USER-ACTOR WIRING — every `logActivity:` below MUST read `logActivityUser`; see the "who names the actor" rule on useActivityLog. Threading the raw one shipped ZERO "user" entries.
  // ★★ THE PIN COVERS TWO OF THE WIRING SITES, NOT ALL OF THEM — this line used to say "Pinned by task-manager.activity-actor.test.tsx" flat, which reads as coverage of the whole rule. That file drives exactly two threads through the real component: `useChangeLog` (via `handleSaveChange`) and `useStakeholders` (via `handleSaveStakeholder`), plus a control that `logActivityAs("ai")` stays distinct and the `logActivityChangesUser` field-diff variant on the change thread. Every OTHER site below — resource planner, budget buckets, notes window, undo stack, the inline `logActivityUser(...)` calls, and the remaining hook threads — is UNPINNED: swapping one back to the raw `logActivity` drops its actor silently and the suite stays green. ★ Count those by eye, not by grepping this file for `logActivityUser`: THIS COMMENT matches that grep, so the count comes back inflated by the line quoting it.
  const { activityLog, logActivity, logActivityAs, logActivityUser, logActivityChangesUser, handleClearActivityLog } =
    useActivityLog();
  const { toast, showToast, showToastAction, pause: pauseToast, resume: resumeToast } = useToast();
  // Local in-memory undo (deletes / clear-all / bulk-edit across every entity).
  // capture is threaded into each entity hook below; undo/control are surfaces. ★ Undo/redo is ALWAYS user-caused — a chat tool write takes no undo capture.
  // ★ `allowDestructiveSave` is produced by `useStorageBackend` further down, so
  // it does not exist at this call site. Forward it through a ref filled by the
  // effect below — the same pattern `use-reference-data.ts` uses for THIS VERY
  // callback (`allowDestructiveRef.current = args.allowDestructiveSave`, spent at
  // `allowDestructiveRef.current?.()`), and `use-bulk-operations.ts` and
  // `use-document-assets.ts` use for the same one. Moving the `useUndoStack` call
  // down instead would also move `useUndoHotkey`'s listener registration relative
  // to the other hotkey hooks.
  const allowDestructiveSaveRef = useRef<(() => void) | undefined>(undefined);
  const armDestructiveForUndo = useCallback(() => { allowDestructiveSaveRef.current?.(); }, []);
  const undoApi = useUndoStack({ lang, logActivity: logActivityUser, showToast, showToastAction, allowDestructiveSave: armDestructiveForUndo });
  useUndoHotkey(undoApi.undo, undoApi.redo);
  // Stable identity so ToastProvider consumers don't re-render on every parent render.
  const toastApi = useMemo(() => ({ showToast, showToastAction }), [showToast, showToastAction]);

  const { workspaceCollapsed, setWorkspaceCollapsed } = useWorkspaceCollapsed();
  const { collapsed: sidebarCollapsed, toggle: toggleSidebar } = useSidebarCollapsed();
  const {
    sizedWidths,
    hiddenCols,
    setHiddenCols,
    resetColWidths,
    startColResize,
  } = useColumnManager();
  const { isPopout, activeTab, setActiveTab, requestOpen, pendingOpen, clearPendingOpen, requestChat, requestHelpConcept, requestDocumentsForEntity } = useWorkspaceTab();
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
    knowledgeItems,
    setKnowledgeItems,
    insights,
    documents, documentVersions, setInsights, setDocuments, setDocumentVersions,
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

  const { setContacts, contactsList, handleRemoveContact } = useContacts({ hydrated, tasks });

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
  // ★★★ THE SINGLE DERIVATION POINT FOR THIS CHAIN (§159): `createProjectClock` computes the day FROM the zone internally, so the two cannot be resolved independently and handed on as a disagreeing pair. `today` below is a READ off that one object — never reintroduce a separate `effectiveToday(...)` call.
  // ★★ "FOR THIS CHAIN" IS LOAD-BEARING — it is NOT the only producer of a day in the app, and an earlier wording of this comment implied it was. `use-bulk-operations.ts` derives its own via `todayInZone(new Date(), tz)`; reproduce with `grep -rn "todayInZone(new Date()" src/app --include=*.ts | grep -v test` → one hit.
  // ★★★ THAT SECOND PRODUCER AGREES WITH THIS ONE, and an earlier revision of this comment asserted the opposite — that it read RAW `settings.timezone` while this reads `effectiveSettings.timezone`, so the two "disagree" under a project override and a bulk edit could stamp `completedDate` in the wrong zone. FALSE, and invented whole: `useBulkOperations` is handed `settings: effectiveSettings` (see its call site below), so `args.settings.timezone` IS `effectiveSettings.timezone`, and both sites call `resolveTimezone` with identical arguments. They cannot diverge under an override or otherwise. Verify with `git grep -n "resolveTimezone(" -- src/app/task-manager.tsx src/app/use-bulk-operations.ts` — two hits, same two arguments. Recorded rather than deleted because the false version shipped a plausible-sounding data-integrity bug that no gate can see: `docs:symbols:check` proves every name in it exists, which was never the question.
  const clock = createProjectClock(effectiveTz);
  const today = clock.today;

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
  const [storageErrorDismissed, setStorageErrorDismissed] = useState(false); // ★ §103's banner dismissal is SEPARATE and hides only the banner — the save guard stays armed (use-load-truncation.ts).
  const [truncationBannerDismissed, setTruncationBannerDismissed] = useState(false);
  const [destructiveBannerDismissed, setDestructiveBannerDismissed] = useState(false);
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
    allowDestructiveSaveAnyway, destructiveRefusal,
    truncation, decodeFailureCount, decodeFailureNonce, malformedQuoteCount, malformedQuotesNonce, loadWasIncomplete, allowIncompleteSave,
    switchToProject, createProject, createDemoProject, loadProjectFromFile,
    switchToTursoProject, createTursoProject, migrateCurrentProjectToTurso, archiveTursoProject,
    restoreTursoProject, hardDeleteTursoProject, tursoProjectId,
  } = useStorageBackend({ settings, lang, hydrated, isPopout, showToast, showToastAction, onRevealSavingPaused: () => setDestructiveBannerDismissed(false), setStorageConfig: (storageConfig) => setSettings((s) => ({ ...s, storageConfig })), onStorageOutcome: reportStorageOutcome, onRegistryChange: setRegistry });

  // Fills the forward-ref declared above `useUndoStack`, so an undo-stack redo
  // that re-removes rows can arm the one-shot destructive-save bypass (§295).
  useEffect(() => { allowDestructiveSaveRef.current = allowDestructiveSave; }, [allowDestructiveSave]);

  // ★★ Render-time reconcile, NOT an effect (`set-state-in-effect` is banned): a NEW
  // incomplete load re-shows the banner after a dismiss (the ONLY "Save anyway" surface).
  // ★ Keyed on the counts OBJECT — the boolean never lowers between two truncated loads.
  // ★★★ AND ON THE DECODE NONCE, because the guard has TWO causes and the object
  // covers only one: on the decode path `truncation` is `null` throughout, so a
  // key made of it alone never moves and project #2's banner arrives ALREADY
  // DISMISSED with saving paused and nothing on screen saying so. The nonce and
  // not `decodeFailureCount`: a count compares equal when two projects fail the
  // same NUMBER of slices, which reads as fixed while the defect survives.
  const [truncationSeen, setTruncationSeen] = useState<typeof truncation>(null);
  // ★ Seeded with the guard's OWN starting value, not with the live one. The
  // guard mounts in this same render (task-manager calls the hook that owns it),
  // so 0 is what it really is here — and seeding from the live value is the
  // remount-swallow shape, where a fresh mount sees `value === seed` and drops a
  // pending report.
  const [decodeNonceSeen, setDecodeNonceSeen] = useState(0);
  // ★★★ AND ON THE MALFORMED NONCE, for the THIRD cause and by the identical
  // argument: on the import path `truncation` is null and `decodeFailureNonce`
  // never moves, so a key made of those two alone cannot see a malformed-only
  // load at all — project #2's banner arrives already dismissed with saving
  // paused. The comment above records this exact defect being fixed once for the
  // decode cause; adding a third cause to `loadWasIncomplete` without extending
  // this key reintroduced it.
  const [malformedNonceSeen, setMalformedNonceSeen] = useState(0);
  if (
    truncation !== truncationSeen ||
    decodeFailureNonce !== decodeNonceSeen ||
    malformedQuotesNonce !== malformedNonceSeen
  ) {
    setTruncationSeen(truncation);
    setDecodeNonceSeen(decodeFailureNonce);
    setMalformedNonceSeen(malformedQuotesNonce);
    setTruncationBannerDismissed(false);
  }

  // ★★ The SAME render-time reconcile for the OTHER saving-paused cause (an
  // effect is impossible — `set-state-in-effect` is banned and fatal). Without
  // it the dismissal is sticky ACROSS episodes: dismiss, the refusal RESOLVES,
  // and a later, different refusal raises the banner ALREADY HIDDEN. What is
  // left is only the transient toast plus whichever standing hint the layout
  // has: `hasFooterIndicator` is `layout !== "classic"`, and
  // `SavingPausedBanner`'s dismissed branch returns null when that is true — so
  // DEFAULT layouts fall back to the footer indicator alone, and classic to the
  // compact re-open chip. Neither names the magnitude the banner would.
  // ★★★ KEYED ON THE REFUSAL OBJECT, and what it DEPENDS ON is
  // `useDestructiveSaveGuard`'s `sameRefusal` functional setter: identity is
  // stable for as long as one refusal stands, so a dismiss survives every
  // re-refusal (one per edit while paused) and only a genuinely different
  // refusal re-shows the banner. Lose that stability and every re-refusal
  // re-shows a banner the user just dismissed.
  // ★★ WHAT THE OBJECT KEY BUYS, MEASURED, IS OVER A **BOOLEAN** KEY — AND ON
  // EXACTLY ONE INPUT. `destructiveRefusal !== null` fails only on an ESCALATION
  // WITH NO INTERVENING NULL: the refusal never resolves, the user deletes more,
  // `evaluate` mints a new object because the counts moved, and the boolean never
  // flips, so a dismissed banner stays hidden while the claim it was dismissing
  // has changed. A second EPISODE it handles fine — the resolution in between
  // flips it. Pinned by "an ESCALATING refusal re-shows a dismissed banner while
  // it still stands" in `task-manager.truncation-banner.test.tsx`, the only one of
  // that file's three reconcile tests to go red under a boolean key.
  // ★★★ A COUNTS-DERIVED KEY IS EQUIVALENT, NOT WORSE. `sameRefusal` makes object
  // identity ⟺ the counts tuple, so NO input separates object from counts: a
  // faithful counts key was measured green. Prefer the object key because it does
  // not restate `sameRefusal`'s field list — which would drift the day a field is
  // added to it — NOT because it catches anything extra.
  // ★ Do not "simplify" it to a nonce: there is none to bump — the guard's state
  // IS the event.
  // ★ Resetting on the transition to `null` is deliberate, not sloppiness: the
  // banner mounts only while `destructiveRefusal !== null`, so nothing appears
  // when a refusal resolves — clearing the flag as the episode ENDS is precisely
  // what leaves the NEXT one visible.
  // ★ Seeded `null`, the guard's OWN starting value rather than the live one —
  // it mounts in this same render (task-manager calls the hook that owns it), so
  // null is what it really is here, and seeding from the live value is the
  // remount-swallow shape that drops a pending report.
  const [destructiveRefusalSeen, setDestructiveRefusalSeen] = useState<typeof destructiveRefusal>(null);
  if (destructiveRefusal !== destructiveRefusalSeen) {
    setDestructiveRefusalSeen(destructiveRefusal);
    setDestructiveBannerDismissed(false);
  }

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
    logActivityAs,
    onJiraAuthResult: (ok: boolean) =>
      setSettings((s) => ({ ...s, jira: { ...s.jira, tokenInvalidAt: ok ? undefined : new Date().toISOString() } })),
  });

  const currentProjectId = registry.currentProjectId;
  const currentEntry = getCurrentEntry(registry);
  // Prefer the live in-memory project meta name (set by the active backend's
  // load — file OR turso tenant); fall back to the file registry entry's stored
  // name (file mode only), then null (the switcher shows a "no project" label).
  const currentProjectName = project?.name ?? (portfolioMode === "turso" ? null : currentEntry?.name) ?? null;

  // The status bubble must reflect real reachability: a stale Turso config is
  // `isReady()`-true but failing, so fold in the error. ★★★ `loadWasIncomplete` is NOT:
  // 2 of 3 consumers are `StorageConfigSection` (`ready`), where false means UNCONFIGURED
  // (bogus "permission needed"/Turso "needs config"). Only the footer DOT means healthy, so that ONE call site applies the truncation term itself.
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
  // ONE reverse index for the linked-documents row badge, threaded down: built
  // per-panel it would be three indexes over one array, per-row it would rebuild.
  const documentsByEntity = useMemo(() => indexDocumentsByEntity(documents), [documents]);
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
  } = useResourcePlanner({ lang, today, logActivity: logActivityUser, logActivityChanges: logActivityChangesUser, showToast, workdayHours: settings.resources.workdayHours, holidaySet, capture: undoApi.capture, captureComposite: undoApi.captureComposite, captureFieldEdit: undoApi.captureFieldEdit, captureFieldRows: undoApi.captureFieldRows, allowDestructiveSave });

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
  const { handleSaveChange, handleDeleteChange, handleChangeStatusChange, captureBulkUndo: captureChangeBulk } = useChangeLog({ today, lang, showToast, logActivity: logActivityUser, logActivityChanges: logActivityChangesUser, capture: undoApi.capture, captureFieldEdit: undoApi.captureFieldEdit, captureFieldRows: undoApi.captureFieldRows, allowDestructiveSave });

  // Stakeholder register / RACI / map CRUD. The hook reads/writes `stakeholders`
  // via WorkspaceProvider; the three panels source `resources`/`milestones` from
  // context inside WorkspaceSection.
  const { stakeholders, handleSaveStakeholder, handleDeleteStakeholder, captureBulkUndo: captureStakeholderBulk } =
    useStakeholders({ today, lang, showToast, logActivity: logActivityUser, logActivityChanges: logActivityChangesUser, capture: undoApi.capture, captureFieldEdit: undoApi.captureFieldEdit, captureFieldRows: undoApi.captureFieldRows, allowDestructiveSave });

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
  // that references them) live in `useInsightRecommendations`
  // (use-insight-recommendations.ts) — apply replays proposed tool calls
  // through `dispatcher`, so that hook is called right after `dispatcher` is
  // created, below.

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

  // Lazily serialize the CURRENT workspace for a version-history capture. The field
  // set mirrors `applyRestoredWorkspace` below — capture and restore must agree or a
  // restore blanks what the capture never carried. NOT the save/export set in
  // `use-storage-backend.ts` (which also carries fieldVisibility, features,
  // documentAssets, activityLog). Placed after the stakeholders hook for scope.
  // ★★ `documentAssets` is DELIBERATELY not captured — the decision, its two reasons and its user-visible consequence are recorded in docs/AGENTS/documents.md, "Asset images (S3c-1)" (open-followups §254); pinned by "captures documents but not documentAssets".
  const getVersionPayload = useCallback(
    () => workspaceToJson({
      tasks, raid, absences, shifts, resources, roles, disciplines, grades,
      plan, budgets, fxRates, status, project, milestones, changes, stakeholders,
      steeringCommittee, timelogLinks,
      knowledgeItems, insights, documents, documentVersions, settingsOverrides, calendarEvents,
    }),
    [tasks, raid, absences, shifts, resources, roles, disciplines, grades,
     plan, budgets, fxRates, status, project, milestones, changes, stakeholders,
     steeringCommittee, timelogLinks,
     knowledgeItems, insights, documents, documentVersions, settingsOverrides, calendarEvents],
  );

  // Fan a restored workspace into every setter — the SECOND load funnel, so it
  // repeats applyWorkspace's task-FK backfill (but NOT `workspaceLoaded`: see it).
  // ★★ `activityLog` is DELIBERATELY MISSING, and missing STRUCTURALLY: no `setActivityLog` binding exists
  // in this file, so the blanking line cannot be written without first bringing a setter into scope. Why —
  // and what still differs between the two funnels — is in `docs/AGENTS/activity-log.md`, not AGENTS.md.
  const applyRestoredWorkspace = useCallback((w: Workspace) => {
    setTasks(backfillTaskResourceFks(w.resources ?? [], w.tasks ?? [])); setRaid(w.raid ?? []); setAbsences(w.absences ?? []); setShifts(w.shifts ?? []);
    setResources(w.resources ?? []); setRoles(w.roles ?? []); setDisciplines(w.disciplines ?? []); setGrades(w.grades ?? []);
    if (w.plan) setPlan(w.plan); setBudgets(w.budgets ?? []); setFxRates(w.fxRates ?? null); setStatus(w.status ?? {});
    setProject(w.project); setMilestones(w.milestones ?? []); setChanges(w.changes ?? []); setStakeholders(w.stakeholders ?? []);
    setSteeringCommittee(w.steeringCommittee); setTimelogLinks(w.timelogLinks); setKnowledgeItems(w.knowledgeItems); setInsights(w.insights); setDocuments(w.documents ?? []); setDocumentVersions(w.documentVersions ?? []); setSettingsOverrides(w.settingsOverrides); setCalendarEvents(w.calendarEvents);
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
  // ★★★ THE NON-PORTFOLIO BRANCH MUST NOT BE `""`, AND IT WAS. `enabled` below
  // and the sidebar entry both key off `settings.storageConfig.kind` (the
  // single-DB Turso STORAGE backend) while this line keyed off `portfolioMode`
  // (the multi-project PICKER, which defaults to "file"). The two disagree for
  // exactly one configuration — Turso storage without a migrated portfolio —
  // and `use-version-history.ts` folds `!!projectId` into its `active`
  // predicate, so `""` switched the whole feature OFF while the view stayed
  // visible: an empty timeline and a "save version" that silently did nothing,
  // with no error, because the store was never called. Same class AGENTS.md
  // records for the chat thread sidebar; `trendsActive` above is the correct
  // pattern and ORs both signals.
  // ★★ THE PORTFOLIO BRANCH DELIBERATELY KEEPS `""`. There the empty id means
  // "no project selected yet", and the hook's inertness is load-bearing —
  // folding it to the fallback would capture one project's versions under a
  // shared key during a switch. Only the non-portfolio branch is wrong.
  // ★ Deliberately NOT applied to the `useSnapshots` and
  // `useMeetingReportActions` call sites, which pass the same expression:
  // neither guards on `!!projectId`, so both already write and read under `""`
  // self-consistently, and moving their key would orphan every existing row
  // behind a migration those tables have no version marker to drive (the
  // reasoning is in `document-assets-schema.ts`). Version history has written
  // nothing for these users, so it alone is free to move.
  const versionHistory = useVersionHistory({
    config: tursoConfig,
    projectId: portfolioMode === "turso" ? (tursoProjectId ?? "") : ASSET_PARTITION_FALLBACK,
    enabled: settings.storageConfig.kind === "turso" && !isPopout && isModuleEnabled("history", settings.features),
    idleMs: VERSION_IDLE_MS,
    retention: settings.versionHistoryRetention ?? DEFAULT_VERSION_RETENTION,
    getPayload: getVersionPayload,
    applyWorkspace: applyRestoredWorkspace,
    logActivity: logActivityUser,
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
      logActivityUser("resource.created", id, `${firstName} ${lastName}`.trim());
      return id;
    },
    [resources, setResources, logActivityUser],
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
      // ★★ THREE ARGS, ORDER (id, category, title) — matching `use-resource-planner.ts`. `activityRaidCreated` is "RAID #{0} created ({1}): {2}" and `logActivityUser` ends in `...args`, so a two-arg call typechecks; it shipped, putting the title in the CATEGORY slot and rendering a literal "{2}" to the user and (since search_history) to the model. Read the SANITIZED row, not `spec` — `sanitizeRaidItem` decides what was stored. ★★ THE ARITY HERE IS UNPINNED: no harness reaches this call site, so DELETING `clean.category` re-creates the defect and ships GREEN. `use-notes-window.test.tsx` pins only the sibling `raid.updated` sites, and `use-resource-planner.test.tsx` only its own `handleSaveRaidItem` — neither reaches here.
      logActivityUser("raid.created", clean.id, clean.category, clean.title);
    },
    [setRaid, today, logActivityUser],
  );
  const applyLinkFromTask = useCallback(
    (parentId: number, spec: LinkSpec) => {
      setTasks((prev) => applyTaskLink(prev, parentId, spec));
    },
    [setTasks],
  );
  const { commitBuckets } = useBudgetBuckets({ budgets, setBudgets, allowDestructiveSave, capture: undoApi.capture, captureComposite: undoApi.captureComposite, logActivity: logActivityUser });
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
      logActivityUser("task.created", childId, child.taskName);
      const spec: LinkSpec = { childId, direction: draft.direction, type: "FS" };
      if (editingId !== null) applyLinkFromTask(editingId, spec);
      else stageEditorLink(spec);
      // NOTE (by design): the child task is committed here immediately (real id),
      // while for a NEW parent only the LINK is staged. Cancelling the parent
      // editor discards the staged link but keeps the child task — a nested child
      // is a real task the moment it's saved, independent of the parent's outcome.
      setLinkedTaskOpen(false);
    },
    [today, setTasks, logActivityUser, editingId, applyLinkFromTask, stageEditorLink, setLinkedTaskOpen],
  );

  // Shared floating note-log window (tasks + RAID + changes), popout-gated at the mount below (see use-notes-window.ts).
  const { openTaskNotes, openRaidNotes, openChangeNotes, notesWindowProps, notePanelPropsFor } = useNotesWindow({ tasks, raid, changes, setTasks, setRaid, setChanges, selfResourceId: settings.selfResourceId, resources, lang, logActivity: logActivityUser });

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
    logActivity: logActivityUser,
    logActivityChanges: logActivityChangesUser,
    showToast,
    onPushToJiraRef,
    raid,
    setRaid,
    pendingLinkRaidIdRef,
    onTaskCreated: onTaskCreatedWithBucket,
    onEditorDiscard: onEditorDiscardWithBucket,
    captureFieldEdit: undoApi.captureFieldEdit,
    captureComposite: undoApi.captureComposite,
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
    logActivity: logActivityUser,
    capture: undoApi.capture,
    captureFieldEdit: undoApi.captureFieldEdit,
    resolveTemplateBody: resolveCommBody,
    sendCommTemplate: commSend.send,
  });

  // Task-side twin of onJumpToRaid: arms the Documents pane's entity filter for
  // one task. The registers call requestDocumentsForEntity directly; the task
  // surfaces (row + Kanban card) render outside any provider they could read it
  // from, so it is threaded down as a prop.
  const onOpenDocuments = useCallback(
    (taskId: number) => requestDocumentsForEntity("task", taskId),
    [requestDocumentsForEntity],
  );

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
    // ★★★ logActivityUser, NEVER the raw logActivity — see the USER-ACTOR
    // WIRING rule at the top of this component. Mark-done from a Next-actions
    // CTA is a user gesture, so its completion entry must carry the user actor.
    logActivity: logActivityUser,
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
    logActivity: logActivityUser,
    capture: undoApi.capture, captureFieldRows: undoApi.captureFieldRows, commitBuckets,
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

  // Debounced coarse "settings.updated" entry. Guards: (1) pre-hydration — the effect skips every run while `hydrated` is false; (2) initial mount — the first post-hydration run reflects the LOADED value, so `settingsInitialRef` suppresses it; (3) secrets — the entry carries no field values.
  // ★★★ THE ONE PRODUCTION SITE DELIBERATELY LEFT ON THE ACTOR-LESS `logActivity` — do NOT "finish the sweep" by stamping it `"user"`. It is an EFFECT over settings STATE, not a handler behind a gesture, so it cannot see its cause. A `"user"` stamp would be a guess. Absent is honest — nothing here knows who acted. ★★ STILL TRUE AFTER §160: the credit counter below does not teach this effect a cause, it only tells it that a change was ALREADY reported by someone who knew. Every row it still writes is one nothing can attribute, which is why it stays actor-less.
  const settingsLoggerRef = useRef(
    createSettingsLogger(() => logActivity("settings.updated"), SETTINGS_LOG_DEBOUNCE_MS),
  );
  const settingsInitialRef = useRef(true);
  // ★★★ §160 — settings changes the AI already logged an `"ai"` row for, which this effect must not report twice. A counter, not the time-window suppression flag that entry rejected: a human change after an AI one gets its own run, finds 0, and is logged normally.
  // ★★★ THE EFFECT CLEARS THE COUNTER, IT DOES NOT DECREMENT IT, and that asymmetry is the whole correctness argument. Credits are issued PER TOOL CALL but consumed PER EFFECT RUN, and React batches every `setSettings` of one assistant turn into ONE render — so "switch to German and turn off view hints" issues 2 credits against 1 run. Decrementing left the surplus alive indefinitely, and it silently ate the next genuine USER row, whenever that came. Clearing bounds the suppression to the turn that caused it: a leak cannot outlive the render it was created in.
  // ★★ RESIDUAL 1 (safe), deliberately accepted: if two AI settings writes in one turn are separated by a real macrotask (an intervening tool doing I/O), React renders twice, the second run finds 0 and adds one actor-less row. An EXTRA honest row beats a MISSING user row — never trade this back. Reasoning: open-followups §160.
  // ★★ RESIDUAL 2 (UNSAFE), and this comment used to claim to enumerate the residuals while listing only the harmless one: if a USER settings change and an AI write land in the SAME React batch, the single effect run consumes the credit and the USER's row is the one lost. That is §160's own failure mode, surviving at a much lower probability — the user would have to change a setting inside the same batch as an AI write, which needs a real concurrent interaction rather than an ordinary sequence. Not fixed because distinguishing the two writers inside one batch needs identity comparison, and both AI writers use functional setters (`setSettings(prev => …)`), so nothing the effect sees is reference-equal to what the dispatcher computed. Do not "close" it by switching those writers to direct-value setters: that walks into the documented "N saves in one tick" landmine.
  const aiSettingsCreditsRef = useRef(0);
  useEffect(() => {
    if (!hydrated) return;
    if (settingsInitialRef.current) {
      settingsInitialRef.current = false;
      return;
    }
    if (aiSettingsCreditsRef.current > 0) { aiSettingsCreditsRef.current = 0; return; }
    settingsLoggerRef.current.notifyChange();
  }, [settings, hydrated]);

  // ★★ Cancel only on UNMOUNT, never per run. A per-run cleanup fires BEFORE the
  // next effect body, so an AI write landing within the debounce window cancelled
  // the pending row and then early-returned without re-arming — the USER's change
  // vanished entirely. Behaviour-neutral on the normal path, since `notifyChange`
  // already restarts the timer itself.
  useEffect(() => {
    const logger = settingsLoggerRef.current;
    return () => logger.cancel();
  }, []);

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
    // ★ ONE field, not `today` + `timezone` (§159); `onSettingsLoggedByAi` is §160.
    clock,
    onSettingsLoggedByAi: () => { aiSettingsCreditsRef.current += 1; },
    setSelectedIds,
    setSettings,
    isReadOnly: isPopout,
    currentView: activeTab, settingsProjectId: landingProjectId, holidaySet, logActivityAs,
    // ★ `delete_document` is a second removal route into a COUNTED slice — see
    //   the arming site in `use-document-tools.ts`.
    allowDestructiveSave,
    getDashboardModel: () => dashboardModel,
    getBudgetRollup,
    getAllocationsSnapshot,
  });

  const {
    insightActions,
    insightGeneratingId,
    cancelInsightRecommendation,
    confirmInsightRecommendation,
    reviewInsight,
    reviewPlan,
    setReviewInsightId,
  } = useInsightRecommendations({
    isPopout, settings, lang, today, project,
    tasks, raid, milestones, changes, stakeholders,
    resourcesById, insights, setInsights, dispatcher,
    showToast, logActivityAs,
    onAcknowledgeInsight, onActInsight, onDismissInsight,
  });

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
    logActivityAs,
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
    onOpenChangeNotes: openChangeNotes,
    handleSaveRaidItem: guardEdit(handleSaveRaidItem),
    handleDeleteRaidItem: guardEdit(handleDeleteRaidItem),
    onSendRaidInquiry: isPopout ? undefined : handleSendRaidInquiry,
    onCaptureRaidBulk: captureRaidBulkUndo,
    onCaptureUndo: undoApi.capture,
    onCaptureFieldEdit: undoApi.captureFieldEdit, onCaptureFieldRows: undoApi.captureFieldRows,
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
    documentsByEntity,
    allowDestructiveSave,
    handleSaveChange: guardEdit(handleSaveChange),
    handleDeleteChange: guardEdit(handleDeleteChange),
    handleChangeStatusChange: guardEdit(handleChangeStatusChange),
    onCaptureChangeBulk: captureChangeBulk,
    stakeholders,
    handleSaveStakeholder: guardEdit(handleSaveStakeholder),
    handleDeleteStakeholder: guardEdit(handleDeleteStakeholder),
    onCaptureStakeholderBulk: captureStakeholderBulk,
    handleCreateMitigationTaskFromRaid: guardEdit(handleCreateMitigationTaskFromRaid),
    handleJumpToTaskFromRaid,
    activityLog,
    logActivity: logActivityUser,
    logActivityChanges: logActivityChangesUser, logActivityAs,
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
      // ★ Whether anything is REMOVED, decided from the live arrays before any
      // setter runs — never inside an updater, which React may invoke twice.
      // The task/raid writes below are field EDITS (they map), so they remove
      // no record and must not count; only the two filters do. `absences` and
      // `shifts` are both COUNTED slices and this route drops an UNBOUNDED
      // number of their rows on one confirm, so it can trip the save-time
      // mass-deletion guard on its own — hence the one-shot bypass, armed only
      // when a row genuinely went (arming on a no-op leaks it to a later save).
      const removesAbsence = absences.some((a) => matchName(a.assignee));
      const removesShift = shifts.some((s) => matchName(s.assignee));
      setTasks((prev) => prev.map((tk) =>
        matchName(tk.assignee) || matchEmail(tk.assigneeEmail) ? { ...tk, assignee: "", assigneeEmail: "" } : tk));
      setRaid((prev) => prev.map((r) => matchName(r.owner) ? { ...r, owner: "" } : r));
      setAbsences((prev) => prev.filter((a) => !matchName(a.assignee)));
      setShifts((prev) => prev.filter((s) => !matchName(s.assignee)));
      if (removesAbsence || removesShift) allowDestructiveSave?.();
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
    // Which insight is generating, and how to abort it. ★ The flag is PER-ROW
    // and the cancel is GLOBAL, deliberately: only one generate can be in
    // flight (`useAbortableAi.run` aborts the previous), so the global cancel
    // IS the running row's call. Feeding the hook's global `busy` here instead
    // would make EVERY row's CTA read "Stop" while one runs.
    insightGeneratingId: isPopout ? undefined : insightGeneratingId,
    onCancelInsightRecommendation: isPopout ? undefined : cancelInsightRecommendation,
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
      logActivityAs={logActivityAs}
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
      startColResize={startColResize}
      resetColWidths={resetColWidths}
      tableRef={tableRef}
      resetTableSize={resetTableSize}
      pushingIds={pushingIds}
      raidByTask={raidByTask}
      changeByTask={changeByTask}
      documentsByEntity={documentsByEntity}
      onOpenDocuments={onOpenDocuments}
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

  // Ask-Claude pill. Modern layout puts it in the TopBar's LEFT cluster beside the project
  // switcher (as projectSwitcherTrailing); classic AppHeader wires its own copy beside the
  // switcher under the title. BOTH sites must render it (dual-header rule) and BOTH gate on
  // isAiEnabled — aiAssistantOpener's check — so it cannot open a chat that has no answerer.
  const askClaudeEl = isAiEnabled(settings.ai) ? (
    <span data-tour-id={TOUR_ANCHORS.askClaude}>
      <AskClaudeMenu
        lang={lang}
        currentView={activeTab}
        onAsk={(body) => requestChat(body, true)}
      />
    </span>
  ) : null;

  // Both header mounts (classic AppHeader + modern TopBar trailing slot) are
  // built together in buildShellChrome so a new top-bar control lands in BOTH.
  const undoControlEl = isPopout ? null : (
    <>
      <UndoControl
        lang={lang}
        entries={undoApi.stack}
        onUndo={undoApi.undo}
        onUndoThrough={undoApi.undoThrough}
      />
      <RedoControl
        lang={lang}
        entries={undoApi.redoStack}
        onRedo={undoApi.redo}
        onRedoThrough={undoApi.redoThrough}
      />
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
        <JiraTokenBanner alert={jiraTokenAlert} lang={lang} onSnooze={jiraTokenSnooze.snooze} onDismiss={() => setJiraTokenDismissed(true)} />
      )}
      {!isPopout && storageError && !storageErrorDismissed && (
        <StorageBanner kind={storageError.kind} lang={lang} onOpenSettings={() => setActiveTab("settings")} onDismiss={() => setStorageErrorDismissed(true)} />
      )}
      {!isPopout && loadWasIncomplete && (
        <SavingPausedBanner lang={lang} cause={{ kind: "truncation", truncation, decodeFailureCount, malformedQuoteCount }} dismissed={truncationBannerDismissed} hasFooterIndicator={settings.layout !== "classic"} onSaveAnyway={allowIncompleteSave} onDismiss={() => setTruncationBannerDismissed(true)} onReopen={() => setTruncationBannerDismissed(false)} />
      )}
      {/* ★ A SIBLING of the truncation mount, never an `else` on it: the two causes
          are mutually exclusive UPSTREAM, by TWO mechanisms — the save effect returns
          on truncation ABOVE the destructive guard (no NEW refusal while truncation
          stands), and its suppress-after-load branch clears a standing refusal (no OLD
          refusal outlives its workspace). An `else` would ENCODE that exclusivity here
          and hide where it is actually enforced.
          ★★ So these siblings are UNGUARDED against each other on purpose, and the cost
          is visible: were the combined state ever reachable again, BOTH would render —
          two `role="alert"` regions, two identically-named Dismiss buttons, and two
          "save anyway" buttons authorising different things. That consequence is
          characterized in `task-manager.truncation-banner.test.tsx`; the exclusivity
          itself is pinned in `use-storage-backend.test.tsx`, which is where it lives. */}
      {!isPopout && destructiveRefusal !== null && (
        <SavingPausedBanner lang={lang} cause={{ kind: "destructive", prevRecords: destructiveRefusal.prevRecords, curRecords: destructiveRefusal.curRecords, fullWipe: destructiveRefusal.fullWipe }} dismissed={destructiveBannerDismissed} hasFooterIndicator={settings.layout !== "classic"} onSaveAnyway={allowDestructiveSaveAnyway} onDismiss={() => setDestructiveBannerDismissed(true)} onReopen={() => setDestructiveBannerDismissed(false)} />
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
        onOpenAiAssistant={aiAssistantOpener(settings.ai, () => openPopoutWindow("chat", settings.popout.reuseWindow))}
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
            storageReady={storageOk && !loadWasIncomplete && destructiveRefusal === null}
            savingPaused={!isPopout && (loadWasIncomplete || destructiveRefusal !== null)}
            // ★ Clearing BOTH dismissals is correct, not sloppiness: the two causes
            // cannot hold at once — truncation returns ABOVE the destructive guard so
            // no new refusal is raised, AND the save effect's suppress-after-load
            // branch clears a standing refusal so none outlives its workspace — so at
            // most one banner is standing and clearing the other flag is a no-op.
            // ★ It stays correct if that ever stopped holding: clearing both re-shows
            // both, which is the honest outcome for a user who asked to see why
            // saving is paused.
            onRestoreSavingNotice={() => { setTruncationBannerDismissed(false); setDestructiveBannerDismissed(false); }}
            isSignedIn={msAuth.account != null}
            accountName={msAuth.account?.username ?? null}
            onSignOut={() => { void msAuth.signOut().catch((e) => reportSilentFailure(showToast, lang, "msauth.signInFailed", e, "guardMsSignInFailed")); }}
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
      <ActivityLogProvider value={logActivityAs}>
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
    <ActivityLogProvider value={logActivityAs}>
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
