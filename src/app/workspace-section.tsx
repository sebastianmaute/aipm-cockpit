"use client";
import type React from "react";
import {
  useCallback,
  useMemo,
  useState,
} from "react";
import {
  t,
} from "./i18n";
import {
  useSettings,
} from "./use-settings";
import {
  useWorkspace,
} from "./workspace-context";
import { useEntityInlineAiEdit } from "./use-entity-inline-ai-edit";
import {
  useWorkspaceTab,
} from "./workspace-tab-context";
import {
  useFilters,
} from "./filters-context";
import {
  subTabsFor,
} from "./nav-config";
import {
  isModuleEnabled,
} from "./feature-modules";
import {
  DEFAULT_EXTRA_REPORTS,
} from "./addable-reports";

import {
  ActionChips,
  chipsForView,
} from "./action-chips";
import {
  TzClockStrip,
} from "./tz-clock-strip";
import {
  resolveTimezone,
} from "./timezone";
import { useEffectiveSettings } from "./use-effective-settings";
import { getTursoConfig } from "./turso-config";
import {
  ResourceDirectory,
} from "./resource-directory";
import {
  DashboardPanel,
} from "./dashboard-panel";
import {
  MilestonesPanel,
} from "./milestones-panel";
import { HelpView } from "./help-view";
import {
  SteeringCommitteePanel,
} from "./steering-committee-panel";

import {
  ChatPanel,
  GanttView,
  ReportsPanel,
  RaidPanel,
  ResourcesPanel,
  ActivityLogPanel,
  ResourcesReportPanel,
  RaidReportPanel,
  ChangePanel,
  ChangeReportPanel,
  StakeholdersPanel,
  RaciPanel,
  StakeholderMapPanel,
  BudgetPanel,
  BudgetReportPanel,
  TrendsPanel,
  HistoryPanel,
  PortfolioHealthPanel,
  ProjectsPanel,
  ActionsPanel,
  InsightsPanel,
  KnowledgePanel,
  TimelogPanel, DocumentsTabPanel,
} from "./workspace-panels";
import { baselineMilestoneTargets } from "./snapshot";
import { loadActualsCache } from "./timelog-actuals-store";
import type { WorkspaceSectionProps } from "./workspace-section-types";
import { WorkspaceTabStrip } from "./workspace-section-chrome";
import { isAiEnabled } from "./settings-types";
// Re-export so existing importers of `WorkspaceSectionProps` from
// "./workspace-section" keep working (the type now lives in the types module).
export type { WorkspaceSectionProps } from "./workspace-section-types";

