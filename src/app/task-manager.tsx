"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeBudgetReport, type ProjectReport } from "./budget-report";
import { makeAllocationsSnapshotGetter } from "./alloc-plan/alloc-plan";
import { PanelSkeleton } from "./skeleton";
import { t } from "./i18n";
import { useChatDispatcher } from "./use-chat-dispatcher";
import { useActivityLog } from "./use-activity-log";
import { ActivityLogProvider } from "./activity-log-context";
import { useToast } from "./use-toast";
import { useSettings } from "./use-settings";
import { useApplyFavicon } from "./use-favicon";
import { useTemplateActions } from "./use-template-actions";
import { disabledViewRedirect, isModuleEnabled, deriveMode, type FeatureModuleId } from "./feature-modules";
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
import { useTaskEditorCreate } from "./use-task-editor-create";
import { useTaskBudgetLink } from "./use-task-budget-link";
import { useBudgetBuckets } from "./use-budget-buckets";
import { TaskLinkedTaskModal } from "./task-linked-task-modal";
import { useGanttHandlers } from "./use-gantt-handlers";
import { AppModals } from "./app-modals";
import { type Resource, type RaidItem, type ChangeItem } from "./types";
import { NotesWindow } from "./notes-window";
import { useNotesWindow } from "./use-notes-window";
import { BlockersWindow } from "./blockers-window";
import { useBlockersWindow } from "./use-blockers-window";
import { useFxRates } from "./use-fx-rates";
import { resourceDisplayName } from "./resource-foundation";
import { peekMintId } from "./id-mint-session";
import { buildRaidByTaskIndex } from "./raid";
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
import { AiKeyBanner, StorageBanner, SavingPausedBanner, UnloadJournalConflictBanner, OtherJournalsBanner, ExpiredJournalsBanner } from "./notifications";
import { classifyStorageError, type StorageErrorKind } from "./storage-error";
import { useAiKeyCheck, useAiKeyStatus } from "./use-ai-key-check";
import { isAiKeyStatusBad } from "./ai-key-status";
import { useStakeholderComms } from "./use-stakeholder-comms";
import { isReadOnlyIssue, jiraProjectKeyOf } from "./jira-projects";
import { WorkspaceSection } from "./workspace-section";
import { CalendarSummaryModals } from "./calendar-summary-modals";
import { useCalendarIntegrations } from "./use-calendar-integrations";
import { useActionCenterHandlers } from "./use-action-center-handlers";
import { useAiOrchestration } from "./use-ai-orchestration";
import { buildShellChrome } from "./shell-chrome";
import { useUndoStack, usePruneUndoOnScopeChange } from "./undo/use-undo-stack";
import { useResourceQuickCreate } from "./use-resource-quick-create";
import { useSettingsNavigation } from "./use-settings-navigation";
import { useSettingsChangeLog } from "./use-settings-change-log";
import { useTursoProjectList } from "./use-turso-project-list";
import { useVersionHistoryWiring } from "./use-version-history-wiring";
import { useUndoHotkey } from "./use-undo-hotkey";
import { useUndoBatch } from "./use-undo-batch";
import { UndoControl, RedoControl } from "./undo/undo-control";
import { buildMoveAbsenceHandler } from "./absence-move-handler";
import { RolesPanel } from "./roles-panel";
import { rematerializeDayBasisRoles } from "./role-rates";
import { useReminderBanners } from "./use-reminder-banners";
import { useActionNotifications } from "./use-action-notifications";
import { isReportPopoutTab, openPopoutWindow } from "./broadcast-sync";
import { ModernShell } from "./modern-shell";
import { VersionInfoModal } from "./version-info";
import { useDesktopVersionRequest } from "./use-desktop-version-request";
import { AskClaudeMenu } from "./ask-claude-menu";
import { useHashView } from "./use-hash-view";
import { navLabelKey, filterNavGroups } from "./nav-config";
import { useSnapshots } from "./use-snapshots";
import { buildDemoWorkspace } from "./demo-workspace";
import { buildLiveDashboardInput, computeDashboard } from "./dashboard";
import { EMPTY_TIMELOG_LINKS, isBlankTimelogLinks } from "./timelog-sanitize";
import { useInsightRecommendations } from "./use-insight-recommendations";
import { useInsightLifecycle } from "./use-insight-lifecycle";
import { RecommendationReviewModal } from "./insights/recommendation-review-modal";
import { executeActionCta } from "./action-cta-exec";
import { getTursoConfig } from "./turso-config";
import { aiAssistantOpener, aiKeyIfEnabled, isAiEnabled, defaultExportConfig, exportFooterText, defaultNextActionsLearning, defaultSnapshotSettings, type JiraExtraProject, type Settings } from "./settings-types";
import { resolveEffectiveSettings } from "./settings-effective";
import { buildTaskEditorChrome } from "./task-editor-actions";
import { APP_VERSION_LABEL } from "./version";
import { makeEditGuard } from "./read-only-guard";
import { RaidCreateHost, useRaidCreate } from "./raid-create-host";
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
import { useOutlookImports } from "./use-outlook-imports";
import { OutlookImportModal } from "./outlook-import-modal";
import { canImportOutlookContacts } from "./outlook-contacts";
import { OutlookCalendarImportModal } from "./outlook-calendar-import-modal";
import {
  loadRegistry,
  getCurrentEntry,
  type ProjectsRegistry,
} from "./projects-registry";
import { exportWorkspace, type ExportFormat } from "./export"; import { exportForecastFor } from "./export-forecast-section"; import { buildExportWorkspace } from "./export-workspace"; import { reportCapabilityGap, reportSilentFailure } from "./guard-feedback";
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
import { usePortfolioProjects } from "./use-portfolio-projects";
import { useNextActions } from "./use-next-actions";
import type { SuggestedAction } from "./next-actions";
import { computeActionTrends } from "./next-actions/trends";
import { resolveTimezone, createProjectClock } from "./timezone";
import { DisplayTimezoneProvider } from "./display-timezone-context";
import { ConfirmProvider } from "./confirm-dialog";

