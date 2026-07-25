import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, test, vi } from "vitest";
import type React from "react";
import { WorkspaceProvider } from "./workspace-context";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { FiltersProvider } from "./filters-context";
import { WorkspaceSection } from "./workspace-section";
import type { WorkspaceSectionProps } from "./workspace-section";
import { useSettings } from "./use-settings";
import { defaultSettings } from "./settings-types";
import { createRef } from "react";
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
    stakeholders: [],
    handleSaveStakeholder: vi.fn(),
    handleDeleteStakeholder: vi.fn(),
    handleCreateMitigationTaskFromRaid: vi.fn() as (raidId: number) => number | null,
    handleJumpToTaskFromRaid: vi.fn(),
    onOpenNotes: vi.fn(),
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

describe("WorkspaceSection", () => {
  it("section element renders in the DOM", () => {
    render(<WorkspaceSection {...makeProps()} />, { wrapper: Wrapper });
    expect(document.querySelector("section")).toBeInTheDocument();
  });

  it("chat panel is hidden by default (Dashboard is the default view)", () => {
    render(<WorkspaceSection {...makeProps()} />, { wrapper: Wrapper });
    const panelChat = document.getElementById("panel-chat");
    expect(panelChat).not.toBeNull();
    expect(panelChat).toHaveAttribute("hidden");
  });

  it("raid panel has hidden attr when activeTab is 'chat'", () => {
    render(<WorkspaceSection {...makeProps()} />, { wrapper: Wrapper });
    const panelRaid = document.getElementById("panel-raid");
    expect(panelRaid).not.toBeNull();
    expect(panelRaid).toHaveAttribute("hidden");
  });

  it("renders the Budget tab button", () => {
    render(<WorkspaceSection {...makeProps()} />, { wrapper: Wrapper });
    expect(screen.getByRole("tab", { name: /Budget/i })).toBeInTheDocument();
  });

  it("clicking RAID tab invokes handleClearRaidTaskFilter", () => {
    const handleClearRaidTaskFilter = vi.fn();
    render(<WorkspaceSection {...makeProps({ handleClearRaidTaskFilter })} />, { wrapper: Wrapper });
    const raidTabBtn = document.querySelector('[aria-controls="panel-raid"]') as HTMLElement | null;
    expect(raidTabBtn).not.toBeNull();
    fireEvent.click(raidTabBtn!);
    expect(handleClearRaidTaskFilter).toHaveBeenCalledTimes(1);
  });

  it("hides the tab strip in fullBleed mode", () => {
    render(<WorkspaceSection {...makeProps({ fullBleed: true })} />, { wrapper: Wrapper });
    expect(screen.queryByRole("tablist", { name: "Workspace tabs" })).toBeNull();
    expect(document.getElementById("workspace-panels")).not.toHaveAttribute("hidden");
  });

  it("fills the viewport in fullBleed mode (h-full, not collapsing flex-1)", () => {
    // Under the modern shell's block <main>, flex-1 is a no-op and the section
    // collapses to content height. h-full makes it fill, matching the Tasks pane.
    const { container } = render(<WorkspaceSection {...makeProps({ fullBleed: true })} />, {
      wrapper: Wrapper,
    });
    const section = container.querySelector("section");
    expect(section?.className).toContain("h-full");
    expect(section?.className).not.toContain("flex-1");
  });

  it("drops the pt-4 panel offset in fullBleed mode", () => {
    render(<WorkspaceSection {...makeProps({ fullBleed: true })} />, { wrapper: Wrapper });
    const panelChat = document.getElementById("panel-chat");
    expect(panelChat?.className).not.toContain("pt-4");
  });

  it("keeps the pt-4 panel offset in classic mode (clears the tab strip)", () => {
    render(<WorkspaceSection {...makeProps()} />, { wrapper: Wrapper });
    const panelChat = document.getElementById("panel-chat");
    expect(panelChat?.className).toContain("pt-4");
  });

  test("resources view renders the resource report; manage-roles renders the slot; no address-book/resource-report panels", () => {
    const src = readFileSync(join(__dirname, "workspace-section.tsx"), "utf8");
    expect(src).toMatch(/ResourcesReportPanel/);
    expect(src).toMatch(/manageRolesView/);
    expect(src).not.toMatch(/panel-address-book/);
    expect(src).not.toMatch(/panel-resource-report/);
  });

  test("classic: a secondary sub-tab row appears for Resources and navigates to a sub-view", () => {
    // Classic mode: non-popout, fullBleed=false (defaults) → primary tablist renders
    render(<WorkspaceSection {...makeProps()} />, { wrapper: Wrapper });

    // The default view (Dashboard) shows ITS OWN sub-tabs (Next actions / Trends),
    // so a sub-tab row may exist — but Resources' sub-tabs (Directory / Manage
    // roles) must not appear until Resources is the active parent.
    expect(screen.queryByRole("tab", { name: /directory/i })).toBeNull();

    // Click the primary Resources tab to activate it
    fireEvent.click(screen.getByRole("tab", { name: /resources/i }));

    // The secondary sub-tab row should now be visible
    const subRow = screen.getByRole("tablist", { name: /sub-tabs/i });

    // Directory and Manage roles are sub-tabs under Resources
    expect(within(subRow).getByRole("tab", { name: /directory/i })).toBeInTheDocument();
    expect(within(subRow).getByRole("tab", { name: /manage roles/i })).toBeInTheDocument();

    // Clicking Directory navigates to the directory panel
    fireEvent.click(within(subRow).getByRole("tab", { name: /directory/i }));
    expect(document.getElementById("panel-directory")).toBeTruthy();
  });

  it("omits Gantt (and RAID/Resources/Budget) tab buttons when those modules are disabled", () => {
    // Not *Once*: WorkspaceProvider (workspace-context.tsx) now also calls
    // useSettings() to apply the hideExternalTasks filter, and it renders
    // before WorkspaceSection — a one-shot stub would be consumed there and
    // WorkspaceSection would fall through to the suite's default (all
    // modules enabled) mock. Every consumer in the tree must see this
    // module-disabled config.
    vi.mocked(useSettings).mockReturnValue({
      settings: {
        language: "en-US",
        ai: { consentAccepted: false, apiKey: "", model: "claude-sonnet-4-6", groundInGuides: true },
        jira: { enabled: false, siteUrl: "", email: "", apiToken: "", projectKey: "", projectName: "", extraProjects: [], issueTypes: [], assigneeMode: "currentUser", assigneeAccountId: "", assigneeDisplayName: "", tokenExpiresAt: "" },
        notifications: { reminderLeadDays: 7, useGlobalLeadDays: true, birthday: { enabled: false }, raidReview: { enabled: false }, raidReviewIntervalDays: 14, dueSoonWorkdays: 3, stakeholderComms: { enabled: false }, stakeholderCommsLeadDays: { "manage-closely": 14, "keep-satisfied": 7, "keep-informed": 7, monitor: 3 }, jiraTokenError: { enabled: false }, desktopUrgent: { enabled: false } },
        holidayCountries: [],
        resources: { workdayHours: 8 },
        popout: { reuseWindow: false },
        storageConfig: { kind: "browser" as const },
        layout: "modern" as const,
        // Only chat/reports/activity remain; all gated modules disabled
        features: [],
      },
      setSettings: vi.fn(),
      hydrated: true,
      i18nReady: true,
      lang: "en-US" as const,
    });

    render(<WorkspaceSection {...makeProps()} />, { wrapper: Wrapper });

    // Ungated tabs always present
    expect(screen.getByRole("tab", { name: /AI Assistant/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /reports/i })).toBeInTheDocument();

    // Module-gated tabs must be absent
    expect(screen.queryByRole("tab", { name: /^gantt$/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /^raid$/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /^resources$/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /^budget$/i })).toBeNull();

    // This file has no beforeEach/afterEach mock reset, so a non-Once stub
    // would otherwise leak into any test appended after this one. Restore
    // the suite's default (all-modules-enabled) mock explicitly. Uses the
    // same full settings shape as above (required by mockReturnValue's
    // type check against the real useSettings return type), with the
    // module list flipped back to "everything enabled".
    vi.mocked(useSettings).mockReturnValue({
      settings: {
        language: "en-US",
        ai: { consentAccepted: false, apiKey: "", model: "claude-sonnet-4-6", groundInGuides: true },
        jira: { enabled: false, siteUrl: "", email: "", apiToken: "", projectKey: "", projectName: "", extraProjects: [], issueTypes: [], assigneeMode: "currentUser", assigneeAccountId: "", assigneeDisplayName: "", tokenExpiresAt: "" },
        notifications: { reminderLeadDays: 7, useGlobalLeadDays: true, birthday: { enabled: false }, raidReview: { enabled: false }, raidReviewIntervalDays: 14, dueSoonWorkdays: 3, stakeholderComms: { enabled: false }, stakeholderCommsLeadDays: { "manage-closely": 14, "keep-satisfied": 7, "keep-informed": 7, monitor: 3 }, jiraTokenError: { enabled: false }, desktopUrgent: { enabled: false } },
        holidayCountries: [],
        resources: { workdayHours: 8 },
        popout: { reuseWindow: false },
        storageConfig: { kind: "browser" as const },
        layout: "modern" as const,
        features: ["dashboard", "trends", "gantt", "milestones", "resources", "budget", "raid", "changes", "stakeholders"],
      },
      setSettings: vi.fn(),
      hydrated: true,
      i18nReady: true,
      lang: "en-US" as const,
    });
  });
});
