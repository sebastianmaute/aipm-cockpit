"use client";
import dynamic from "next/dynamic";
import type React from "react";
import { useCallback, useState } from "react";
import { t } from "./i18n";
import { openPopoutWindow } from "./broadcast-sync";
import { useSettings } from "./use-settings";
import { useWorkspace } from "./workspace-context";
import { useWorkspaceTab } from "./workspace-tab-context";
import { useFilters } from "./filters-context";
import { TabButton, ResetSizeIcon } from "./task-manager-ui";
import { navLabelKey, subTabsFor } from "./nav-config";
import { isModuleEnabled } from "./feature-modules";
import { DEFAULT_EXTRA_REPORTS } from "./addable-reports";
import type { ToolDispatcher } from "./chat-tools";
import type { UseSnapshotsResult } from "./use-snapshots";
import type { UseVersionHistoryResult } from "./use-version-history";
import type { ActivityEntry, ActivityKind } from "./activity-log";
import type { Absence, BudgetBucket, ChangeItem, ProjectMeta, RaidItem, Resource, Shift, Stakeholder, Task } from "./types";
import type { NewProjectOpts } from "./new-project-workspace";
import type { Settings } from "./settings-types";
import type { ProjectRegistryEntry } from "./projects-registry";
import type { Contact } from "./contacts";
import type { SuggestedAction } from "./next-actions";
import type { AssignOwnerBundle } from "./action-row";
import type { EscalateBundle } from "./escalate-popover";
import type { RebaselineBundle } from "./rebaseline-popover";
import type { AiAnalysisBundle } from "./actions-panel";
import type { OperatingGuide } from "./operating-guide";
import { ActionChips, chipsForView } from "./action-chips";
import { ResourceDirectory } from "./resource-directory";
import { DashboardPanel } from "./dashboard-panel";
import { MilestonesPanel } from "./milestones-panel";
import { SteeringCommitteePanel } from "./steering-committee-panel";

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
const ResourcesReportPanel = dynamic(
  () => import("./resources-report").then((m) => m.ResourcesReportPanel),
  { ssr: false },
);
const RaidReportPanel = dynamic(
  () => import("./raid-report-panel").then((m) => m.RaidReportPanel),
  { ssr: false },
);
const ChangePanel = dynamic(
  () => import("./change-panel").then((m) => m.ChangePanel),
  { ssr: false },
);
const ChangeReportPanel = dynamic(
  () => import("./change-report-panel").then((m) => m.ChangeReportPanel),
  { ssr: false },
);
const StakeholdersPanel = dynamic(
  () => import("./stakeholders-panel").then((m) => m.StakeholdersPanel),
  { ssr: false },
);
const RaciPanel = dynamic(
  () => import("./raci-panel").then((m) => m.RaciPanel),
  { ssr: false },
);
const StakeholderMapPanel = dynamic(
  () => import("./stakeholder-map-panel").then((m) => m.StakeholderMapPanel),
  { ssr: false },
);
const BudgetPanel = dynamic(
  () => import("./budget-panel").then((m) => m.BudgetPanel),
  { ssr: false },
);
const BudgetReportPanel = dynamic(
  () => import("./budget-report-panel").then((m) => m.BudgetReportPanel),
  { ssr: false },
);
const TrendsPanel = dynamic(
  () => import("./trends-panel").then((m) => m.TrendsPanel),
  { ssr: false },
);
const HistoryPanel = dynamic(
  () => import("./history-panel").then((m) => m.HistoryPanel),
  { ssr: false },
);
const ProjectsPanel = dynamic(
  () => import("./projects-panel").then((m) => m.ProjectsPanel),
  { ssr: false },
);
const ActionsPanel = dynamic(
  () => import("./actions-panel").then((m) => m.ActionsPanel),
  { ssr: false },
);
const DocumentsPanel = dynamic(
  () => import("./documents-panel").then((m) => m.DocumentsPanel),
  { ssr: false },
);

