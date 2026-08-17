import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
import type React from "react";
import { WorkspaceProvider } from "./workspace-context";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";
import type { AppView } from "./nav-config";
import { FiltersProvider } from "./filters-context";
import { WorkspaceSection } from "./workspace-section";
import type { WorkspaceSectionProps } from "./workspace-section";
import { useSettings } from "./use-settings";
import { defaultSettings } from "./settings-types";
import { createRef } from "react";
import type { ToolDispatcher } from "./chat-tools";
import type { ActivityEntry } from "./activity-log";
import type { Absence, Shift } from "./types";
import { saveActualsCache } from "./timelog-actuals-store";
import type { FeatureModuleId } from "./feature-modules";

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
      // Required (non-optional) on the real `Settings` type — included here so
      // `workspace-section.tsx` can read `settings.storageConfig.kind` with no
      // `?.` guard, matching task-manager.tsx's `trendsActive` precedent. Kept
      // at "browser" (not "turso") so this ambient default stays a non-Turso
      // fixture, as every test relying on it implicitly assumes.
      storageConfig: { kind: "browser" as const },
      features: ["dashboard", "trends", "gantt", "milestones", "resources", "budget", "raid", "changes", "stakeholders"],
    },
    setSettings: vi.fn(),
    hydrated: true,
    i18nReady: true,
    lang: "en-US" as const,
  })),
}));

// Records the props it was handed so the Turso wiring below can be asserted
// end to end — mirrors the budgetPanelMock capture pattern below (`vi.hoisted`
// because `vi.mock` factories are hoisted above every const in this file).
const chatPanelMock = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock("./chat-panel", () => ({
  ChatPanel: (p: Record<string, unknown>) => {
    chatPanelMock.props.push(p);
    return <div data-testid="chat-panel" />;
  },
}));
vi.mock("./reports", () => ({ ReportsPanel: () => <div data-testid="reports-panel" /> }));
vi.mock("./gantt", () => ({ GanttPanel: () => <div data-testid="gantt-panel" /> }));
vi.mock("./raid-panel", () => ({ RaidPanel: () => <div data-testid="raid-panel" /> }));
vi.mock("./resources-panel", () => ({ ResourcesPanel: () => <div data-testid="resources-panel" /> }));
vi.mock("./activity-log-panel", () => ({ ActivityLogPanel: () => <div data-testid="activity-panel" /> }));
// Records the props it was handed so the Timelog-cache wiring below can be
// asserted end to end. `vi.hoisted` because `vi.mock` factories are hoisted
// above every const in this file — a bare module-level array is in its TDZ when
// the factory runs. Still renders the same stub div, so every other test that
// only looks for the testid is unaffected.
const budgetPanelMock = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock("./budget-panel", () => ({
  BudgetPanel: (p: Record<string, unknown>) => {
    budgetPanelMock.props.push(p);
    return <div data-testid="budget-panel" />;
  },
}));

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

describe("WorkspaceSection — documents tab routing", () => {
  // ★★ Navigation happens from a CLICK HANDLER, which is the only lint-legal
  // route here. Both obvious alternatives are fatal under CI's
  // --max-warnings=0: pushing the tab from a `useEffect` trips the banned
  // `react-hooks/set-state-in-effect`, and capturing the setter into an outer
  // variable during render trips `react-hooks/globals`
  // ("Cannot reassign variables declared outside of the component/hook").
  // Both were tried; this is what survives the gate.
  function TabProbe({ view }: { view: AppView }) {
    const { setActiveTab } = useWorkspaceTab();
    return <button data-testid="goto-tab" onClick={() => setActiveTab(view)} />;
  }

  function renderAtDocuments() {
    const view = render(
      <>
        <TabProbe view="documents" />
        <WorkspaceSection {...makeProps()} />
      </>,
      { wrapper: Wrapper },
    );
    fireEvent.click(screen.getByTestId("goto-tab"));
    return view;
  }

  it("routes the documents view to its own tabpanel", () => {
    // Without this nothing pins that `activeTab === "documents"` reaches a
    // branch at all — a typo in the string renders an EMPTY view, and the nav
    // entry, help entry and icon all still exist, so it looks wired.
    renderAtDocuments();
    const panel = document.getElementById("panel-documents");
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("role", "tabpanel");
  });

  it("does not render the documents tabpanel on another view", () => {
    // The control for the test above: if `panel-documents` were rendered
    // unconditionally, that assertion would pass with the routing broken.
    render(<WorkspaceSection {...makeProps()} />, { wrapper: Wrapper });
    expect(document.getElementById("panel-documents")).toBeNull();
  });
});

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