export function WorkspaceSection({
  today,
  holidaySet,
  workspaceRef,
  resetWorkspaceSize,
  workspaceCollapsed,
  setWorkspaceCollapsed,
  dispatcher,
  handleGanttBarUpdate,
  handleCancelEdit,
  setTaskModalOpen,
  contactsList,
  onCreateResource,
  handleClearRaidTaskFilter,
  handleSaveRaidItem,
  handleDeleteRaidItem,
  onSendRaidInquiry,
  onCaptureRaidBulk,
  onCaptureUndo,
  onCaptureFieldEdit, onCaptureFieldRows,
  changes,
  documentsByEntity, allowDestructiveSave,
  handleSaveChange,
  handleDeleteChange,
  handleChangeStatusChange,
  onCaptureChangeBulk,
  stakeholders,
  handleSaveStakeholder,
  handleDeleteStakeholder,
  onCaptureStakeholderBulk,
  commsPendingStakeholderIds,
  onJumpToComms,
  handleCreateMitigationTaskFromRaid,
  handleJumpToTaskFromRaid,
  onOpenNotes,
  onOpenChangeNotes,
  activityLog,
  logActivity,
  logActivityChanges, logActivityAs,
  handleClearActivityLog,
  handleOpenAddAbsence,
  handleEditAbsence,
  handleMoveAbsence,
  calendarEvents,
  handleOpenAddCalendarEvent,
  handleEditCalendarEvent,
  handleSaveCalendarEvent,
  handleOpenShiftEditor,
  manageRolesView,
  onAssignRoleById,
  onBulkEditResources,
  onBulkDeleteResources,
  onSetUtilization,
  overAllocatedPct,
  onReassignTask,
  onClearUnlinked,
  onRescheduleTask,
  onSetAllUtilizationMode,
  onSetAbsenceOverride,
  onSetPlanWindow,
  onSetBudgetFollowsPlan,
  onEditResource,
  onAddResource,
  onImportOutlook,
  onImportOutlookCalendar,
  onEditTask,
  onChangeBudgets,
  onRefreshFx,
  fxLoading = false,
  fullBleed = false,
  trends,
  versionHistory,
  mode,
  projects,
  currentProjectId,
  currentProject,
  archivedProjects,
  projectStakeholderNames,
  projectAddressBook,
  projectResources,
  projectSettings,
  onChangeProjectSettings,
  onSwitchProject,
  onCreateProject,
  onUpdateCurrentProject,
  onDeleteProject,
  onExportCurrentProject,
  onLoadProjectFromFile,
  onMigrateProjectToTurso,
  onArchiveProject,
  onRestoreProject,
  onHardDeleteProject,
  nextActions,
  onOpenAction,
  insightActions,
  insightGeneratingId,
  onCancelInsightRecommendation,
  onSnooze,
  onCreateTask,
  onDraftMessage,
  assignOwner,
  escalate,
  rebaseline,
  reschedule,
  onMarkDone,
  onClearBlocker,
  learningEnabled,
  expertMode,
  onOpenLearningSettings,
  onOpenSettingsSection,
  onStartTour,
  catalogTours,
  completedTours,
  aiAnalysis,
  onPushMilestonesToOutlook,
  calendarPushBusy,
  onPullMilestonesFromOutlook,
  calendarPullBusy,
  committeeOutlookPush,
  committeeReport,
  m365Configured,
  raidCalendar,
  changeCalendar,
  absenceCalendar,
  guides = [],
  guidesReady = true,
}: WorkspaceSectionProps) {
  const { settings, setSettings, lang } = useSettings();
  const features = settings.features;
  // Accept the AI consent on THIS component's settings instance — useSettings()
  // is per-instance with no same-page sync, so writing through a parent handler
  // (a different instance) would never reach the ChatPanel rendered here.
  const handleAcceptAiConsent = useCallback(
    () => setSettings((s) => ({ ...s, ai: { ...s.ai, consentAccepted: true } })),
    [setSettings],
  );
  const { tasks, raid, absences, shifts, resources, setResources, roles, disciplines, grades, plan, budgets, fxRates, milestones, project, steeringCommittee, setSteeringCommittee, insights } = useWorkspace();
  // Per-project EFFECTIVE settings — device folded with this project's policy
  // overrides (nextActions/notifications/timezone) AND its per-device appearance
  // overrides (density/view-hints/tasks-view-mode). Reactive: an appearance change
  // re-renders via the store. With no override this equals the device values;
  // `settings` stays device for non-overridable reads.
  const effectiveSettings = useEffectiveSettings(currentProjectId ?? "default");
  const { activeTab, setActiveTab, isPopout, pendingChatSeed, clearChatSeed, requestOpen, pendingHelpConcept, requestHelpConcept, clearHelpConcept, getChatConversation, saveChatConversation } = useWorkspaceTab();
  const { raidFilterTaskId } = useFilters();
  // Directory map for resolving a linked owner/assignee's LIVE name in the
  // panels routed here (e.g. the standalone RAID By-Owner report) — the stored
  // owner/assignee string is only a stale-able cache.
  const resourcesById = useMemo(() => new Map(resources.map((r) => [r.id, r])), [resources]);
  // Per-person booked hours behind each Budget bucket role line. ★★ This is the
  // per-DEVICE Timelog cache — a DIFFERENT source from the persisted per-role
  // `actualHours` the role row directly above those people shows, and the two
  // can disagree with nothing in the UI saying so (open-followups §122). Read
  // once per project: it refreshes when this view remounts, which is the
  // accepted cost of not threading the live sync state through here. Keyed the
  // same way TimelogPanel keys the cache it WRITES — a different fallback than
  // `"default"` would miss every entry and silently report "unknown".
  const budgetActualsByBucket = useMemo(() => loadActualsCache(currentProjectId ?? "default")?.aggregates?.byBucket ?? {}, [currentProjectId]);
  // Inline "Ask Claude" per-row edit glue (SP2). One instance per entity pane;
  // each yields the row handlers threaded into the panel + its active-edit
  // popover element. Called unconditionally (hook rules); the popover only
  // renders when that pane is active and an edit is open.
  const inlineAiDeps = { dispatcher, settings, isPopout, lang }; // ★ NO logger — the inline editor writes no row of its own; each runTool it fires logs an "ai" entity row. See use-inline-entity-edit.
  // `active` auto-closes a left-open inline edit when its pane stops being the
  // active view (non-mouse nav doesn't trigger the popover's outside-click
  // dismiss). Tab keys match the tabpanel conditions below.
  const raidInlineAi = useEntityInlineAiEdit("raid", { ...inlineAiDeps, active: activeTab === "raid" });
  const changeInlineAi = useEntityInlineAiEdit("change", { ...inlineAiDeps, active: activeTab === "changes" });
  const milestoneInlineAi = useEntityInlineAiEdit("milestone", { ...inlineAiDeps, active: activeTab === "milestones" });
  const stakeholderInlineAi = useEntityInlineAiEdit("stakeholder", { ...inlineAiDeps, active: activeTab === "stakeholders" });
  // One-way signal: incrementing this opens the milestone create modal on the
  // Milestones tab (Gantt "Add milestone" parity with Add task).
  const [milestoneCreateNonce, setMilestoneCreateNonce] = useState(0);
  const subTabs = subTabsFor(activeTab, features, trends.active);
  const milestonesEnabled = isModuleEnabled("milestones", features);

  // Per-milestone committed baseline dates for the Gantt ghost overlay — only
  // when snapshots are live (Turso). Off Turso `trends.active` is false → empty
  // map → no ghosts, no toggle. Derived from the already-threaded `trends`.
  // Hoist the members to scalars — exhaustive-deps rejects `obj.member` deps.
  const trendsActive = trends.active;
  const trendsSnapshots = trends.snapshots;
  const baselineMilestoneDates = useMemo(() => (trendsActive ? baselineMilestoneTargets(trendsSnapshots) : undefined), [trendsActive, trendsSnapshots]);
  const raidEnabledForChanges = isModuleEnabled("raid", features);
  const stakeholdersEnabled = isModuleEnabled("stakeholders", features);

  // Panel wrappers. The pt-4 offset clears the tab strip in classic/popout mode;
  // in fullBleed the strip is hidden, so we drop it to align the per-view card
  // with the modern shell's inset edge (matching the Tasks pane exactly).
  const effectiveTz = resolveTimezone(effectiveSettings.timezone, project?.operatingTimezone);
  // Mirrors portfolio-health-panel.tsx's getTursoConfig(settings...) pattern.
  // FRESH object every call — memoize on the credential strings, or an unstable
  // identity re-fires useChatThreads' fetch effect (dep array), wiping the chat.
  // Hoisted to locals: exhaustive-deps rejects an `obj.member` dependency.
  const tursoUrl = settings.integrations?.turso?.databaseUrl;
  const tursoToken = settings.integrations?.turso?.authToken;
  const chatTursoConfig = useMemo(() => getTursoConfig(tursoUrl, tursoToken), [tursoUrl, tursoToken]);
  // Gate on BOTH signals (Turso storage OR Turso portfolio `mode`) AND
  // `chatTursoConfig !== null` — mirrors task-manager.tsx's `trendsActive`,
  // which reads storageConfig.kind unguarded; storageConfig is non-optional.
  const chatTursoMode = (settings.storageConfig.kind === "turso" || mode === "turso") && chatTursoConfig !== null;
  const panelClass = fullBleed ? "min-h-0 flex-1" : "min-h-0 flex-1 pt-4";
  const panelScrollClass = fullBleed
    ? "min-h-0 flex-1 overflow-y-auto"
    : "min-h-0 flex-1 overflow-y-auto pt-4";

  return (
    <section
      ref={workspaceRef}
      className={
        fullBleed
          ? // Sizing-only transparent container. The per-view card is the only
            // surface (matching the Tasks pane). h-full fills the modern shell's
            // block <main>; flex-1 would be a no-op here and collapse to content.
            "flex h-full min-h-0 w-full flex-col overflow-hidden"
          : isPopout
          ? "flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface p-6"
          : workspaceCollapsed
          ? "mb-10 flex w-full flex-col rounded-xl border border-line bg-surface p-6"
          : "relative mb-10 flex h-[560px] min-h-[420px] w-full min-w-[520px] resize flex-col overflow-hidden rounded-xl border border-line bg-surface p-6"
      }
    >
      {!isPopout && !fullBleed && (
        <WorkspaceTabStrip
          lang={lang}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          workspaceCollapsed={workspaceCollapsed}
          setWorkspaceCollapsed={setWorkspaceCollapsed}
          resetWorkspaceSize={resetWorkspaceSize}
          features={features}
          reuseWindow={settings.popout.reuseWindow}
          handleClearRaidTaskFilter={handleClearRaidTaskFilter}
          subTabs={subTabs}
        />
      )}

      <div
        id="workspace-panels"
        hidden={!isPopout && !fullBleed && workspaceCollapsed}
        className="flex min-h-0 flex-1 flex-col"
      >
        <ActionChips
          lang={lang}
          // open-points renders in TasksSection (which carries its own strip);
          // in classic both surfaces mount, so exclude it here to avoid a
          // duplicate/orphan strip in the workspace card.
          actions={activeTab === "open-points" ? [] : chipsForView(nextActions, activeTab)}
          onOpen={onOpenAction}
          onShowMore={() => setActiveTab("actions")}
          className="mb-2 shrink-0"
        />
        {/* open-points owns its callout in TasksSection; in classic both surfaces
            mount, so exclude it here to avoid a duplicate banner (mirrors ActionChips). */}
        {/* Each view owns its Help callout INSIDE its own card (like Open Points)
            — see the per-panel ViewCallout. No shared above-card callout. */}
        <div
          id="panel-chat"
          role="tabpanel"
          hidden={activeTab !== "chat"}
          className={panelClass}
        >
          <ChatPanel
            lang={lang}
            ai={settings.ai}
            dictation={settings.dictation}
            dispatcher={dispatcher}
            onAcceptConsent={handleAcceptAiConsent}
            onConfigureAi={
              !isPopout && onOpenSettingsSection
                ? () => onOpenSettingsSection("ai")
                : undefined
            }
            onChangeModel={(model) => setSettings((s) => ({ ...s, ai: { ...s.ai, model } }))}
            guides={guides}
            guidesReady={guidesReady}
            chatSeed={pendingChatSeed}
            onChatSeedConsumed={clearChatSeed}
            projectId={currentProjectId ?? "default"}
            getChatConversation={getChatConversation}
            saveChatConversation={saveChatConversation}
            tursoMode={chatTursoMode}
            tursoConfig={chatTursoConfig}
          />
        </div>

        {activeTab === "reports" && (
          <div
            id="panel-reports"
            role="tabpanel"
            className={panelScrollClass}
          >
            <ReportsPanel
              tasks={tasks}
              today={today}
              holidaySet={holidaySet}
              lang={lang}
              raid={raid}
              buckets={budgets}
              plan={plan}
              roles={roles}
              disciplines={disciplines}
              grades={grades}
              resources={resources}
              absences={absences}
              workdayHours={settings.resources.workdayHours}
              fxRates={fxRates}
              extraReports={settings.reports?.extra ?? DEFAULT_EXTRA_REPORTS}
              onChangeExtraReports={(next) => setSettings((s) => ({ ...s, reports: { ...s.reports, extra: next } }))}
              stakeholders={stakeholders}
              milestones={milestones}
              features={settings.features}
              nextActions={nextActions}
              onOpenAction={onOpenAction}
              onShowActions={() => setActiveTab("actions")}
            />
          </div>
        )}

        {activeTab === "gantt" && (
          <div
            id="panel-gantt"
            role="tabpanel"
            className={panelClass}
          >
            <GanttView
              onUpdateBar={handleGanttBarUpdate}
              onAddTask={isPopout ? undefined : () => {
                handleCancelEdit();
                setTaskModalOpen(true);
              }}
              onEditTask={isPopout ? undefined : onEditTask}
              onAddMilestone={milestonesEnabled
                ? () => { setActiveTab("milestones"); setMilestoneCreateNonce((n) => n + 1); }
                : undefined}
              onEditMilestone={milestonesEnabled
                ? () => setActiveTab("milestones")
                : undefined}
              showHints={effectiveSettings.showViewHints !== false}
              milestonesEnabled={milestonesEnabled}
              baselineMilestoneDates={baselineMilestoneDates}
              onCaptureUndo={onCaptureUndo}
            />
          </div>
        )}

        <div id="panel-raid" role="tabpanel" hidden={activeTab !== "raid"} className={panelClass}>
          <RaidPanel
            lang={lang}
            tasks={tasks}
            raid={raid}
            documentsByEntity={documentsByEntity}
            stakeholdersEnabled={stakeholdersEnabled}
            stakeholders={stakeholders}
            resources={resources}
            contacts={contactsList}
            onCreateResource={onCreateResource}
            today={today}
            filterTaskId={raidFilterTaskId}
            onClearTaskFilter={handleClearRaidTaskFilter}
            onSave={handleSaveRaidItem}
            onDelete={handleDeleteRaidItem}
            onSendInquiry={onSendRaidInquiry}
            onCaptureBulk={onCaptureRaidBulk}
            onCreateMitigationTask={handleCreateMitigationTaskFromRaid}
            onJumpToTask={handleJumpToTaskFromRaid}
            onOpenNotes={onOpenNotes}
            showHints={effectiveSettings.showViewHints !== false}
            isPopout={isPopout}
            onLearnMore={requestHelpConcept}
            m365Configured={m365Configured}
            calendarEnabled={raidCalendar?.enabled}
            onToggleCalendar={raidCalendar?.onToggle}
            onPushCalendar={raidCalendar?.onPush}
            calendarPushBusy={raidCalendar?.pushBusy}
            onPullCalendar={raidCalendar?.onPull}
            calendarPullBusy={raidCalendar?.pullBusy}
            onAiEdit={raidInlineAi.onAiEdit}
            aiEditEnabled={raidInlineAi.aiEditEnabled}
          />
          {raidInlineAi.popover}
        </div>

        {activeTab === "resources" && (
          <div
            id="panel-resources"
            role="tabpanel"
            className={panelClass}
          >
            <ResourcesReportPanel
              lang={lang}
              resources={resources}
              roles={roles}
              disciplines={disciplines}
              grades={grades}
              plan={plan}
              absences={absences}
              holidaySet={holidaySet}
              workdayHours={settings.resources.workdayHours}
              showHints={effectiveSettings.showViewHints !== false}
              isPopout={isPopout}
              onLearnMore={requestHelpConcept}
            />
          </div>
        )}

        {activeTab === "directory" && (
          <div
            id="panel-directory"
            role="tabpanel"
            className={panelClass}
          >
            <ResourceDirectory
              lang={lang}
              resources={resources}
              roles={roles}
              disciplines={disciplines}
              grades={grades}
              onAssignRoleById={onAssignRoleById}
              onEditResource={onEditResource}
              onBulkEditResources={onBulkEditResources}
              onBulkDeleteResources={onBulkDeleteResources}
              onAddResource={onAddResource}
              onAddAbsence={handleOpenAddAbsence}
              onImportOutlook={onImportOutlook}
            />
          </div>
        )}

        {(activeTab === "workload" || activeTab === "calendar" || activeTab === "planning") && (
          <div
            id="panel-resources-view"
            role="tabpanel"
            className={panelClass}
          >
            {activeTab === "calendar" && (effectiveSettings.additionalTimezones?.length ?? 0) > 0 && (
              <TzClockStrip lang={lang} defaultTz={effectiveTz} zones={effectiveSettings.additionalTimezones ?? []} />
            )}
            <ResourcesPanel
              view={activeTab}
              lang={lang}
              tasks={tasks}
              absences={absences}
              shifts={shifts}
              raid={raid}
              raidEnabled={raidEnabledForChanges}
              resources={resources}
              today={today}
              holidaySet={holidaySet}
              onAddAbsence={handleOpenAddAbsence}
              onEditAbsence={handleEditAbsence}
              onMoveAbsence={handleMoveAbsence}
              calendarEvents={calendarEvents}
              onAddCalendarEvent={handleOpenAddCalendarEvent}
              onEditCalendarEvent={handleEditCalendarEvent}
              onSaveCalendarEvent={handleSaveCalendarEvent}
              onEditShift={handleOpenShiftEditor}
              roles={roles}
              disciplines={disciplines}
              grades={grades}
              setResources={setResources}
              plan={plan}
              workdayHours={settings.resources.workdayHours}
              onSetUtilization={onSetUtilization}
              overAllocatedPct={overAllocatedPct}
              onReassignTask={onReassignTask}
              onRescheduleTask={onRescheduleTask}
              onClearUnlinked={onClearUnlinked}
              onSetAllUtilizationMode={onSetAllUtilizationMode}
              onSetAbsenceOverride={onSetAbsenceOverride}
              onSetPlanWindow={onSetPlanWindow}
              onEditResource={onEditResource}
              onAddResource={onAddResource}
              onImportOutlookCalendar={onImportOutlookCalendar}
              m365Configured={m365Configured}
              calendarEnabled={absenceCalendar?.enabled}
              onToggleCalendar={absenceCalendar?.onToggle}
              onPushCalendar={absenceCalendar?.onPush}
              calendarPushBusy={absenceCalendar?.pushBusy}
              onPullCalendar={absenceCalendar?.onPull}
              calendarPullBusy={absenceCalendar?.pullBusy}
              showHints={effectiveSettings.showViewHints !== false}
              isPopout={isPopout}
              onLearnMore={requestHelpConcept}
              onCaptureUndo={onCaptureUndo}
              logActivityAs={logActivityAs}
            />
          </div>
        )}

        {activeTab === "manage-roles" && (
          <div id="panel-manage-roles" role="tabpanel" className={panelClass}>
            {manageRolesView}
          </div>
        )}

        {activeTab === "activity" && (
          <div
            id="panel-activity"
            role="tabpanel"
            className={panelClass}
          >
            <ActivityLogPanel
              lang={lang}
              entries={activityLog}
              onClear={handleClearActivityLog}
            />
          </div>
        )}

        {activeTab === "help" && (
          <div id="panel-help" role="tabpanel" className={panelClass}>
            <HelpView
              lang={lang}
              pendingHelpConcept={pendingHelpConcept}
              onHelpConceptConsumed={clearHelpConcept}
              onNavigateView={(v) => setActiveTab(v)}
              onStartTour={onStartTour}
              catalogTours={catalogTours}
              completedTours={completedTours}
            />
          </div>
        )}

        {activeTab === "raid-report" && (
          <div id="panel-raid-report" role="tabpanel" className={panelScrollClass}>
            <RaidReportPanel lang={lang} items={raid} today={today} resourcesById={resourcesById} />
          </div>
        )}

        {activeTab === "changes" && (
          <div id="panel-changes" role="tabpanel" className={panelClass}>
            <ChangePanel
              lang={lang}
              tasks={tasks}
              raid={raidEnabledForChanges ? raid : []}
              changes={changes}
              documentsByEntity={documentsByEntity}
              today={today}
              onSave={handleSaveChange}
              onDelete={handleDeleteChange}
              onStatusChange={handleChangeStatusChange}
              onOpenNotes={onOpenChangeNotes}
              onCaptureBulk={onCaptureChangeBulk}
              raidEnabled={raidEnabledForChanges}
              stakeholdersEnabled={stakeholdersEnabled}
              stakeholders={stakeholders}
              showHints={effectiveSettings.showViewHints !== false}
              isPopout={isPopout}
              onLearnMore={requestHelpConcept}
              m365Configured={m365Configured}
              calendarEnabled={changeCalendar?.enabled}
              onToggleCalendar={changeCalendar?.onToggle}
              onPushCalendar={changeCalendar?.onPush}
              calendarPushBusy={changeCalendar?.pushBusy}
              onPullCalendar={changeCalendar?.onPull}
              calendarPullBusy={changeCalendar?.pullBusy}
              onAiEdit={changeInlineAi.onAiEdit}
              aiEditEnabled={changeInlineAi.aiEditEnabled}
            />
            {changeInlineAi.popover}
          </div>
        )}

        {activeTab === "change-report" && (
          <div id="panel-change-report" role="tabpanel" className={panelScrollClass}>
            <ChangeReportPanel lang={lang} items={changes} today={today} />
          </div>
        )}

        {activeTab === "stakeholders" && (
          <div id="panel-stakeholders" role="tabpanel" className={panelClass}>
            <StakeholdersPanel
              lang={lang}
              stakeholders={stakeholders}
              resources={resources}
              milestones={milestones}
              onSave={handleSaveStakeholder}
              onDelete={handleDeleteStakeholder}
              onCaptureBulk={onCaptureStakeholderBulk}
              commsPendingStakeholderIds={commsPendingStakeholderIds}
              onJumpToComms={onJumpToComms}
              showHints={effectiveSettings.showViewHints !== false}
              isPopout={isPopout}
              onLearnMore={requestHelpConcept}
              onAiEdit={stakeholderInlineAi.onAiEdit}
              aiEditEnabled={stakeholderInlineAi.aiEditEnabled}
            />
            {stakeholderInlineAi.popover}
          </div>
        )}

        {activeTab === "raci" && (
          <div id="panel-raci" role="tabpanel" className={panelClass}>
            <RaciPanel
              lang={lang}
              stakeholders={stakeholders}
              milestones={milestones}
              onSave={handleSaveStakeholder}
              onCaptureBulk={onCaptureStakeholderBulk}
              logActivityAs={logActivityAs}
              showHints={effectiveSettings.showViewHints !== false}
              isPopout={isPopout}
              onLearnMore={requestHelpConcept}
            />
          </div>
        )}

        {activeTab === "stakeholder-map" && (
          <div id="panel-stakeholder-map" role="tabpanel" className={panelClass}>
            <StakeholderMapPanel
              lang={lang}
              stakeholders={stakeholders}
              onOpenStakeholder={isPopout ? undefined : (id) => requestOpen("stakeholders", id)}
              onSaveStakeholder={isPopout ? undefined : handleSaveStakeholder}
              showHints={effectiveSettings.showViewHints !== false}
              isPopout={isPopout}
              onLearnMore={requestHelpConcept}
            />
          </div>
        )}

        {activeTab === "budget" && (
          <div id="panel-budget" role="tabpanel" className={panelScrollClass}>
            <BudgetPanel
              lang={lang}
              buckets={budgets}
              roles={roles}
              disciplines={disciplines}
              grades={grades}
              resources={resources}
              plan={plan}
              fxRates={fxRates}
              absences={absences}
              holidaySet={holidaySet}
              workdayHours={settings.resources.workdayHours}
              today={today}
              tasks={tasks}
              actualsByBucket={budgetActualsByBucket}
              timelogProjectId={currentProjectId ?? "default"} onGoToTimelog={() => setActiveTab("timelog")}
              onChangeBuckets={onChangeBudgets}
              onSetBudgetFollowsPlan={onSetBudgetFollowsPlan}
              onRefreshFx={onRefreshFx}
              fxLoading={fxLoading}
              showHints={effectiveSettings.showViewHints !== false}
              isPopout={isPopout}
              onLearnMore={requestHelpConcept}
            />
          </div>
        )}

        {activeTab === "budget-report" && (
          <div id="panel-budget-report" role="tabpanel" className={panelScrollClass}>
            <BudgetReportPanel
              lang={lang}
              buckets={budgets}
              plan={plan}
              roles={roles} disciplines={disciplines}
              resources={resources}
              absences={absences}
              holidaySet={holidaySet}
              workdayHours={settings.resources.workdayHours}
              fxRates={fxRates}
              tasks={tasks}
              today={today}
              showHints={effectiveSettings.showViewHints !== false}
              isPopout={isPopout}
              onLearnMore={requestHelpConcept}
            />
          </div>
        )}

        {activeTab === "milestones" && (
          <div id="panel-milestones" role="tabpanel" className={panelScrollClass}>
            <MilestonesPanel
              lang={lang}
              today={today}
              holidaySet={holidaySet}
              documentsByEntity={documentsByEntity}
              logActivity={logActivity}
              logActivityChanges={logActivityChanges}
              capture={onCaptureUndo}
              captureFieldEdit={onCaptureFieldEdit}
              captureFieldRows={onCaptureFieldRows}
              openCreateNonce={milestoneCreateNonce}
              onCreateConsumed={() => setMilestoneCreateNonce(0)}
              onPushToOutlook={onPushMilestonesToOutlook}
              calendarPushBusy={calendarPushBusy}
              onPullFromOutlook={onPullMilestonesFromOutlook}
              calendarPullBusy={calendarPullBusy}
              showHints={effectiveSettings.showViewHints !== false}
              isPopout={isPopout}
              onLearnMore={requestHelpConcept}
              onAiEdit={milestoneInlineAi.onAiEdit}
              aiEditEnabled={milestoneInlineAi.aiEditEnabled}
            />
            {milestoneInlineAi.popover}
          </div>
        )}

        {activeTab === "steering-committee" && (
          <div id="panel-steering-committee" role="tabpanel" className={panelScrollClass}>
            <SteeringCommitteePanel
              lang={lang}
              committee={steeringCommittee}
              onChange={setSteeringCommittee}
              resources={resources}
              today={today}
              outlookPush={committeeOutlookPush}
              report={committeeReport}
              showHints={effectiveSettings.showViewHints !== false}
              isPopout={isPopout}
              onLearnMore={requestHelpConcept}
            />
          </div>
        )}

        {activeTab === "dashboard" && (
          <div id="panel-dashboard" role="tabpanel" className={panelScrollClass}>
            <DashboardPanel
              lang={lang}
              tasks={tasks}
              raid={raid}
              changes={changes}
              budgets={budgets}
              plan={plan}
              roles={roles}
              resources={resources}
              absences={absences}
              holidaySet={holidaySet}
              workdayHours={settings.resources.workdayHours}
              today={today}
              milestones={milestones}
              onOpenRaid={(id) => {
                if (id < 0) setActiveTab("raid");
                else requestOpen("raid", id);
                handleClearRaidTaskFilter();
                if (workspaceCollapsed) setWorkspaceCollapsed(false);
              }}
              onOpenTask={onEditTask ? (id) => {
                const task = tasks.find((t) => t.id === id);
                if (task) onEditTask(task);
              } : undefined}
              onOpenMilestone={(id) => {
                if (id < 0) setActiveTab("milestones");
                else requestOpen("milestones", id);
              }}
              showRaid={isModuleEnabled("raid", settings.features)}
              showBudget={isModuleEnabled("budget", settings.features)}
              showMilestones={isModuleEnabled("milestones", settings.features)}
              showChanges={isModuleEnabled("changes", settings.features)}
              variance={trends.variance}
              snapshots={trends.snapshots}
              tursoActive={trends.active}
              topActions={nextActions.slice(0, 5)}
              onOpenAction={onOpenAction}
              projectId={currentProjectId ?? "default"}
              isPopout={isPopout}
              onOpenChange={(id) => {
                if (id < 0) setActiveTab("changes");
                else requestOpen("changes", id);
              }}
              onNavigate={(v, section) => {
                setActiveTab(v);
                if (section && onOpenSettingsSection) onOpenSettingsSection(section);
              }}
              aiConfigured={isAiEnabled(settings.ai)}
              density={effectiveSettings.dashboardDensity ?? "comfortable"}
              insightActions={insightActions}
              insightGeneratingId={insightGeneratingId}
              onCancelInsightRecommendation={onCancelInsightRecommendation}
              insightAiEnabled={isAiEnabled(settings.ai)}
            />
          </div>
        )}

        {activeTab === "trends" && (
          <div id="panel-trends" role="tabpanel" className={panelScrollClass}>
            <TrendsPanel
              lang={lang}
              active={trends.active}
              snapshots={trends.snapshots}
              baseline={trends.baseline}
              latest={trends.latest}
              variance={trends.variance}
              gaps={trends.gaps}
              busy={trends.busy}
              captureNow={trends.captureNow}
              setBaseline={trends.setBaseline}
              deleteSnapshot={trends.deleteSnapshot}
              deleteSnapshots={trends.deleteSnapshots}
              showHints={effectiveSettings.showViewHints !== false}
              isPopout={isPopout}
              onLearnMore={requestHelpConcept}
            />
          </div>
        )}

        {activeTab === "history" && (
          <div id="panel-history" role="tabpanel" className={panelScrollClass}>
            <HistoryPanel
              lang={lang}
              versions={versionHistory.versions}
              busy={versionHistory.busy}
              onCaptureNow={(label) => void versionHistory.captureNow(label)}
              loadDiff={versionHistory.loadDiff}
              restore={versionHistory.restore}
              onDelete={versionHistory.remove}
            />
          </div>
        )}

        {activeTab === "portfolio-health" && (
          <div id="panel-portfolio-health" role="tabpanel" className={panelScrollClass}>
            <PortfolioHealthPanel
              lang={lang}
              settings={settings}
              projects={projects}
              today={today}
              holidaySet={holidaySet}
              workdayHours={settings.resources.workdayHours}
              onSwitchProject={isPopout ? undefined : onSwitchProject}
            />
          </div>
        )}

        {activeTab === "actions" && (
          <div id="panel-actions" role="tabpanel" className={panelClass}>
            <ActionsPanel lang={lang} actions={nextActions} onOpen={onOpenAction} onSnooze={onSnooze} onCreateTask={onCreateTask} onDraftMessage={onDraftMessage} assignOwner={assignOwner} escalate={escalate} rebaseline={rebaseline} reschedule={reschedule} onMarkDone={onMarkDone} onClearBlocker={onClearBlocker} learningEnabled={learningEnabled} expertMode={expertMode} onOpenLearningSettings={onOpenLearningSettings} aiAnalysis={aiAnalysis} />
          </div>
        )}

        {activeTab === "insights" && (
          <div id="panel-insights" role="tabpanel" className={panelScrollClass}>
            <InsightsPanel
              insights={insights ?? []}
              lang={lang}
              today={today}
              actions={isPopout ? undefined : insightActions}
              generatingId={isPopout ? undefined : insightGeneratingId}
              onCancelGenerate={isPopout ? undefined : onCancelInsightRecommendation}
              aiEnabled={isAiEnabled(settings.ai)}
              onOpen={(refItem) => {
                if (refItem.id < 0) setActiveTab(refItem.view);
                else requestOpen(refItem.view, refItem.id);
              }}
              isPopout={isPopout}
            />
          </div>
        )}

        {activeTab === "knowledge" && (
          <div id="panel-knowledge" role="tabpanel" className={panelClass}>
            <KnowledgePanel />
          </div>
        )}

        {activeTab === "documents" && <DocumentsTabPanel className={panelClass} lang={lang} isPopout={isPopout} allowDestructiveSave={allowDestructiveSave} />}

        {activeTab === "timelog" && (
          <div id="panel-timelog" role="tabpanel" className={panelClass}>
            <TimelogPanel lang={lang} isPopout={isPopout} projectKey={currentProjectId ?? "default"} onConfigureTimelog={!isPopout && onOpenSettingsSection ? () => onOpenSettingsSection("integrations") : undefined} />
          </div>
        )}

        {activeTab === "projects" && (
          <div id="panel-projects" role="tabpanel" className={panelScrollClass}>
            <ProjectsPanel
              projects={projects}
              currentProjectId={currentProjectId}
              currentProject={currentProject}
              archivedProjects={archivedProjects}
              stakeholderNames={projectStakeholderNames}
              addressBook={projectAddressBook}
              resources={projectResources}
              settings={projectSettings}
              onChangeSettings={onChangeProjectSettings}
              lang={lang}
              onSwitch={onSwitchProject}
              onCreate={onCreateProject}
              onUpdateCurrent={onUpdateCurrentProject}
              onDelete={onDeleteProject}
              onExportCurrent={onExportCurrentProject}
              onLoadFromFile={onLoadProjectFromFile}
              onMigrateToTurso={onMigrateProjectToTurso}
              onArchive={onArchiveProject}
              onRestore={onRestoreProject}
              onHardDelete={onHardDeleteProject}
              mode={mode}
            />
          </div>
        )}

      </div>
      {!isPopout && !fullBleed && !workspaceCollapsed && (
        <span
          aria-hidden={true}
          title={t(lang, "workspaceResizeHint")}
          className="pointer-events-none absolute bottom-1 right-1 select-none text-muted-foreground"
        >
          ⠿
        </span>
      )}
    </section>
  );
}
