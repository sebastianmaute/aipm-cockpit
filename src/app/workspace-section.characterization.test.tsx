// @characterization — pins the workspace-section view-routing contract BEFORE
// the Phase 3 split (moving ActionChips/ViewCallout/TzClock chrome out into
// workspace-section-chrome.tsx). Data-driven: it enumerates the rendered primary
// tabs and asserts each one routes to a visible tabpanel — so if the split drops
// a view's route, the tab's panel stops appearing and this fails. MAY be updated
// freely during Phase 3; NOT a golden fixture.
//
// Harness (makeProps + Wrapper + heavy-panel mocks) is intentionally a trimmed,
// self-contained copy of workspace-section.test.tsx's — this file is throwaway
// (replaced by focused tests once the split lands), so it avoids coupling to that
// suite's helpers.
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type React from "react";
import { createRef } from "react";
import { WorkspaceProvider } from "./workspace-context";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { FiltersProvider } from "./filters-context";
import { WorkspaceSection } from "./workspace-section";
import type { WorkspaceSectionProps } from "./workspace-section";
import { defaultSettings } from "./settings-types";
import type { ToolDispatcher } from "./chat-tools";
import type { ActivityEntry } from "./activity-log";
import type { Absence, Shift } from "./types";

vi.mock("./use-settings", () => ({
  useSettings: vi.fn(() => ({
    settings: {
      lang: "en-US",
      ai: { consentAccepted: false, provider: "none" },
      jira: { enabled: false, siteUrl: "", email: "", apiToken: "", projectKey: "", issueTypes: [] },
      notifications: { reminderLeadDays: 7, banner: { enabled: false }, popup: { enabled: false } },
      holidayCountries: [],
      resources: { workdayHours: 8 },
      popout: { reuseWindow: false },
      // `storageConfig` is REQUIRED on Settings (`settings-types.ts` declares
      // it non-optional), and workspace-section reads `settings.storageConfig
      // .kind` unguarded — mirroring task-manager's `trendsActive`, which ORs
      // the same two signals and is also unguarded. Omitting it here left this
      // as the only settings mock that RENDERS WorkspaceSection without the
      // field, so dropping the source's defensive `?.` crashed this file.
      // ★ Not "the only mock missing the field", which is what this comment
      // said first: 12 of the 14 `vi.mock("./use-settings")` files still omit
      // it. None of the 12 render this component, so none are affected — the
      // narrower claim is the true one. Re-derive both numbers rather than
      // trusting them: `grep -rl 'vi.mock("./use-settings")' src/app` for the
      // population, `grep -L storageConfig` over that list for the omitters.
      storageConfig: { kind: "browser" as const },
      features: ["dashboard", "trends", "gantt", "milestones", "resources", "budget", "raid", "changes", "stakeholders"],
    },
    setSettings: vi.fn(),
    hydrated: true,
    i18nReady: true,
    lang: "en-US" as const,
  })),
}));

vi.mock("./chat-panel", () => ({ ChatPanel: () => <div data-testid="chat-panel" /> }));
vi.mock("./reports", () => ({ ReportsPanel: () => <div data-testid="reports-panel" /> }));
vi.mock("./gantt", () => ({ GanttPanel: () => <div data-testid="gantt-panel" /> }));
vi.mock("./raid-panel", () => ({ RaidPanel: () => <div data-testid="raid-panel" /> }));
vi.mock("./resources-panel", () => ({ ResourcesPanel: () => <div data-testid="resources-panel" /> }));
vi.mock("./activity-log-panel", () => ({ ActivityLogPanel: () => <div data-testid="activity-panel" /> }));
vi.mock("./budget-panel", () => ({ BudgetPanel: () => <div data-testid="budget-panel" /> }));

function makeProps(overrides: Partial<WorkspaceSectionProps> = {}): WorkspaceSectionProps {
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
    handleGanttBarUpdate: vi.fn(),
    handleCancelEdit: vi.fn(),
    setTaskModalOpen: vi.fn(),
    contactsList: [],
    onCreateResource: vi.fn(() => 1),
    handleClearRaidTaskFilter: vi.fn(),
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
      notifySaved: vi.fn(),
      captureNow: vi.fn(async () => {}),
      loadDiff: vi.fn().mockResolvedValue([]),
      restore: vi.fn(async () => true),
      remove: vi.fn(async () => true),
      refresh: vi.fn(async () => {}),
    },
    nextActions: [],
    onOpenAction: vi.fn(),
    ...overrides,
  };
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <WorkspaceTabProvider>{children}</WorkspaceTabProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}

describe("@characterization workspace-section routing", () => {
  it("renders a non-trivial primary tablist (a total routing break would empty it)", () => {
    render(<WorkspaceSection {...makeProps()} />, { wrapper: Wrapper });
    const tablist = screen.getByRole("tablist", { name: "Workspace tabs" });
    const tabs = within(tablist).getAllByRole("tab");
    // 7 primary tabs render for the seeded feature set; floor at 6 catches a
    // total routing collapse without being brittle to minor nav churn.
    expect(tabs.length).toBeGreaterThanOrEqual(6);
  });

  it("every primary tab routes to a tabpanel that becomes visible when selected", () => {
    render(<WorkspaceSection {...makeProps()} />, { wrapper: Wrapper });
    const tablist = screen.getByRole("tablist", { name: "Workspace tabs" });
    const tabs = within(tablist).getAllByRole("tab");

    for (const tab of tabs) {
      const targetId = tab.getAttribute("aria-controls");
      expect(targetId, "each primary tab must control a panel").toBeTruthy();
      fireEvent.click(tab);
      const panel = document.getElementById(targetId!);
      expect(panel, `routing dropped: no #${targetId} for tab "${tab.textContent}"`).not.toBeNull();
      // The active view's panel must NOT carry the hidden attribute (it routed here).
      expect(panel, `tab "${tab.textContent}" did not route its panel visible`).not.toHaveAttribute("hidden");
    }
  });
});