export interface WorkspaceSectionProps {
  today: string;
  holidaySet: Set<string>;
  workspaceRef: React.RefObject<HTMLElement | null>;
  resetWorkspaceSize: () => void;
  workspaceCollapsed: boolean;
  setWorkspaceCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  dispatcher: ToolDispatcher;
  fullBleed?: boolean;
  handleGanttBarUpdate: (edit: {
    taskId: number;
    startDate: string;
    dueDate: string;
  }) => void;
  handleCancelEdit: () => void;
  setTaskModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  contactsList: Contact[];
  onCreateResource: (name: string, email: string) => number;
  handleClearRaidTaskFilter: () => void;
  handleSaveRaidItem: (item: RaidItem) => void;
  handleDeleteRaidItem: (id: number) => void;
  changes: readonly ChangeItem[];
  handleSaveChange: (item: ChangeItem) => void;
  handleDeleteChange: (id: number, title: string) => void;
  stakeholders: readonly Stakeholder[];
  handleSaveStakeholder: (item: Stakeholder) => void;
  handleDeleteStakeholder: (id: number, name: string) => void;
  /** Stakeholder ids with a pending stakeholder-comms next-action (drives the matrix icon). */
  commsPendingStakeholderIds?: ReadonlySet<number>;
  /** Jump to the Action Center for the given stakeholder. */
  onJumpToComms?: (stakeholderId: number) => void;
  handleCreateMitigationTaskFromRaid: (raidId: number) => number | null | undefined;
  handleJumpToTaskFromRaid: (taskId: number) => void;
  activityLog: ActivityEntry[];
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  handleClearActivityLog: () => void;
  handleOpenAddAbsence: () => void;
  handleEditAbsence: (absence: Absence) => void;
  handleOpenShiftEditor: (
    existingShift: Shift | null,
    assignee: { display: string; email: string },
  ) => void;
  manageRolesView?: React.ReactNode;
  onAssignRole: (resourceId: number, disciplineId: number, gradeId: number) => void;
  onSetUtilization: (resourceId: number, periodKey: string, value: number) => void;
  onSetAllUtilizationMode: (mode: "percent" | "hours") => void;
  onSetAbsenceOverride: (resourceId: number, periodKey: string, hours: number | null) => void;
  onSetPlanWindow: (startDate: string, endDate: string) => void;
  onEditResource: (resource: Resource) => void;
  onAddResource: (seed?: Partial<Resource>) => void;
  onImportOutlook?: () => void;
  onImportOutlookCalendar?: () => void;
  onEditTask?: (task: Task) => void;
  onChangeBudgets: (next: BudgetBucket[]) => void;
  onRefreshFx: () => void;
  fxLoading?: boolean;
  trends: UseSnapshotsResult & { active: boolean };
  versionHistory: UseVersionHistoryResult;
  // Multi-project (Projects view). The mutating callbacks are no-ops in popouts
  // (their hook implementations early-return on isPopout); the panel still
  // renders read-only there, matching every other panel. Mode-aware: file mode
  // uses the localStorage registry; turso mode uses the shared DB project list
  // (archive/restore/hard-delete instead of delete-from-registry).
  mode: "file" | "turso";
  projects: ProjectRegistryEntry[];
  currentProjectId: string | null;
  currentProject?: ProjectMeta;
  archivedProjects?: ProjectRegistryEntry[];
  projectStakeholderNames: string[];
  projectAddressBook: Contact[];
  projectResources: readonly Resource[];
  projectSettings: Settings;
  onChangeProjectSettings: (s: Settings) => void;
  onSwitchProject: (id: string) => void;
  onCreateProject: (meta: ProjectMeta, format: "json" | "csv" | "md", opts?: NewProjectOpts) => void;
  onUpdateCurrentProject: (meta: ProjectMeta) => void;
  onDeleteProject: (id: string) => void;
  onExportCurrentProject: (format: string) => void;
  onLoadProjectFromFile: () => void;
  onMigrateProjectToTurso: () => void;
  onArchiveProject?: (id: string) => void;
  onRestoreProject?: (id: string) => void;
  onHardDeleteProject?: (id: string) => void;
  nextActions: readonly SuggestedAction[];
  onOpenAction: (a: SuggestedAction) => void;
  onSnooze?: (a: SuggestedAction, ms: number) => void;
  onCreateTask?: (a: SuggestedAction) => void;
  onDraftMessage?: (a: SuggestedAction) => void;
  assignOwner?: AssignOwnerBundle;
  escalate?: EscalateBundle;
  rebaseline?: RebaselineBundle;
  learningEnabled?: boolean;
  expertMode?: boolean;
  onOpenLearningSettings?: () => void;
  aiAnalysis?: AiAnalysisBundle;
  onPushMilestonesToOutlook?: () => void;
  calendarPushBusy?: boolean;
  guides?: readonly OperatingGuide[];
  guidesReady?: boolean;
}

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
  changes,
  handleSaveChange,
  handleDeleteChange,
  stakeholders,
  handleSaveStakeholder,
  handleDeleteStakeholder,
  commsPendingStakeholderIds,
  onJumpToComms,
  handleCreateMitigationTaskFromRaid,
  handleJumpToTaskFromRaid,
  activityLog,
  logActivity,
  handleClearActivityLog,
  handleOpenAddAbsence,
  handleEditAbsence,
  handleOpenShiftEditor,
  manageRolesView,
  onAssignRole,
  onSetUtilization,
  onSetAllUtilizationMode,
  onSetAbsenceOverride,
  onSetPlanWindow,
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
  onSnooze,
  onCreateTask,
  onDraftMessage,
  assignOwner,
  escalate,
  rebaseline,
  learningEnabled,
  expertMode,
  onOpenLearningSettings,
  aiAnalysis,
  onPushMilestonesToOutlook,
  calendarPushBusy,
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
  const { tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, milestones, steeringCommittee, setSteeringCommittee } = useWorkspace();
  const { activeTab, setActiveTab, isPopout, pendingChatSeed, clearChatSeed, requestOpen } = useWorkspaceTab();
  const { raidFilterTaskId } = useFilters();
  // One-way signal: incrementing this opens the milestone create modal on the
  // Milestones tab (Gantt "Add milestone" parity with Add task).
  const [milestoneCreateNonce, setMilestoneCreateNonce] = useState(0);
  const subTabs = subTabsFor(activeTab, features);
  const milestonesEnabled = isModuleEnabled("milestones", features);
  const raidEnabledForChanges = isModuleEnabled("raid", features);
  const stakeholdersEnabled = isModuleEnabled("stakeholders", features);

  // Panel wrappers. The pt-4 offset clears the tab strip in classic/popout mode;
  // in fullBleed the strip is hidden, so we drop it to align the per-view card
  // with the modern shell's inset edge (matching the Tasks pane exactly).
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
        <div
          role="tablist"
          aria-label="Workspace tabs"
          className={
            workspaceCollapsed
              ? "-mx-2 -mt-2 flex shrink-0 items-end gap-1 px-2"
              : "-mx-2 -mt-2 flex shrink-0 items-end gap-1 border-b border-line px-2"
          }
        >
          <TabButton
            active={activeTab === "chat"}
            onClick={() => {
              setActiveTab("chat");
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-chat"
            onPopout={() => openPopoutWindow("chat", settings.popout.reuseWindow)}
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
            onPopout={() => openPopoutWindow("reports", settings.popout.reuseWindow)}
            popoutLabel={t(lang, "popoutOpenInNewWindow")}
          >
            {t(lang, "tabReports")}
          </TabButton>
          {isModuleEnabled("gantt", features) && (
            <TabButton
              active={activeTab === "gantt"}
              onClick={() => {
                setActiveTab("gantt");
                if (workspaceCollapsed) setWorkspaceCollapsed(false);
              }}
              controls="panel-gantt"
              onPopout={() => openPopoutWindow("gantt", settings.popout.reuseWindow)}
              popoutLabel={t(lang, "popoutOpenInNewWindow")}
            >
              {t(lang, "tabGantt")}
            </TabButton>
          )}
          {isModuleEnabled("raid", features) && (
            <TabButton
              active={activeTab === "raid"}
              onClick={() => {
                setActiveTab("raid");
                handleClearRaidTaskFilter();
                if (workspaceCollapsed) setWorkspaceCollapsed(false);
              }}
              controls="panel-raid"
              onPopout={() => openPopoutWindow("raid", settings.popout.reuseWindow)}
              popoutLabel={t(lang, "popoutOpenInNewWindow")}
            >
              {t(lang, "tabRaid")}
            </TabButton>
          )}
          {isModuleEnabled("resources", features) && (
            <TabButton
              active={activeTab === "resources"}
              onClick={() => {
                setActiveTab("resources");
                if (workspaceCollapsed) setWorkspaceCollapsed(false);
              }}
              controls="panel-resources"
              onPopout={() => openPopoutWindow("resources", settings.popout.reuseWindow)}
              popoutLabel={t(lang, "popoutOpenInNewWindow")}
            >
              {t(lang, "tabResources")}
            </TabButton>
          )}
          {isModuleEnabled("budget", features) && (
            <TabButton
              active={activeTab === "budget"}
              onClick={() => {
                setActiveTab("budget");
                if (workspaceCollapsed) setWorkspaceCollapsed(false);
              }}
              controls="panel-budget"
              onPopout={() => openPopoutWindow("budget", settings.popout.reuseWindow)}
              popoutLabel={t(lang, "popoutOpenInNewWindow")}
            >
              {t(lang, "tabBudget")}
            </TabButton>
          )}
          <TabButton
            active={activeTab === "activity"}
            onClick={() => {
              setActiveTab("activity");
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-activity"
            onPopout={() => openPopoutWindow("activity", settings.popout.reuseWindow)}
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
              className="ml-auto mb-1 rounded-md border border-line bg-surface p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
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
                ? "ml-auto mb-1 rounded-md p-1.5 text-foreground hover:bg-surface-muted hover:text-AIPM-dark-blue"
                : "mb-1 rounded-md p-1.5 text-foreground hover:bg-surface-muted hover:text-AIPM-dark-blue"
            }
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
              className={`h-4 w-4 transition-transform ${workspaceCollapsed ? "rotate-180" : ""}`}
            >
              <path
                fillRule="evenodd"
                d="M14.78 12.78a.75.75 0 01-1.06 0L10 9.06l-3.72 3.72a.75.75 0 11-1.06-1.06l4.25-4.25a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      )}

      {!isPopout && !fullBleed && subTabs.length > 0 && (
        <div
          role="tablist"
          aria-label="Workspace sub-tabs"
          className="mb-2 flex flex-wrap items-center gap-1 border-b border-line pb-1"
        >
          {subTabs.map((child) => (
            <TabButton
              key={child.view}
              active={activeTab === child.view}
              onClick={() => {
                setActiveTab(child.view);
                if (workspaceCollapsed) setWorkspaceCollapsed(false);
              }}
              controls={`panel-${child.view}`}
            >
              {t(lang, navLabelKey(child.view))}
            </TabButton>
          ))}
        </div>
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
        <div
          id="panel-chat"
          role="tabpanel"
          hidden={activeTab !== "chat"}
          className={panelClass}
        >
          <ChatPanel
            lang={lang}
            ai={settings.ai}
            dispatcher={dispatcher}
            onAcceptConsent={handleAcceptAiConsent}
            guides={guides}
            guidesReady={guidesReady}
            chatSeed={pendingChatSeed}
            onChatSeedConsumed={clearChatSeed}
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
            <GanttPanel
              lang={lang}
              tasks={tasks}
              absences={absences}
              milestones={milestonesEnabled ? milestones : []}
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
            />
          </div>
        )}

        <div
          id="panel-raid"
          role="tabpanel"
          hidden={activeTab !== "raid"}
          className={panelClass}
        >
          <RaidPanel
            lang={lang}
            tasks={tasks}
            raid={raid}
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
            onCreateMitigationTask={handleCreateMitigationTaskFromRaid}
            onJumpToTask={handleJumpToTaskFromRaid}
          />
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
              onAssignRole={onAssignRole}
              onEditResource={onEditResource}
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
              onEditShift={handleOpenShiftEditor}
              roles={roles}
              plan={plan}
              workdayHours={settings.resources.workdayHours}
              onSetUtilization={onSetUtilization}
              onSetAllUtilizationMode={onSetAllUtilizationMode}
              onSetAbsenceOverride={onSetAbsenceOverride}
              onSetPlanWindow={onSetPlanWindow}
              onEditResource={onEditResource}
              onAddResource={onAddResource}
              onImportOutlookCalendar={onImportOutlookCalendar}
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

        {activeTab === "raid-report" && (
          <div id="panel-raid-report" role="tabpanel" className={panelScrollClass}>
            <RaidReportPanel lang={lang} items={raid} today={today} />
          </div>
        )}

        {activeTab === "changes" && (
          <div id="panel-changes" role="tabpanel" className={panelClass}>
            <ChangePanel
              lang={lang}
              tasks={tasks}
              raid={raidEnabledForChanges ? raid : []}
              changes={changes}
              today={today}
              onSave={handleSaveChange}
              onDelete={handleDeleteChange}
              raidEnabled={raidEnabledForChanges}
              stakeholdersEnabled={stakeholdersEnabled}
              stakeholders={stakeholders}
            />
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
              commsPendingStakeholderIds={commsPendingStakeholderIds}
              onJumpToComms={onJumpToComms}
            />
          </div>
        )}

        {activeTab === "raci" && (
          <div id="panel-raci" role="tabpanel" className={panelClass}>
            <RaciPanel
              lang={lang}
              stakeholders={stakeholders}
              milestones={milestones}
              onSave={handleSaveStakeholder}
            />
          </div>
        )}

        {activeTab === "stakeholder-map" && (
          <div id="panel-stakeholder-map" role="tabpanel" className={panelClass}>
            <StakeholderMapPanel
              lang={lang}
              stakeholders={stakeholders}
              onOpenStakeholder={isPopout ? undefined : (id) => requestOpen("stakeholders", id)}
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
              onChangeBuckets={onChangeBudgets}
              onRefreshFx={onRefreshFx}
              fxLoading={fxLoading}
            />
          </div>
        )}

        {activeTab === "budget-report" && (
          <div id="panel-budget-report" role="tabpanel" className={panelScrollClass}>
            <BudgetReportPanel
              lang={lang}
              buckets={budgets}
              plan={plan}
              roles={roles}
              resources={resources}
              absences={absences}
              holidaySet={holidaySet}
              workdayHours={settings.resources.workdayHours}
              fxRates={fxRates}
              tasks={tasks}
              today={today}
            />
          </div>
        )}

        {activeTab === "milestones" && (
          <div id="panel-milestones" role="tabpanel" className={panelScrollClass}>
            <MilestonesPanel
              lang={lang}
              today={today}
              holidaySet={holidaySet}
              logActivity={logActivity}
              openCreateNonce={milestoneCreateNonce}
              onCreateConsumed={() => setMilestoneCreateNonce(0)}
              onPushToOutlook={onPushMilestonesToOutlook}
              calendarPushBusy={calendarPushBusy}
            />
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
              onOpenRaid={() => {
                setActiveTab("raid");
                handleClearRaidTaskFilter();
                if (workspaceCollapsed) setWorkspaceCollapsed(false);
              }}
              onOpenTask={onEditTask ? (id) => {
                const task = tasks.find((t) => t.id === id);
                if (task) onEditTask(task);
              } : undefined}
              onOpenMilestone={() => setActiveTab("milestones")}
              showRaid={isModuleEnabled("raid", settings.features)}
              showBudget={isModuleEnabled("budget", settings.features)}
              showMilestones={isModuleEnabled("milestones", settings.features)}
              showChanges={isModuleEnabled("changes", settings.features)}
              showTrends={settings.dashboard?.showTrends !== false}
              onToggleTrends={(show) => setSettings((s) => ({ ...s, dashboard: { ...s.dashboard, showTrends: show } }))}
              variance={trends.variance}
              tursoActive={trends.active}
              topActions={nextActions.slice(0, 5)}
              onOpenAction={onOpenAction}
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
            />
          </div>
        )}

        {activeTab === "actions" && (
          <div id="panel-actions" role="tabpanel" className={panelClass}>
            <ActionsPanel lang={lang} actions={nextActions} onOpen={onOpenAction} onSnooze={onSnooze} onCreateTask={onCreateTask} onDraftMessage={onDraftMessage} assignOwner={assignOwner} escalate={escalate} rebaseline={rebaseline} learningEnabled={learningEnabled} expertMode={expertMode} onOpenLearningSettings={onOpenLearningSettings} aiAnalysis={aiAnalysis} />
          </div>
        )}

        {activeTab === "documents" && (
          <div id="panel-documents" role="tabpanel" className={panelClass}>
            <DocumentsPanel />
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