// ★ `effectiveToday(tz)` lived here until §159; `createProjectClock` (timezone.ts) now owns that derivation and keeps the day welded to its zone. Do NOT reintroduce a local one — a second producer of `today` is what let an inconsistent pair exist.
// Connected display-timezone switcher. A module-level wrapper (static-components
// rule) so it can read the DisplayTimezoneContext that wraps both shells — the
// header element it produces is rendered inside the provider in both layouts.

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
  // ★★ THE PIN COVERS TWO OF THE WIRING SITES, NOT ALL OF THEM — this line used to say "Pinned by task-manager.activity-actor.test.tsx" flat, which reads as coverage of the whole rule. That file drives exactly two threads through the real component: `useChangeLog` (via `handleSaveChange`) and `useStakeholders` (via `handleSaveStakeholder`), plus a control that `logActivityAs("ai")` stays distinct and the `logActivityChangesUser` field-diff variant on the change thread. A third site, the `useResourceQuickCreate` call (which holds the resource create, once the one inline `logActivityUser(...)` call), is pinned by a source scan in `use-resource-quick-create.test.ts` that proves the logger passed, not the actor recorded. Every OTHER site below — resource planner, budget buckets, notes window, undo stack, and the remaining hook threads (`useTaskEditorCreate` among them) — is UNPINNED: swapping one back to the raw `logActivity` drops its actor silently and the suite stays green. ★ Count those by eye, not by grepping this file for `logActivityUser`: THIS COMMENT matches that grep, so the count comes back inflated by the line quoting it.
  const { activityLog, logActivity, logActivityAs, logActivityUser, logActivityChangesUser, handleClearActivityLog } =
    useActivityLog();
  const { toast, showToast, showToastAction, pause: pauseToast, resume: resumeToast } = useToast();
  const { isPopout, activeTab, setActiveTab, requestOpen, pendingOpen, clearPendingOpen, requestChat, requestHelpConcept, requestDocumentsForEntity } = useWorkspaceTab();
  // Local in-memory undo (deletes / clear-all / bulk-edit across every entity).
  // capture is threaded into each entity hook below; undo/control are surfaces. ★ Undo/redo is ALWAYS user-caused, but the AI's entity update, delete and RAID-escalate tool writes DO capture (through the dispatcher's `undo` prop below); creates, document writes, `send_inquiry` (bumps `Task.inquiriesSent`) and `update_settings` / `set_language` / `set_filters` do not.
  // ★ `allowDestructiveSave` is produced by `useStorageBackend` further down, so
  // it does not exist at this call site. Forward it through a ref filled by the
  // effect below — the same shape `use-reference-data.ts` uses for THIS VERY
  // callback (one `argsRef` mirroring its whole args bag after every commit,
  // spent at `argsRef.current.allowDestructiveSave?.()`), and `use-bulk-operations.ts` and
  // `use-document-assets.ts` use for the same one. Moving the `useUndoStack` call
  // down instead would also move `useUndoHotkey`'s listener registration relative
  // to the other hotkey hooks.
  const allowDestructiveSaveRef = useRef<(() => void) | undefined>(undefined);
  const isPopoutRef = useRef(isPopout);
  const loadPendingRef = useRef(true); // §548 — filled beside `allowDestructiveSaveRef`, read by the undo hotkey below. Starts TRUE (fail safe) so a keystroke landing before the first effect commit cannot slip through the false-by-default window; `loadPending` itself is true pre-hydration anyway (ruling 8), so the effect below overwrites this immediately either way.
  const armDestructiveForUndo = useCallback(() => { allowDestructiveSaveRef.current?.(); }, []);
  const readOnlyForUndo = useCallback(() => isPopoutRef.current, []);
  // §628 — same forward-ref shape; filled below with `useStorageBackend`'s stable reader, and `usePruneUndoOnScopeChange` sits after that call for the same ordering reason.
  const getScopeEpochRef = useRef<() => number>(() => 0); // holds useStorageBackend's UNDO epoch (getUndoEpoch: the scope epoch + one per restore), filled below
  const readScopeEpochForUndo = useCallback(() => getScopeEpochRef.current(), []);
  const undoApi = useUndoStack({ lang, logActivity: logActivityUser, showToast, showToastAction, allowDestructiveSave: armDestructiveForUndo, isReadOnly: readOnlyForUndo, getScopeEpoch: readScopeEpochForUndo });
  // ★★ §548 — the one undo path that does NOT unmount with the app tree during the load hold (a document
  //   keydown listener), and an undo applied then is replaced when the load lands, so it is dropped.
  //   `loadPending` comes from `useStorageBackend` further down, so it is read through a ref (the same
  //   forward-ref pattern as `allowDestructiveSaveRef`). The call stays HERE so the document keydown
  //   listeners keep their registration order.
  useUndoHotkey(
    () => { if (!loadPendingRef.current) undoApi.undo(); },
    () => { if (!loadPendingRef.current) undoApi.redo(); },
  );
  // ★★★ ONE INSTANCE, TWO CONSUMERS, AND THEY MUST BE THE SAME ONE. `.undo`
  // goes in as the chat dispatcher's `undo` prop (below) so the AI capture
  // sites are intercepted (count them with the `kind: "` grep in use-undo-batch.ts); `.runBatched` goes down to `ChatPanel` so an
  // applied staged plan pushes ONE undo entry instead of one per row. A second
  // `useUndoBatch(...)` for the panel would collect nothing — the dispatcher's
  // captures would still reach the live stack — and NOTHING would report it:
  // the plan would apply, undo would work, and the user would simply have to
  // press it N times. Read the module header before splitting these.
  const chatUndoBatch = useUndoBatch(undoApi, readScopeEpochForUndo); // §628 — a batch is stamped with the epoch it OPENED in
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
  // ★★ `hydrated` is load-bearing, not defensive. use-settings.ts seeds
  //    `defaultSettings` synchronously (layout "modern"), so without this gate
  //    the hook is enabled on render 1 for EVERY user: a classic user is routed
  //    before the layout flips (§536), and the cold rule judges the hash against
  //    defaultSettings.features and never revisits it (§595). `settled:
  //    hydrated` lets a page that hydrates into Classic spend its cold window
  //    there, so a later switch to Modern is a warm re-entry (§536).
  useHashView(hydrated && settings.layout === "modern", settings.features, { settled: hydrated });
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

  const { setRaidFilterTaskId, setChangeFilterTaskId, setRaidFilterEpoch, setChangeFilterEpoch, resetFilterValues, setAssigneeFilter, setHealthFilter } = useFilters();
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
    grades,
    setBudgets,
    setFxRates,
    budgets,
    plan,
    status,
    milestones,
    setMilestones,
    changes,
    setChanges,
    steeringCommittee,
    setSteeringCommittee,
    timelogLinks,
    setTimelogLinks,
    knowledgeItems,
    insights,
    documents, setInsights,
    settingsOverrides,
    fxRates,
    project,
    setProject,
    setFeatures,
    budgetHistory,
    setBudgetHistory,
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

  const { holidaySet, holidaysReady } = useHolidaySet({
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
  const [storageDismissed, setStorageDismissed] = useState({ backend: false, list: false }); // ★ §103's banner dismissal is SEPARATE and hides only the banner — the save guard stays armed (use-load-truncation.ts).
  const [truncationBannerDismissed, setTruncationBannerDismissed] = useState(false);
  const [destructiveBannerDismissed, setDestructiveBannerDismissed] = useState(false);
  const [loadPauseBannerDismissed, setLoadPauseBannerDismissed] = useState(false); // §586/§587 — hides the banner only; the save gate stays shut.
  // Bridges a successful save into the version-history idle-capture timer. The
  // hook is instantiated later, so this ref is wired up via an effect below.
  const versionNotifyRef = useRef<() => void>(() => {});
  const reportStorageOutcome = useCallback((err: unknown | null) => {
    if (err == null) {
      // Recovery clears this error, and with it a dismissal of it (in render below, §678).
      setStorageError(null);
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

  // §650 — the Anthropic key verdict: the start-up / on-save key check (main window only; the hook
  // gates on `isPopout` itself) and the banner's read of the in-memory verdict. The banner's dismiss
  // holds for this page only; the next load re-derives the verdict and re-shows it if still bad.
  useAiKeyCheck({ ai: settings.ai, hydrated, isPopout });
  const aiKeyStatus = useAiKeyStatus();
  const [aiKeyBannerDismissed, setAiKeyBannerDismissed] = useState(false);
  // A dismissal belongs to the bad verdict it dismissed: once the verdict leaves the bad states (a new
  // key resets it to "unknown", or a call succeeds) the dismissal is cleared, so a NEW refusal shows
  // the banner again. Render-time reconcile, not an effect (set-state-in-effect is banned).
  if (aiKeyBannerDismissed && !isAiKeyStatusBad(aiKeyStatus)) setAiKeyBannerDismissed(false);

  // ★★★ FIX ROUND 1 (M3): THE ONLY VersionInfoModal IN THE APP, and its
  // `openVersion` is now the ONE way anything opens it — the desktop shell's
  // Help → Version menu event (handled inside the hook), the sidebar version
  // line (ModernShell's `onOpenVersion` prop below), and the Settings footer
  // (SettingsView's `onOpenVersion` prop) all end up calling the SAME state
  // flip, so a second modal cannot exist by construction. Called
  // unconditionally here because TaskManagerInner is ONE component instance
  // regardless of isPopout / settings.layout — the <VersionInfoModal> below is
  // rendered from `modalsBlock`, which every returned tree (classic, popout,
  // modern) includes. See use-desktop-version-request.ts's docstring for the
  // full history (it used to be a third, independently-owned instance).
  const desktopVersionRequest = useDesktopVersionRequest();

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

  const {
    storageDescription, storageReady, workspaceLoaded, loadPause, onPickStorageFile, onGrantWriteAccess,
    onOpenStorageFile, onRequestStorageSwitch, reloadCurrentProject, allowDestructiveSave,
    allowDestructiveSaveAnyway, destructiveRefusal,
    truncation, decodeFailureCount, activityLogUnreadable, decodeFailureNonce, malformedQuoteCount, malformedQuotesNonce, loadWasIncomplete, allowIncompleteSave,
    switchToProject, createProject, createDemoProject, loadProjectFromFile,
    switchToTursoProject, createTursoProject, migrateCurrentProjectToTurso, archiveTursoProject,
    restoreTursoProject, hardDeleteTursoProject, tursoProjectId, loadPending, getScopeEpoch, getUndoEpoch, isSwapInFlight,
    unloadJournalConflict, restoreUnloadJournalAnyway, discardUnloadJournal, otherJournals, restoreKeptJournal,
    resolveConflictReload, resolveConflictOverwrite, downloadConflictVersion, canOverwriteConflict,
  } = useStorageBackend({ settings, lang, hydrated, isPopout, showToast, showToastAction, onRevealSavingPaused: () => { setDestructiveBannerDismissed(false); setLoadPauseBannerDismissed(false); }, setStorageConfig: (storageConfig) => setSettings((s) => ({ ...s, storageConfig })), onStorageOutcome: reportStorageOutcome, onRegistryChange: setRegistry, onUndoHistoryReset: undoApi.pruneStale });

  // Fills the forward-ref declared above `useUndoStack`, so an undo-stack redo
  // that re-removes rows can arm the one-shot destructive-save bypass (§295).
  useEffect(() => {
    allowDestructiveSaveRef.current = allowDestructiveSave;
    isPopoutRef.current = isPopout;
    loadPendingRef.current = loadPending;
    getScopeEpochRef.current = getUndoEpoch; // the UNDO epoch: also moves on a restore
  }, [allowDestructiveSave, isPopout, loadPending, getUndoEpoch]);
  usePruneUndoOnScopeChange(loadPending, undoApi.pruneStale); // §628 — a project switch drops the previous project's undo entries; a hold that kept the project drops none.

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

  // ★★ Render-time reconcile for the destructive-save refusal banner, keyed on the refusal OBJECT. Why
  // the object key, the reset to null and the null seed: docs/AGENTS/storage.md, "The destructive-refusal banner's dismissal".
  const [destructiveRefusalSeen, setDestructiveRefusalSeen] = useState<typeof destructiveRefusal>(null);
  if (destructiveRefusal !== destructiveRefusalSeen) {
    setDestructiveRefusalSeen(destructiveRefusal);
    setDestructiveBannerDismissed(false);
  }
  // ★ Same render-time reconcile for the §586/§587 LOAD pause: a NEW pause (or a new reason) re-shows
  // a banner dismissed for an earlier one. Seeded null for the remount-swallow reason above.
  const [loadPauseSeen, setLoadPauseSeen] = useState<typeof loadPause>(null);
  if (loadPause !== loadPauseSeen) {
    setLoadPauseSeen(loadPause);
    setLoadPauseBannerDismissed(false);
  }

  // The Turso project lists (active + archived), their load-once flag, the refresh and its
  // first-load effect — see use-turso-project-list.ts (§491).
  const { tursoProjects, tursoArchived, tursoListLoaded, refreshTursoProjects, tursoListFailure } = useTursoProjectList({
    portfolioMode, hydrated, reportStorageOutcome,
    tursoDatabaseUrl: settings.integrations?.turso?.databaseUrl,
    tursoAuthToken: settings.integrations?.turso?.authToken,
  });
  const shownStorageError = storageError ?? tursoListFailure; // §678: a backend success clears only `storageError`
  const shownStorageSource = storageError ? "backend" : tursoListFailure ? "list" : null; // §678: dismiss flags both; a flag lasts while its source fails
  if ((storageDismissed.backend && !storageError) || (storageDismissed.list && !tursoListFailure)) setStorageDismissed({ backend: storageDismissed.backend && !!storageError, list: storageDismissed.list && !!tursoListFailure });

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
      // No snapshots here: a capture (`buildSnapshot`) reads only the model's burndown, progress,
      // EVM and RAGs, none of which depend on them — and the list is this `useSnapshots` call's own
      // return value, so passing it would need a self-reference.
      const model = computeDashboard(
        buildLiveDashboardInput(
          { tasks, raid, budgets, plan, roles, resources, absences, fxRates, milestones, changes, budgetHistory },
          { workdayHours: settings.resources.workdayHours, holidaySet, status, activity: activityLog, today },
          null,
        ),
      );
      return {
        model,
        tasks,
        milestones,
        buckets: budgets,
        planEndDate: plan.endDate,
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

  // --- RAID CRUD handlers ---------------------------------------------
  //
  // The RAID panel owns its own form state and edit modal; these are pure
  // mutators that update the top-level `raid` array, which round-trips to
  // storage via the existing save effect.

  const { jiraSyncing, jiraResolving, jiraConflicts, handleJiraSync, handleResolveConflicts, clearConflicts } = useJiraSync({
    settings,
    today,
    lang,
    showToast,
    logActivityAs,
    getScopeEpoch,
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
  const storageOk = storageReady && !shownStorageError;

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
  // Same index, mirrored for the "N changes" task-row badge, which jumps to the
  // Changes view filtered to that task (open-followups §481).
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

  // Save/Apply template actions for the project menu — extracted to useTemplateActions.
  const { projectTemplates, handleSaveTemplate, handleApplyTemplate } = useTemplateActions({ lang, showToast, features: settings.features });

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

  // Render-scope dashboard model, read by Next Actions (`buildActionInput`'s `dashboard`), both
  // `getDashboardModel` handlers (the AI assistant's dashboard snapshot and the meeting report) —
  // NOT by the dashboard panel, which builds its own module-gated model and also passes `disciplines`/`grades`.
  // Unlike the snapshot buildContext above it also passes the recorded snapshots, behind the
  // same `trendsActive` gate the panel's `tursoActive` prop carries.
  const snapshotRecords = snapshots.snapshots;
  const dashboardModel = useMemo(
    () =>
      computeDashboard(
        buildLiveDashboardInput(
          { tasks, raid, budgets, plan, roles, resources, absences, fxRates, milestones, changes, budgetHistory },
          { workdayHours: settings.resources.workdayHours, holidaySet, status, activity: activityLog, today },
          { active: trendsActive, snapshots: snapshotRecords },
        ),
      ),
    [tasks, raid, budgets, plan, roles, resources, absences, fxRates, settings.resources.workdayHours, holidaySet, status, activityLog, today, milestones, changes, budgetHistory, trendsActive, snapshotRecords],
  );

  // --- Insights → Action Loop (#6B SP1) --------------------------------------
  // The detect → reconcile runner and the four lifecycle handlers live in
  // `useInsightLifecycle` (use-insight-lifecycle.ts, §491). `landingProjectId`
  // stays here because the chat dispatcher reads it too.
  const landingProjectId = portfolioMode === "turso" ? (tursoProjectId ?? "default") : (currentProjectId ?? "default");
  const { onAcknowledgeInsight, onActInsight, onInsightLoggedAsRaid, onDismissInsight } = useInsightLifecycle({
    hydrated, isPopout, loadPending, today, currentProjectId, landingProjectId,
    tasks, milestones, raid, budgets, roles, resources, plan,
    holidaySet, holidaysReady, shifts, timelogLinks,
    insights, setInsights, requestOpen,
  });
  // The SP2 generate/apply/reject handlers (+ the `insightActions` assembly
  // that references them) live in `useInsightRecommendations`
  // (use-insight-recommendations.ts) — apply replays proposed tool calls
  // through `dispatcher`, so that hook is called right after `dispatcher` is
  // created, below.

  // The single declaration for "the current project id under whichever
  // portfolio backend is active" — `portfolioMode`, `tursoProjectId` and
  // `currentProjectId` are all already in scope by this point (each declared
  // earlier in the component), so there is no TDZ hazard hoisting it here.
  const portfolioCurrentId = portfolioMode === "turso" ? tursoProjectId : currentProjectId;
  // Suggested next-actions wiring — the workload alerts, the engine run, the
  // grouping, the comms-pending ids, the jump-to-comms link and the group-aware
  // snooze — extracted to useNextActions (use-next-actions.ts, §491).
  const { nextActions, nextActionGroups, nowCount, commsPendingStakeholderIds, onJumpToComms, snoozeAction } = useNextActions({
    isPopout, tasks, raid, changes, milestones, stakeholders, steeringCommittee,
    resources, absences, shifts, plan, dashboardModel, commsReminders: comms.items,
    features: settings.features, project, portfolioCurrentId, today,
    workdayHours: settings.resources.workdayHours, holidaySet,
    effectiveNotifications, effectiveNextActions, actionTrends,
    learnedBias: learning.bias, recordLearning: learning.record, requestOpen,
  });
  // "Open settings" requests (the modern deep-link and the classic popover) —
  // extracted to useSettingsNavigation.
  const {
    settingsSectionRequest, clearSettingsSectionRequest, isClassicLayout, classicSettingsOpen, setClassicSettingsOpen,
    onOpenSettingsSection, onOpenSettings, onOpenLearningSettings,
  } = useSettingsNavigation({ layout: settings.layout, setActiveTab });
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

  // Guided tour (SP-F): modern-shell, non-popout only. Auto-launches once for a
  // first-run user; re-launchable from the Help panel. State lives above the
  // view so it survives the view remount that the modern shell performs.
  const tour = useTour({
    layout: settings.layout, isPopout, hydrated, tourSeen: settings.tourSeen,
    completedTours: settings.completedTours, features: settings.features,
    storageKind: settings.storageConfig.kind, setSettings,
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
      const today = new Date().toISOString().slice(0, 10); // callback context — lint-safe
      const ws = buildDemoWorkspace((mod as { default?: unknown }).default ?? mod, today);
      await createDemoProject(ws);
      startTour();
    } catch {
      showToast("error", t(lang, "tourDemoError"));
    }
  }, [createDemoProject, startTour, showToast, lang]);

  // Version history: the capture payload, the restore fan-out (the SECOND load funnel), the error
  // bridge and the `useVersionHistory` call — see use-version-history-wiring.ts (§491).
  const versionHistory = useVersionHistoryWiring({
    stakeholders, calendarEvents, tursoConfig, tursoProjectId, isPopout, logActivityUser,
    reportStorageOutcome, versionNotifyRef,
    storageKind: settings.storageConfig.kind,
    features: settings.features,
    versionHistoryRetention: settings.versionHistoryRetention,
  });

  // Creating a resource from outside the Resources view (the picker's "+ Add",
  // the task editor's add-to-address-book) — extracted to useResourceQuickCreate.
  const { handleAddAssigneeToAddressBook, handleCreateResource, handleSaveResourceFromAnywhere, handleCloseResourceFromAnywhere } =
    useResourceQuickCreate({ resources, setResources, logActivity: logActivityUser, handleOpenAddResource, handleSaveResource, handleCloseResourceModal, setForm });

  const m365Enabled = settings.integrations?.m365?.enabled ?? false;
  const msAuth = useMsAuth(m365Enabled, { clientId: settings.integrations?.m365?.clientId, tenantId: settings.integrations?.m365?.tenantId });
  const commSend = useCommSend({ mode: settings.commTemplateSendMode ?? "mailto", msAuth, lang, showToast });
  const {
    importOpen, setImportOpen, importLoading, importError, importContacts,
    handleOpenOutlookImport, existingResourceEmails, handleConfirmOutlookImport,
    calImportOpen, setCalImportOpen, calImportLoading, calImportError, calImportEvents,
    calendarTarget, calendarExistingKeys, handleOpenCalendarImport, handleConfirmCalendarImport,
  } = useOutlookImports({
    lang, today, msAuth, resources, absences, setContacts,
    handleImportResources, handleImportAbsences, showToast,
  });

  const outlookCalendarEnabled =
    m365Enabled && (settings.integrations?.m365?.outlookCalendar ?? false);

  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const onPushToJiraRef = useRef<(taskId: number) => Promise<boolean>>(
    () => Promise.resolve(false),
  );
  const pendingLinkRaidIdRef = useRef<number | null>(null);

  const { commitBuckets } = useBudgetBuckets({
    budgets, setBudgets, allowDestructiveSave, capture: undoApi.capture, captureComposite: undoApi.captureComposite, logActivity: logActivityUser,
    // The bare `[]` for `tasks` is deliberate: `computeBudgetReport` only reads `tasks` to derive
    // each bucket's `pctComplete` (`budget-report.ts`, `bucketPercentComplete`) — it plays no part
    // in `ownBudget.budgetHours`/`ownBudget.budgetValue`, which is all `project.budgetHours` and
    // `project.budgetValue` below sum. This is also the series' ONLY writer (`setBudgetHistory`
    // above), so a future BAC term that DOES depend on tasks would have to revisit this call, not
    // just the report engine.
    projectBac: (bs) => {
      const p = computeBudgetReport(bs, plan, roles, resources, settings.resources.workdayHours, holidaySet, absences, [], fxRates).project;
      return { hours: p.budgetHours, value: p.budgetValue };
    },
    setBudgetHistory,
    today,
  });
  // The task editor's create-from-editor wiring — the create-RAID mini-form, the new-linked-task
  // modal and the create-mode buffer both stage into — lives in use-task-editor-create.ts.
  const { editorBuffer, handleAddRaidFromEditor, linkedTaskOpen, setLinkedTaskOpen, handleCreateLinkedTask } = useTaskEditorCreate({
    tasksRef, raid, setTasks, setRaid, editingId, today, logActivity: logActivityUser,
  });
  const { flush: flushEditorBuffer, discard: discardEditorBuffer } = editorBuffer;
  const { budgetLink, onTaskCreated: onTaskCreatedWithBucket, onEditorDiscard: onEditorDiscardWithBucket } = useTaskBudgetLink({ enabled: isModuleEnabled("budget", settings.features), budgets, editingId, commitBuckets, flushEditorBuffer, discardEditorBuffer });

  // Shared floating note-log window (tasks + RAID + changes), popout-gated at the mount below (see use-notes-window.ts).
  const { openTaskNotes, openRaidNotes, openChangeNotes, notesWindowProps } = useNotesWindow({ tasks, raid, changes, setTasks, setRaid, setChanges, selfResourceId: settings.selfResourceId, resources, lang, logActivity: logActivityUser, loadPending });
  // Floating blocker window (tasks only), popout-gated at the mount below beside NotesWindow (see use-blockers-window.ts).
  const { openTaskBlockers, blockersWindowProps } = useBlockersWindow({ tasks, setTasks, selfResourceId: settings.selfResourceId, resources, lang, logActivity: logActivityUser, loadPending });

  const { fieldErrors, submitted, saveDisabled, handleSubmit, handleCancelEdit, openEditModal } = useTaskSubmit({
    form,
    setForm,
    editingId,
    setEditingId,
    setTaskModalOpen,
    tasks, resources,
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
  const commTemplates = useCommTemplates({
    active: commTemplatesActive,
    config: tursoConfig,
    // §626. A startup replay write failed: reported as a failed template save is. Kind and id only.
    onReplayFailure: ({ kind, id }) => reportSilentFailure(showToast, lang, "commTemplates.replayFailed", new Error(`${kind}:${id}`), "guardCommTemplateSaveFailed"),
  });
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
    onJumpToChanges,
    onSendInquiry,
    onPushToJira,
    onStatusChange,
    onSwimlaneDrop,
    onEdit,
    onDelete,
    handleClearRaidTaskFilter,
    handleClearChangeTaskFilter,
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
    setChangeFilterTaskId,
    setRaidFilterEpoch,
    setChangeFilterEpoch,
    getScopeEpoch,
    setWorkspaceCollapsed,
    deselectIdRef,
    handleCancelEdit,
    logActivity: logActivityUser,
    captureFieldEdit: undoApi.captureFieldEdit,
    captureComposite: undoApi.captureComposite,
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
    recordLearning: learning.record,
    showToast,
    selfResourceId: settings.selfResourceId,
    // ★★★ logActivityUser, NEVER the raw logActivity — see the USER-ACTOR
    // WIRING rule at the top of this component. Mark-done from a Next-actions
    // CTA is a user gesture, so its completion entry must carry the user actor.
    logActivity: logActivityUser,
  });

  // "Log as RAID" (§515): one floating RAID editor over the current view. Called
  // after useResourcePlanner (handleSaveRaidItem) and the learning hook
  // (learning.record); openers are undefined in popouts.
  const raidCreate = useRaidCreate({
    isPopout, lang, today, raid, handleSaveRaidItem, recordLearning: learning.record,
    onInsightLogged: onInsightLoggedAsRaid,
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
    showToast, allowDestructiveSave, routeUnknownVoice: !isPopout && isAiEnabled(settings.ai) ? (text: string) => requestChat(text, false) : undefined, // §519: prefill, never auto-send
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

  // The Birthday / Jira-token reminder banners and the budget-bucket toast — see use-reminder-banners.tsx.
  const { reminderBannersEl } = useReminderBanners({
    hydrated, resources, absences, budgets, today, holidaySet, effectiveSettings, effectiveNotifications,
    jira: settings.jira, isPopout, lang, showToast,
  });

  // The debounced, actor-less "settings.updated" row (§160 credits included) — see use-settings-change-log.ts.
  // ★★★ THE ONE SITE DELIBERATELY HANDED THE RAW `logActivity`, not `logActivityUser`: an effect over settings STATE cannot see its cause. Pinned through this component by task-manager.activity-actor.test.tsx.
  const { onSettingsLoggedByAi } = useSettingsChangeLog({ settings, hydrated, logActivity });

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
      fxRates,
    ).project;
  };

  // Deliberately NOT memoized: the snapshot is built only when the assistant
  // calls list_allocations, so an unused read tool costs nothing per render.
  // The factory forwards the call's §12 scope — see its docstring for why it
  // is not an inline arrow.
  const getAllocationsSnapshot = makeAllocationsSnapshotGetter({
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
    onSettingsLoggedByAi,
    setSelectedIds,
    setSettings,
    isReadOnly: isPopout,
    currentView: activeTab, settingsProjectId: landingProjectId, holidaySet, logActivityAs,
    // ★ `delete_document` is a second removal route into a COUNTED slice — see
    //   the arming site in `use-document-tools.ts`.
    allowDestructiveSave,
    // ★★★ THE BATCH WRAPPER, NOT `undoApi` — and the STABILITY note that used
    //   to sit here is not merely still satisfied, it is now the mechanism.
    //   The old text said this had to be A FRESH OBJECT EVERY RENDER and must
    //   not be memoized, because the dispatcher reads `undoRef.current` through
    //   an effect keyed on `args.undo`. `chatUndoBatch.undo` is the OPPOSITE —
    //   minted once (`useMemo` with no deps) — and that is exactly what
    //   `use-undo-batch.ts`'s header asks for: the wrapper forwards to
    //   `liveRef.current`, which its OWN effect re-points at `undoApi` every
    //   render, so freshness is preserved one level down while `undoRef.current`
    //   stops being swapped mid-replay. An `await` inside `runBatched` can no
    //   longer have the surface swapped out from under it by a re-render.
    //   ★ What the old note actually forbade still holds: do NOT add this to the
    //   dispatcher's memo deps.
    undo: chatUndoBatch.undo,
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
    isPopout, loadPending, getScopeEpoch, settings, lang, today, project,
    tasks, raid, milestones, changes, stakeholders,
    resourcesById, insights, setInsights, dispatcher,
    showToast, logActivityAs,
    onAcknowledgeInsight, onActInsight, onDismissInsight,
    onLogAsRaid: raidCreate.openFromInsight,
  });

  const cacheFxRates = useCallback((fx: import("./types").FxRates) => setFxRates(fx), [setFxRates]);
  const { refresh: refreshFx, loading: fxLoading } = useFxRates(cacheFxRates);

  // Multi-project (portfolio) wiring — the empty-state / project handlers, the mode-aware
  // lists, the key-facts snapshot effect and the Turso project handlers —
  // extracted to usePortfolioProjects (§491).
  const {
    handleNewProject,
    handleLoadFromFileEmptyState,
    handleRestoreFromEmptyState,
    handleDeleteProject,
    portfolioProjects,
    portfolioLiveMetaById,
    portfolioArchived,
    handleSwitchProjectByMode,
    handleCreateProjectByMode,
    handleUpdateCurrentProjectByMode,
    handleArchiveTursoProject,
    handleRestoreTursoProject,
    handleHardDeleteTursoProject,
  } = usePortfolioProjects({
    portfolioMode,
    lang,
    showToast,
    isPopout,
    setActiveTab,
    project,
    setProject,
    portfolioCurrentId,
    registry,
    setRegistry,
    tursoProjects,
    tursoArchived,
    tursoDatabaseUrl: settings.integrations?.turso?.databaseUrl,
    tursoAuthToken: settings.integrations?.turso?.authToken,
    tursoProjectId,
    switchToProject,
    createProject,
    loadProjectFromFile,
    switchToTursoProject,
    createTursoProject,
    archiveTursoProject,
    restoreTursoProject,
    hardDeleteTursoProject,
    refreshTursoProjects,
  });

  // Export the CURRENT project's workspace. Snapshot is assembled from context
  // (same field set the save effect uses), including `project`.
  const exportFooter = exportFooterText(settings.branding); const exportForecast = exportForecastFor(settings.features, dashboardModel.forecastBundle); // §545
  const handleExportCurrentProject = useCallback(
    (format: string) => {
      // §463 — the same builder as the header Export menu. What keeps this
      //  literal complete is the builder's parameter type,
      //  `ExportWorkspaceSlices`: every slice is a required key, so leaving
      //  one out here is a compile error, not a section missing from the file.
      const ws = buildExportWorkspace({
        tasks, raid, absences, shifts, resources, roles, disciplines, grades,
        plan, budgets, fxRates, status, project, milestones, changes, stakeholders,
        calendarEvents, knowledgeItems, insights,
      });
      void exportWorkspace(ws, format as ExportFormat, settings.export ?? defaultExportConfig, lang, exportFooter, { budgetForecast: exportForecast }).catch((e) => reportSilentFailure(showToast, lang, "export.failed", e, "guardExportFailed"));
    },
    [tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, project, milestones, changes, stakeholders, calendarEvents, knowledgeItems, insights, settings.export, exportFooter, exportForecast, lang, showToast],
  );

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
    calendarTaskEnabled,
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
    loadPending,
    getScopeEpoch,
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
    today, exportForecast, // §545 — documents embed the forecast
    holidaySet,
    workspaceRef,
    resetWorkspaceSize,
    workspaceCollapsed,
    setWorkspaceCollapsed,
    dispatcher,
    // ★★★ THIS MUST RIDE `workspaceProps`, NOT A JSX ATTRIBUTE ON A NEIGHBOURING
    //   MOUNT. `WorkspaceSection` is spread (`{...workspaceProps}`) and the chat
    //   panel it renders is the only consumer; a first cut put this on the
    //   `<TasksSection>` block immediately below, where `ChatPanel` never sees
    //   it. That is silent at RUNTIME — the prop is optional and its default is a
    //   pass-through — so every applied plan would have pushed one undo entry per
    //   WRITE instead of one per PLAN, which is the exact defect `useUndoBatch`
    //   exists to prevent. Only `tsc` caught it: the workspace-section seam test
    //   asserts the panel gets what the SECTION was handed, one hop below here.
    // Same `useUndoBatch` instance whose `.undo` is the dispatcher's `undo` prop
    // — see the note at that call.
    runProposalBatch: chatUndoBatch.runBatched,
    // §548/§596 — both readers ride `workspaceProps` for the reason above: the chat
    // panel is the consumer and it is a hop below `WorkspaceSection`. REQUIRED all the
    // way down, so a dropped thread is a tsc error rather than a silently unguarded turn.
    getScopeEpoch,
    isSwapInFlight,
    handleGanttBarUpdate: guardEdit(handleGanttBarUpdate),
    handleCancelEdit,
    setTaskModalOpen,
    contactsList,
    onCreateResource: isPopout ? undefined : handleCreateResource,
    handleClearRaidTaskFilter,
    handleClearChangeTaskFilter,
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
        currency={plan.currency}
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
    projectLiveMetaById: portfolioLiveMetaById,
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
    nextActionGroups,
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
    onLogAsRaid: raidCreate.openFromAction,
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
      // §548 — the pane owns its own Outlook push/pull instances, so the scope-epoch
      // reader has to reach it here; every other calendar instance gets it from
      // `useCalendarIntegrations`'s deps bag. The prop is REQUIRED, so tsc proves it.
      getScopeEpoch={getScopeEpoch}
      dispatcher={dispatcher}
      logActivityAs={logActivityAs}
      captureFieldEdit={undoApi.captureFieldEdit}
      captureMerge={undoApi.capture}
      jiraSiteUrl={settings.jira.siteUrl}
      jiraExtraProjects={settings.jira.extraProjects ?? NO_JIRA_EXTRA_PROJECTS}
      onToggleSelect={onToggleSelect}
      onOpenNotes={openTaskNotes}
      onOpenBlockers={openTaskBlockers}
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
      onJumpToChanges={onJumpToChanges}
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

  // The task editor footer chrome (send-inquiry/push-Jira, Jira sync, Delete, extras) — see buildTaskEditorChrome.
  const { editorLeadingActions, editorDeleteAction, editorExtrasEl } = buildTaskEditorChrome({
    lang, isPopout, editingTask, editingIsJiraLinked, jira: settings.jira, jiraSyncing,
    onSendInquiry, onPushToJira, handleJiraSync, onDelete,
    onAddRaid: handleAddRaidFromEditor, pendingRaid: editorBuffer.pendingRaid,
    onNewLinkedTask: () => setLinkedTaskOpen(true),
  });

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
      onReloadProject={isPopout ? undefined : () => { void reloadCurrentProject(); }} activityAuditPortfolio={isPopout ? undefined : portfolioMode === "turso" ? tursoConfig : null} activityAuditLogUnreadable={activityLogUnreadable} // §510
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
      onOpenVersion={desktopVersionRequest.openVersion}
      requestSection={settingsSectionRequest}
      onSectionConsumed={clearSettingsSectionRequest}
      isPopout={isPopout}
      resources={resources}
      // The TimeLog guardrail policy rides the workspace `timelogLinks` blob,
      // so it is threaded from here rather than read off per-device settings.
      // ★★ The write goes back to `undefined` when the blob ends up empty:
      // `workspaceToJson` emits a `timelogLinks` key for any truthy blob, so a
      // plain `setTimelogLinks(next)` would put one into the exported artifact
      // for a user who switched a rule on and straight back off again.
      // ★ Read-only in a popout, which has no business writing shared policy.
      timelogLinks={timelogLinks ?? EMPTY_TIMELOG_LINKS}
      onTimelogLinksChange={
        isPopout
          ? undefined
          : (next) => setTimelogLinks(isBlankTimelogLinks(next) ? undefined : next)
      }
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
    <span data-tour-id={TOUR_ANCHORS.askClaude} className="shrink-0">
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
        dataTourId={TOUR_ANCHORS.undo}
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
    settingsMenuOpen: isClassicLayout && classicSettingsOpen,
    onSettingsMenuOpenChange: setClassicSettingsOpen, exportForecast,
  });

  // The Birthday / Jira-token / Storage reminder banners, shared by the classic
  // tree (rendered after AppHeader) and the modern tree (ModernShell `banners`
  // slot). Due / RAID-review / stakeholder-comms nudges moved into the Action
  // Center. Gates kept verbatim — popouts (`!isPopout`) still suppress these.
  const bannersEl = (
    <>
      {reminderBannersEl}
      {!isPopout && shownStorageError && shownStorageSource && !storageDismissed[shownStorageSource] && (
        <StorageBanner kind={shownStorageError.kind} lang={lang} onOpenSettings={onOpenSettings} onDismiss={() => setStorageDismissed({ backend: true, list: true })} />
      )}
      {/* §650 — gated on the AI switch too: a verdict about a key the user has turned off is not news. */}
      {!isPopout && settings.ai?.enabled === true && isAiKeyStatusBad(aiKeyStatus) && !aiKeyBannerDismissed && (
        <AiKeyBanner status={aiKeyStatus} lang={lang} onOpenSettings={() => onOpenSettingsSection("ai")} onDismiss={() => setAiKeyBannerDismissed(true)} />
      )}
      {unloadJournalConflict && (
        <UnloadJournalConflictBanner lang={lang} onRestoreAnyway={restoreUnloadJournalAnyway} onDiscard={discardUnloadJournal} />
      )}
      {otherJournals.expired.length > 0 && <ExpiredJournalsBanner lang={lang} expired={otherJournals.expired} onDownload={otherJournals.download} onDismiss={otherJournals.dismissExpired} />}
      {otherJournals.others.length > 0 && (
        <OtherJournalsBanner lang={lang} others={otherJournals.others} onDownload={otherJournals.download} onDiscard={otherJournals.discard} onDismiss={otherJournals.dismiss} canRestore={otherJournals.isRestorable} onRestore={restoreKeptJournal} />
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
      {/* §586/§587 — the save gate is shut for the active backend (its load failed, or came back empty over
          a populated project). STICKY for as long as the pause holds: the refused-edit toast times out. */}
      {!isPopout && loadPause !== null && ( // §4 — a conflict pause shares this mount and its dismissed state, and gets the hook's three resolve handlers (Reload, Overwrite, Download my version); Overwrite only while the refusal named the version it may replace
        <SavingPausedBanner lang={lang} cause={loadPause === "conflict" ? { kind: "conflict" } : { kind: "load", reason: loadPause }} dismissed={loadPauseBannerDismissed} hasFooterIndicator={settings.layout !== "classic"} onSaveAnyway={() => { void (loadPause === "conflict" ? resolveConflictReload() : reloadCurrentProject()); }} onOverwrite={canOverwriteConflict ? resolveConflictOverwrite : undefined} onDownload={loadPause === "conflict" ? downloadConflictVersion : undefined} onDismiss={() => setLoadPauseBannerDismissed(true)} onReopen={() => setLoadPauseBannerDismissed(false)} />
      )}
      {!isPopout && destructiveRefusal !== null && (
        <SavingPausedBanner lang={lang} cause={{ kind: "destructive", prevRecords: destructiveRefusal.prevRecords, curRecords: destructiveRefusal.curRecords, fullWipe: destructiveRefusal.fullWipe }} dismissed={destructiveBannerDismissed} hasFooterIndicator={settings.layout !== "classic"} onSaveAnyway={allowDestructiveSaveAnyway} onDiscard={() => { void reloadCurrentProject(); }} onDismiss={() => setDestructiveBannerDismissed(true)} onReopen={() => setDestructiveBannerDismissed(false)} />
      )}
    </>
  );

  const modalsBlock = (
    <>
      <VersionInfoModal
        lang={lang}
        open={desktopVersionRequest.open}
        onClose={desktopVersionRequest.onClose}
        logPath={desktopVersionRequest.logPath}
      />
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
        taskOnOpenBlockers={editingId !== null ? () => openTaskBlockers(editingId) : undefined /* as notes: existing task only; a new draft has no id to target */}
        budgetLink={budgetLink}
        taskCalendarSyncEnabled={calendarTaskEnabled}
        absenceCalendarSyncEnabled={calendarAbsenceEnabled}
        jiraConflicts={jiraConflicts}
        handleResolveConflicts={handleResolveConflicts}
        jiraResolving={jiraResolving}
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
        onCreateResource={isPopout ? undefined : handleCreateResource}
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
        handleSubmit={handleSubmit}
        handleCancelEdit={handleCancelEdit}
        handleRemoveContact={handleRemoveContact}
        onAddAssigneeToAddressBook={isPopout ? undefined : handleAddAssigneeToAddressBook}
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
      {!isPopout && <BlockersWindow {...blockersWindowProps} />}
      {!isPopout && (
        <RaidCreateHost
          create={raidCreate}
          lang={lang}
          tasks={tasks}
          raid={raid}
          stakeholdersEnabled={stakeholdersEnabled}
          stakeholders={stakeholders}
          resources={resources}
          contacts={contactsList}
          onCreateResource={handleCreateResource}
          onJumpToRaid={(id) => requestOpen("raid", id)}
        />
      )}
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
        onOpenVersion={desktopVersionRequest.openVersion}
        // From lg up: auto width + 24rem basis + 7rem floor, NOT the classic
        // mount's fixed lg:w-96 — a fixed width becomes TopBar's action-cluster
        // floor and squeezes the title (measured; see top-bar.test.tsx).
        search={
          <div className="min-w-0 w-44 max-w-[55vw] sm:w-72 lg:w-auto lg:min-w-28 lg:basis-96">
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
            storageReady={storageOk && !loadWasIncomplete && destructiveRefusal === null && loadPause === null}
            savingPaused={!isPopout && (loadWasIncomplete || destructiveRefusal !== null || loadPause !== null)}
            // ★ Clearing BOTH dismissals is correct, not sloppiness: the two causes
            // cannot hold at once — truncation returns ABOVE the destructive guard so
            // no new refusal is raised, AND the save effect's suppress-after-load
            // branch clears a standing refusal so none outlives its workspace — so at
            // most one banner is standing and clearing the other flag is a no-op.
            // ★ It stays correct if that ever stopped holding: clearing both re-shows
            // both, which is the honest outcome for a user who asked to see why
            // saving is paused.
            onRestoreSavingNotice={() => { setTruncationBannerDismissed(false); setDestructiveBannerDismissed(false); setLoadPauseBannerDismissed(false); }}
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
          activeView={activeTab}
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
  // ★ Gate on `!shownStorageError`: a FAILED list fetch never flips `tursoListLoaded`, so without it the
  // skeleton would render forever with no banner/nav; falling through restores the banner + Settings path.
  const showTursoListLoading =
    hydrated && portfolioMode === "turso" && !tursoListLoaded && !showTursoUnlock && !shownStorageError;
  // ★★★ §548 — THE LOAD HOLD. While `loadPending` (settings not yet hydrated, the first load, a
  //   backend-change reload, or a project-swap op in flight) the MAIN window renders the same `PanelSkeleton` the Turso list-load
  //   window uses INSTEAD of the app tree, so no control that writes workspace state exists — an edit
  //   made in that window was silently replaced when the load landed. ★ EXCEPT the two branches that
  //   rank ABOVE the hold in this ternary: `SecretUnlockGate` and `ProjectEmptyState` (file mode with an
  //   empty registry keeps the latter up through the first load and its own create/demo ops, whose
  //   swaps are themselves held via `holdDuring`). A failed or refused load SETTLES,
  //   so the storage banner and its recovery paths stay reachable. Popouts returned above and are never
  //   held. Every panel mounts FRESH after a hold (AGENTS.md "Remount-swallow"). Writers that do not
  //   unmount gate on `loadPending` themselves (docs/AGENTS/platform.md, "The load hold").

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
            ) : showTursoListLoading || loadPending ? (
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