describe("WorkspaceSection — budget people-row actuals wiring", () => {
  function TabProbe({ view }: { view: AppView }) {
    const { setActiveTab } = useWorkspaceTab();
    return <button data-testid="goto-budget" onClick={() => setActiveTab(view)} />;
  }

  // ★★ `await`, not a synchronous read: `workspace-panels` loads BudgetPanel
  //    through `next/dynamic`, so the click renders the loading placeholder and
  //    the real panel arrives a microtask later. Read synchronously, the array
  //    is empty — and the resolution then lands during the NEXT test, whose
  //    assertion passes against the PREVIOUS test's props. That is how the first
  //    version of this file reported one failure and one false pass.
  const renderAtBudget = async () => {
    render(
      <>
        <TabProbe view="budget" />
        <WorkspaceSection {...makeProps()} />
      </>,
      { wrapper: Wrapper },
    );
    fireEvent.click(screen.getByTestId("goto-budget"));
    await screen.findByTestId("budget-panel");
    return budgetPanelMock.props.at(-1)!;
  };

  beforeEach(() => {
    budgetPanelMock.props.length = 0;
    localStorage.clear();
  });

  // ★★ The chain this pins: device cache → `loadActualsCache` → this prop →
  //    (budget-panel.test.tsx) a rendered number instead of "—". Without it the
  //    prop can be dropped and every other test still passes, because an absent
  //    breakdown is a LEGAL state that renders "—" everywhere — the failure mode
  //    is silently reporting "unknown", never an error.
  // ★ The key must be the SAME one TimelogPanel writes under
  //    (`currentProjectId ?? "default"`); a different fallback misses every entry.
  it("threads the cached per-resource breakdown into BudgetPanel", async () => {
    saveActualsCache("default", {
      fetchedAt: "2026-06-23T10:00:00Z",
      aggregates: {
        byBucket: { 7: { "2026-06": { hours: 6, billableHours: 6, byResource: { 5: { hours: 6, billableHours: 6 } } } } },
        byResource: {},
        unattributed: { hours: 0, billableHours: 0 },
      },
    });
    const props = await renderAtBudget();
    expect(props.actualsByBucket).toEqual({
      7: { "2026-06": { hours: 6, billableHours: 6, byResource: { 5: { hours: 6, billableHours: 6 } } } },
    });
  });

  it("passes an empty map — never undefined — when no fetch has been cached", async () => {
    // The control: with nothing seeded the assertion above would pass against a
    // hardcoded `{}`, so this pins that the empty case is the EMPTY one.
    expect((await renderAtBudget()).actualsByBucket).toEqual({});
  });
});

