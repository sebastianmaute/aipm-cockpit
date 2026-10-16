// The WorkspaceSection test harness: a full props object (every required pane-contract prop) and the
// providers the section reads. Shared by the section's test files so a new required prop is added once.
import type React from "react";
import { createRef } from "react";
import { vi } from "vitest";
import type { WorkspaceSectionProps } from "../app/workspace-section";
import { WorkspaceProvider } from "../app/workspace-context";
import { WorkspaceTabProvider } from "../app/workspace-tab-context";
import { FiltersProvider } from "../app/filters-context";
import { defaultSettings } from "../app/settings-types";
import type { ToolDispatcher } from "../app/chat-tools";
import type { ActivityEntry } from "../app/activity-log";
import type { Absence, Shift } from "../app/types";

export function makeProps(overrides: Partial<WorkspaceSectionProps> = {}): WorkspaceSectionProps {
  return {
    today: "2030-01-01",
    // Required on the pane contract, so a missed thread from task-manager is a
    // typecheck error rather than a silently badge-less register.
    documentsByEntity: new Map(),
    holidaySet: new Set<string>(),
    workspaceRef: createRef<HTMLElement | null>(),
    resetWorkspaceSize: vi.fn(),
    workspaceCollapsed: false,
    setWorkspaceCollapsed: vi.fn(),
    dispatcher: {} as ToolDispatcher,
    // §548/§596 — required on the pane contract for the same reason as the line
    // above: an optional scope reader that nobody threads is a silently
    // unguarded chat turn, not a visible failure.
    getScopeEpoch: () => 0,
    isSwapInFlight: () => false,
    handleGanttBarUpdate: vi.fn(),
    handleCancelEdit: vi.fn(),
    setTaskModalOpen: vi.fn(),
    contactsList: [],
    onCreateResource: vi.fn(() => 1),
    handleClearRaidTaskFilter: vi.fn(),
    handleClearChangeTaskFilter: vi.fn(),
    handleSaveRaidItem: vi.fn(),
    handleDeleteRaidItem: vi.fn(),
    changes: [],
    handleSaveChange: vi.fn(),
    handleDeleteChange: vi.fn(),
    handleChangeStatusChange: vi.fn(),
    stakeholders: [],
    handleSaveStakeholder: vi.fn(),
    handleDeleteStakeholder: vi.fn(),
    handleCreateMitigationTaskFromRaid: vi.fn() as (raidId: number) => number | null,
    handleJumpToTaskFromRaid: vi.fn(),
    onOpenNotes: vi.fn(),
    onOpenChangeNotes: vi.fn(),
    activityLog: [] as ActivityEntry[],
    logActivity: vi.fn(),
    logActivityChanges: vi.fn(),
    logActivityAs: vi.fn(),
    handleClearActivityLog: vi.fn(),
    handleOpenAddAbsence: vi.fn(),
    handleEditAbsence: vi.fn() as (absence: Absence) => void,
    handleOpenShiftEditor: vi.fn() as (existingShift: Shift | null, assignee: { display: string; email: string }) => void,
    onAssignRoleById: vi.fn(),
    onSetUtilization: vi.fn(),
    overAllocatedPct: 100,
    onReassignTask: vi.fn(),
    onRescheduleTask: vi.fn(),
    onSetAllUtilizationMode: vi.fn(),
    onSetAbsenceOverride: vi.fn(),
    onSetPlanWindow: vi.fn(),
    onSetBudgetFollowsPlan: vi.fn(),
    onEditResource: vi.fn(),
    onAddResource: vi.fn(),
    onChangeBudgets: vi.fn(),
    onRefreshFx: vi.fn(),
    mode: "file",
    projects: [],
    currentProjectId: null,
    projectStakeholderNames: [],
    projectAddressBook: [],
    projectResources: [],
    projectSettings: defaultSettings,
    onChangeProjectSettings: vi.fn(),
    onSwitchProject: vi.fn(),
    onCreateProject: vi.fn(),
    onUpdateCurrentProject: vi.fn(),
    onDeleteProject: vi.fn(),
    onExportCurrentProject: vi.fn(),
    onLoadProjectFromFile: vi.fn(),
    onMigrateProjectToTurso: vi.fn(),
    trends: {
      active: false,
      snapshots: [],
      baseline: null,
      latest: null,
      variance: [],
      gaps: [],
      busy: false,
      captureNow: vi.fn(async () => {}),
      rebaselineNow: vi.fn(async () => {}),
      setBaseline: vi.fn(async () => {}),
      deleteSnapshot: vi.fn(async () => {}),
      deleteSnapshots: vi.fn(async () => {}),
    },
    versionHistory: {
      versions: [],
      busy: false,
      // See the note in workspace-section.characterization.test.tsx: `true`
      // preserves the pre-`active` rendered output for an empty list.
      active: true,
      notifySaved: vi.fn(),
      captureNow: vi.fn(async () => {}),
      loadDiff: vi.fn().mockResolvedValue([]),
      restore: vi.fn(async () => true),
      remove: vi.fn(async () => true),
      refresh: vi.fn(async () => {}),
    },
    nextActions: [],
    nextActionGroups: [],
    onOpenAction: vi.fn(),
    ...overrides,
  };
}

export function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <WorkspaceTabProvider>{children}</WorkspaceTabProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}
