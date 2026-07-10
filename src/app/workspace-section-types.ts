// Props contract for workspace-section.tsx (WorkspaceSection). Extracted so
// the component file stays focused on view routing.
import type React from "react";
import type {
  ToolDispatcher,
} from "./chat-tools";
import type {
  UseSnapshotsResult,
} from "./use-snapshots";
import type {
  UseVersionHistoryResult,
} from "./use-version-history";
import type {
  ActivityEntry,
  ActivityKind,
  FieldChange,
} from "./activity-log";
import type {
  Absence,
  BudgetBucket,
  ChangeItem,
  ProjectMeta,
  RaidItem,
  Resource,
  Shift,
  Stakeholder,
  Task,
} from "./types";
import type {
  NewProjectOpts,
} from "./new-project-workspace";
import type {
  Settings,
} from "./settings-types";
import type {
  ProjectRegistryEntry,
} from "./projects-registry";
import type {
  Contact,
} from "./contacts";
import type {
  SuggestedAction,
} from "./next-actions";
import type {
  AssignOwnerBundle,
} from "./action-row";
import type {
  EscalateBundle,
} from "./escalate-popover";
import type {
  RebaselineBundle,
} from "./rebaseline-popover";
import type {
  RescheduleBundle,
} from "./reschedule-popover";
import type {
  AiAnalysisBundle,
} from "./actions-panel";
import type {
  OperatingGuide,
} from "./operating-guide";
import type {
  SettingsSectionId,
} from "./dashboard-coaching";

/**
 * Consolidated two-way Outlook calendar controls for one entity (RAID / Change /
 * Absence). Replaces the former six entity-qualified flat props per entity. The
 * pane still consumes the flat `calendarEnabled`/`onToggleCalendar`/… interface;
 * workspace-section spreads this bag into it. Absent in popouts.
 */
export interface EntityCalendarProps {
  enabled?: boolean;
  onToggle?: (enabled: boolean) => void;
  onPush?: () => void;
  onPull?: () => void;
  pushBusy?: boolean;
  pullBusy?: boolean;
}

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
  // isNew carries the modal's create/edit intent (id-mint race fix — see
  // entity-id-mint.ts); non-modal callers (bulk edit) omit it.
  handleSaveRaidItem: (item: RaidItem, isNew?: boolean) => void;
  handleDeleteRaidItem: (id: number) => void;
  changes: readonly ChangeItem[];
  handleSaveChange: (item: ChangeItem, isNew?: boolean) => void;
  handleDeleteChange: (id: number, title: string) => void;
  /** Capture the selected changes' pre-edit images for undo before a bulk apply. */
  onCaptureChangeBulk?: (ids: readonly number[]) => void;
  stakeholders: readonly Stakeholder[];
  handleSaveStakeholder: (item: Stakeholder, isNew?: boolean) => void;
  handleDeleteStakeholder: (id: number, name: string) => void;
  /** Capture the selected stakeholders' pre-edit images for undo before a bulk apply. */
  onCaptureStakeholderBulk?: (ids: readonly number[]) => void;
  /** Stakeholder ids with a pending stakeholder-comms next-action (drives the matrix icon). */
  commsPendingStakeholderIds?: ReadonlySet<number>;
  /** Jump to the Action Center for the given stakeholder. */
  onJumpToComms?: (stakeholderId: number) => void;
  handleCreateMitigationTaskFromRaid: (raidId: number) => number | null | undefined;
  handleJumpToTaskFromRaid: (taskId: number) => void;
  activityLog: ActivityEntry[];
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  logActivityChanges: (
    kind: ActivityKind,
    changes: readonly FieldChange[],
    ...args: (string | number)[]
  ) => void;
  handleClearActivityLog: () => void;
  handleOpenAddAbsence: (seed?: Partial<Absence>) => void;
  handleEditAbsence: (absence: Absence) => void;
  handleOpenShiftEditor: (
    existingShift: Shift | null,
    assignee: { display: string; email: string },
  ) => void;
  manageRolesView?: React.ReactNode;
  onAssignRoleById: (resourceId: number, roleId: number | null) => void;
  onSetUtilization: (resourceId: number, periodKey: string, value: number) => void;
  /** Over-allocation threshold percent (the alert's `workloadAllocatedPct`). */
  overAllocatedPct: number;
  /** Workload overdue-task triage (#24): reassign to a resource / reschedule. */
  onReassignTask: (taskId: number, resource: Resource | null) => void;
  onRescheduleTask: (taskId: number, iso: string) => void;
  /** Clear an unlinked workload row (blank matching assignee/owner strings). Omitted in read-only popouts. */
  onClearUnlinked?: (row: { display: string; email: string; firstName: string; lastName: string }) => void;
  onSetAllUtilizationMode: (mode: "percent" | "hours") => void;
  onSetAbsenceOverride: (resourceId: number, periodKey: string, hours: number | null) => void;
  onSetPlanWindow: (startDate: string, endDate: string) => void;
  onEditResource: (resource: Resource) => void;
  /** Bulk-apply a patch to the selected resources (omitted in read-only popouts). */
  onBulkEditResources?: (ids: readonly number[], patch: Partial<Resource>) => void;
  /** Bulk-delete the selected resources (omitted in read-only popouts). */
  onBulkDeleteResources?: (ids: readonly number[]) => void;
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
  reschedule?: RescheduleBundle;
  onMarkDone?: (action: SuggestedAction) => void;
  onClearBlocker?: (action: SuggestedAction) => void;
  learningEnabled?: boolean;
  expertMode?: boolean;
  onOpenLearningSettings?: () => void;
  /** Deep-link the Dashboard to a specific Settings section (e.g. Settings → AI). */
  onOpenSettingsSection?: (id: SettingsSectionId) => void;
  /** SP4 themed tours: launch a tour by id (Help view); modern non-popout only. */
  onStartTour?: (id: string) => void;
  /** SP4: tours available under the current feature set. */
  catalogTours?: readonly import("./app-tour").TourCatalogEntry[];
  /** SP4: completed tour ids (for the ✓ badge). */
  completedTours?: readonly string[];
  aiAnalysis?: AiAnalysisBundle;
  onPushMilestonesToOutlook?: () => void;
  calendarPushBusy?: boolean;
  onPullMilestonesFromOutlook?: () => void;
  calendarPullBusy?: boolean;
  committeeOutlookPush?: { onPush: () => void; busy: boolean };
  /** M365 configured — gates the calendar toggle/button (hidden otherwise). */
  m365Configured?: boolean;
  /** RAID review-date two-way Outlook sync (SP2/SP3). Absent in popouts. */
  raidCalendar?: EntityCalendarProps;
  /** Change decision-date two-way Outlook sync (SP3). Absent in popouts. */
  changeCalendar?: EntityCalendarProps;
  /** Absence two-way Outlook sync (SP4). Absent in popouts. */
  absenceCalendar?: EntityCalendarProps;
  guides?: readonly OperatingGuide[];
  guidesReady?: boolean;
}