describe("WorkspaceSection — Turso config wiring into ChatPanel", () => {
  // Full `Settings`-shaped fixture (same minimal shape the module-disabled
  // test above builds) with Turso credentials configured under
  // `integrations.turso`, per the AGENTS.md "New Turso credentials live under
  // settings.integrations?.turso?.{databaseUrl,authToken}" convention already
  // followed by portfolio-health-panel.tsx / projects-panel.tsx.
  const tursoConfiguredSettings = {
    settings: {
      language: "en-US" as const,
      ai: { consentAccepted: false, apiKey: "", model: "claude-sonnet-4-6", groundInGuides: true },
      jira: { enabled: false, siteUrl: "", email: "", apiToken: "", projectKey: "", projectName: "", extraProjects: [], issueTypes: [], assigneeMode: "currentUser" as const, assigneeAccountId: "", assigneeDisplayName: "", tokenExpiresAt: "" },
      notifications: { reminderLeadDays: 7, useGlobalLeadDays: true, birthday: { enabled: false }, raidReview: { enabled: false }, raidReviewIntervalDays: 14, dueSoonWorkdays: 3, stakeholderComms: { enabled: false }, stakeholderCommsLeadDays: { "manage-closely": 14, "keep-satisfied": 7, "keep-informed": 7, monitor: 3 }, jiraTokenError: { enabled: false }, desktopUrgent: { enabled: false } },
      holidayCountries: [],
      resources: { workdayHours: 8 },
      popout: { reuseWindow: false },
      storageConfig: { kind: "turso" as const },
      layout: "modern" as const,
      features: ["dashboard", "trends", "gantt", "milestones", "resources", "budget", "raid", "changes", "stakeholders"] as FeatureModuleId[],
      integrations: {
        turso: { enabled: true, databaseUrl: "https://sample-org.turso.io", authToken: "sample-token" },
      },
    },
    setSettings: vi.fn(),
    hydrated: true,
    i18nReady: true,
    lang: "en-US" as const,
  };

  // Same valid Turso credentials, but `storageConfig.kind` is "browser" (not
  // "turso") — isolates the `mode` signal from the `storageConfig.kind`
  // signal now that the gate ORs the two (Finding 2 fix): a fixture that
  // leaves BOTH turso-ish would no longer prove `mode` is load-bearing on its
  // own, since `storageConfig.kind==="turso"` would keep tursoMode true
  // regardless of `mode`.
  const tursoConfiguredSettingsBrowserStorage = {
    ...tursoConfiguredSettings,
    settings: {
      ...tursoConfiguredSettings.settings,
      storageConfig: { kind: "browser" as const },
    },
  };

  // Same shape, but with NO Turso credentials configured — used for the "no
  // credentials" test and as this block's `beforeEach` baseline.
  const settingsWithoutTurso = {
    ...tursoConfiguredSettings,
    settings: {
      ...tursoConfiguredSettings.settings,
      storageConfig: { kind: "browser" as const },
      integrations: undefined,
    },
  };

  // The file's ACTUAL ambient default — matches the restore literal the
  // pre-existing "omits Gantt…" test (above) uses to undo its own
  // `mockReturnValue` override. This file has no global beforeEach/afterEach
  // mock reset, so `afterEach` below must restore to THIS shape, not to
  // `settingsWithoutTurso` (which this describe block also uses as a
  // deliberately-different, Turso-specific fixture) — otherwise a later test
  // relying on the suite's default (all-modules-enabled) mock would silently
  // observe the wrong settings under the shuffled-order job.
  const defaultUseSettingsReturn = {
    settings: {
      language: "en-US" as const,
      ai: { consentAccepted: false, apiKey: "", model: "claude-sonnet-4-6", groundInGuides: true },
      jira: { enabled: false, siteUrl: "", email: "", apiToken: "", projectKey: "", projectName: "", extraProjects: [], issueTypes: [], assigneeMode: "currentUser" as const, assigneeAccountId: "", assigneeDisplayName: "", tokenExpiresAt: "" },
      notifications: { reminderLeadDays: 7, useGlobalLeadDays: true, birthday: { enabled: false }, raidReview: { enabled: false }, raidReviewIntervalDays: 14, dueSoonWorkdays: 3, stakeholderComms: { enabled: false }, stakeholderCommsLeadDays: { "manage-closely": 14, "keep-satisfied": 7, "keep-informed": 7, monitor: 3 }, jiraTokenError: { enabled: false }, desktopUrgent: { enabled: false } },
      holidayCountries: [],
      resources: { workdayHours: 8 },
      popout: { reuseWindow: false },
      storageConfig: { kind: "browser" as const },
      layout: "modern" as const,
      features: ["dashboard", "trends", "gantt", "milestones", "resources", "budget", "raid", "changes", "stakeholders"] as FeatureModuleId[],
    },
    setSettings: vi.fn(),
    hydrated: true,
    i18nReady: true,
    lang: "en-US" as const,
  };

  beforeEach(() => {
    chatPanelMock.props.length = 0;
    vi.mocked(useSettings).mockReturnValue(settingsWithoutTurso);
  });

  afterEach(() => {
    vi.mocked(useSettings).mockReturnValue(defaultUseSettingsReturn);
  });

  it("mode=turso + configured Turso credentials: ChatPanel receives tursoMode true and a non-null tursoConfig", async () => {
    vi.mocked(useSettings).mockReturnValue(tursoConfiguredSettings);
    render(<WorkspaceSection {...makeProps({ mode: "turso" })} />, { wrapper: Wrapper });
    await screen.findByTestId("chat-panel");
    const props = chatPanelMock.props.at(-1)!;
    expect(props.tursoMode).toBe(true);
    expect(props.tursoConfig).not.toBeNull();
  });

  // ★ Pins that with valid Turso credentials but NEITHER OR-operand set to
  // "turso" (mode=file, storageConfig.kind=browser), tursoMode stays false —
  // i.e. `chatTursoConfig !== null` alone can't carry the gate open.
  // ★★ Mutation-measured, and this is NOT the test that pins the `mode`
  // disjunct: deleting `mode === "turso" ||` from the gate leaves THIS test
  // green, because both OR operands are already false here — the mutated and
  // real gates agree. The `mode` disjunct is pinned by the next test below,
  // which sets mode="turso" while keeping storageConfig.kind!=="turso" so
  // only the `mode` signal can carry the result.
  it("mode=file, storageConfig.kind!=='turso', with Turso credentials configured: ChatPanel receives tursoMode false", async () => {
    vi.mocked(useSettings).mockReturnValue(tursoConfiguredSettingsBrowserStorage);
    render(<WorkspaceSection {...makeProps({ mode: "file" })} />, { wrapper: Wrapper });
    await screen.findByTestId("chat-panel");
    const props = chatPanelMock.props.at(-1)!;
    expect(props.tursoMode).toBe(false);
  });

  // ★★★ THIS is the test that pins the `mode` disjunct. With valid Turso
  // credentials and `storageConfig.kind` NOT "turso" (isolating the storage
  // signal via `tursoConfiguredSettingsBrowserStorage`), setting `mode` alone
  // to "turso" must turn tursoMode ON. Deleting `mode === "turso" ||` from the
  // gate turns this test RED; the test above stays green under that same
  // mutation (see its comment) — the two together cover both directions.
  it("mode=turso, storageConfig.kind!=='turso', with Turso credentials configured: ChatPanel receives tursoMode true", async () => {
    vi.mocked(useSettings).mockReturnValue(tursoConfiguredSettingsBrowserStorage);
    render(<WorkspaceSection {...makeProps({ mode: "turso" })} />, { wrapper: Wrapper });
    await screen.findByTestId("chat-panel");
    const props = chatPanelMock.props.at(-1)!;
    expect(props.tursoMode).toBe(true);
  });

  // ★★★ The MIRROR of the test above, and the row this suite was missing: it
  // isolates the `storageConfig.kind` disjunct the way that one isolates
  // `mode`. `tursoConfiguredSettings` carries `storageConfig.kind === "turso"`,
  // so with `mode: "file"` only the STORAGE signal can carry the gate open.
  // Deleting `settings.storageConfig.kind === "turso" ||` turns this test RED
  // while the mode=turso test above stays green — the same two-direction
  // structure the `mode` pair has.
  // ★★ This is also the row that refutes "file mode is byte-identical to
  // before this branch": a single-DB Turso STORAGE user sitting on mode=file
  // DOES get the sidebar and multi-thread persistence. AGENTS.md said
  // otherwise until this test was written.
  it("mode=file, storageConfig.kind==='turso', with Turso credentials configured: ChatPanel receives tursoMode true", async () => {
    vi.mocked(useSettings).mockReturnValue(tursoConfiguredSettings);
    render(<WorkspaceSection {...makeProps({ mode: "file" })} />, { wrapper: Wrapper });
    await screen.findByTestId("chat-panel");
    const props = chatPanelMock.props.at(-1)!;
    expect(props.tursoMode).toBe(true);
    expect(props.tursoConfig).not.toBeNull();
  });

  it("mode=turso with NO Turso credentials configured: ChatPanel receives tursoMode false", async () => {
    // `settingsWithoutTurso` (set in beforeEach) has no `integrations.turso`,
    // so getTursoConfig resolves to null — pins the `chatTursoConfig !== null`
    // half of the gate independently of the `mode`/storageConfig half above.
    render(<WorkspaceSection {...makeProps({ mode: "turso" })} />, { wrapper: Wrapper });
    await screen.findByTestId("chat-panel");
    const props = chatPanelMock.props.at(-1)!;
    expect(props.tursoMode).toBe(false);
  });

  // Finding 2 regression guard: `storageConfig.kind === "turso"` (the
  // single-DB Turso storage backend) must ALSO turn chat persistence on, even
  // when `mode` (portfolio mode) is NOT "turso" — mirrors task-manager.tsx's
  // `trendsActive`, which ORs the same two signals. Before this fix the gate
  // read `mode === "turso" && chatTursoConfig !== null` only, so a
  // single-project Turso-storage user silently got no chat persistence.
  it("storageConfig.kind==='turso', mode NOT 'turso', with Turso credentials configured: ChatPanel receives tursoMode true", async () => {
    vi.mocked(useSettings).mockReturnValue(tursoConfiguredSettings);
    render(<WorkspaceSection {...makeProps({ mode: "file" })} />, { wrapper: Wrapper });
    await screen.findByTestId("chat-panel");
    const props = chatPanelMock.props.at(-1)!;
    expect(props.tursoMode).toBe(true);
  });

  // Finding 1 regression guard: `getTursoConfig` returns a fresh object
  // literal every call, so `chatTursoConfig` must be memoized on the
  // underlying credential strings — an unstable identity re-fires
  // useChatThreads' thread-fetch effect (tursoConfig sits in its dep array)
  // on every unrelated re-render, discarding the live conversation. Pins the
  // REFERENCE, not just the value (`toBe`, not `toEqual`).
  it("keeps the same tursoConfig object reference across a re-render when Turso credentials are unchanged", async () => {
    vi.mocked(useSettings).mockReturnValue(tursoConfiguredSettings);
    const { rerender } = render(<WorkspaceSection {...makeProps({ mode: "turso" })} />, { wrapper: Wrapper });
    await screen.findByTestId("chat-panel");
    const firstConfig = chatPanelMock.props.at(-1)!.tursoConfig;
    expect(firstConfig).not.toBeNull();

    // Force a re-render with the SAME settings mock (same credential
    // strings) — nothing about the Turso credentials changed.
    rerender(<WorkspaceSection {...makeProps({ mode: "turso" })} />);
    await screen.findByTestId("chat-panel");
    const secondConfig = chatPanelMock.props.at(-1)!.tursoConfig;

    expect(secondConfig).toBe(firstConfig);
  });

  it("creates a new tursoConfig object reference when the Turso credentials change", async () => {
    vi.mocked(useSettings).mockReturnValue(tursoConfiguredSettings);
    const { rerender } = render(<WorkspaceSection {...makeProps({ mode: "turso" })} />, { wrapper: Wrapper });
    await screen.findByTestId("chat-panel");
    const firstConfig = chatPanelMock.props.at(-1)!.tursoConfig;

    const changedCredentialsSettings = {
      ...tursoConfiguredSettings,
      settings: {
        ...tursoConfiguredSettings.settings,
        integrations: {
          turso: { enabled: true, databaseUrl: "https://different-org.turso.io", authToken: "different-token" },
        },
      },
    };
    vi.mocked(useSettings).mockReturnValue(changedCredentialsSettings);
    rerender(<WorkspaceSection {...makeProps({ mode: "turso" })} />);
    await screen.findByTestId("chat-panel");
    const secondConfig = chatPanelMock.props.at(-1)!.tursoConfig;

    expect(secondConfig).not.toBe(firstConfig);
  });
});
