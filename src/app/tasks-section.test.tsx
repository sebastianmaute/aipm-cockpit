import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { t } from "./i18n";
import { getAppearanceSnapshot, saveProjectAppearance } from "./project-appearance-prefs";
import { expectButtonOrder } from "../test/toolbar-order";

vi.mock("./workspace-context", () => ({ useWorkspace: vi.fn() }));
vi.mock("./filters-context", () => ({ useFilters: vi.fn() }));
vi.mock("./task-form-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./task-form-context")>();
  return { ...actual, useTaskForm: vi.fn() };
});
// Captures the `value` prop RowContextProvider is rendered with, so tests can
// invoke row-context callbacks (e.g. onInlinePatch) directly — TaskRow itself
// is stubbed out below (renders no interactive cells), so this is the closest
// reliable seam for driving an inline cell edit without a brittle DOM path.
const { capturedRowContext } = vi.hoisted(() => ({
  capturedRowContext: { current: null as unknown },
}));
vi.mock("./task-row", () => ({
  RowContextProvider: (
    { children, value }: { children: React.ReactNode; value: unknown },
  ) => {
    capturedRowContext.current = value;
    return <>{children}</>;
  },
  TaskRow: ({ task }: { task: { id: number; taskName: string } }) => (
    <tr data-deeplink-row={task.id}><td>{task.taskName}</td></tr>
  ),
}));
vi.mock("./use-settings", () => ({ useSettings: vi.fn() }));
vi.mock("./use-holiday-set", () => ({ useHolidaySet: vi.fn() }));
vi.mock("./use-deeplink-row-flash", () => ({
  useDeepLinkRowFlash: () => ({ flashId: null, containerRef: { current: null } }),
  flashOutlineClass: () => "",
}));
const { pullSpy } = vi.hoisted(() => ({ pullSpy: vi.fn() }));
vi.mock("./use-entity-calendar-pull", () => ({
  useEntityCalendarPull: () => ({
    pull: pullSpy,
    busy: false,
    result: null,
    clearResult: vi.fn(),
    keepApp: vi.fn(),
    applyMove: vi.fn(),
  }),
}));
// Inline "Ask Claude" task edit (SP1): stub the hook out entirely so this
// suite stays focused on the pane's own rendering/behavior; the hook itself
// is covered by use-inline-ai-edit.test.ts.
vi.mock("./use-inline-ai-edit", () => ({
  useInlineAiEdit: () => ({
    activeTask: null,
    phase: "idle",
    plan: null,
    clarifyText: "",
    errorText: "",
    aiEditEnabled: () => false,
    openFor: vi.fn(),
    submit: vi.fn(),
    apply: vi.fn(),
    cancel: vi.fn(),
  }),
}));

import { useWorkspace } from "./workspace-context";
import { useFilters } from "./filters-context";
import { useTaskForm, emptyForm, emptyBulkEdit } from "./task-form-context";
import { useSettings } from "./use-settings";
import type { Settings } from "./settings-types";
import type { ToolDispatcher } from "./chat-tools";
import { useHolidaySet } from "./use-holiday-set";
import { TasksSection, CONFIGURABLE_COLS, type TasksSectionProps } from "./tasks-section";
import { TASK_STATUSES } from "./types";
import { DEFAULT_COL_WIDTHS } from "./tasks-section-columns";
import { GUTTER_WIDTH_PX, visibleTaskCols } from "./open-points-table-geometry";

const mockUseWorkspace = useWorkspace as ReturnType<typeof vi.fn>;
const mockUseFilters = useFilters as ReturnType<typeof vi.fn>;
const mockUseTaskForm = useTaskForm as ReturnType<typeof vi.fn>;
const mockUseSettings = useSettings as ReturnType<typeof vi.fn>;
const mockUseHolidaySet = useHolidaySet as ReturnType<typeof vi.fn>;

function stubFilters(over: Record<string, unknown> = {}) {
  mockUseFilters.mockReturnValue({
    search: "", setSearch: vi.fn(),
    searchDebounced: "",
    setSearchImmediate: vi.fn(),
    priorityFilter: "All", setPriorityFilter: vi.fn(),
    assigneeFilter: "All", setAssigneeFilter: vi.fn(),
    groupFilter: "All", setGroupFilter: vi.fn(),
    labelFilter: "All", setLabelFilter: vi.fn(),
    healthFilter: "all", setHealthFilter: vi.fn(),
    sortKey: "taskName", sortDir: "asc",
    setSortKey: vi.fn(), setSortDir: vi.fn(),
    raidFilterTaskId: null, setRaidFilterTaskId: vi.fn(),
    resetFilters: vi.fn(),
    ...over,
  });
}

function stubTaskForm() {
  mockUseTaskForm.mockReturnValue({
    form: emptyForm(), setForm: vi.fn(),
    editingId: null, setEditingId: vi.fn(),
    taskModalOpen: false, setTaskModalOpen: vi.fn(),
    bulkEdit: emptyBulkEdit(), setBulkEdit: vi.fn(),
    bulkEditOpen: false, setBulkEditOpen: vi.fn(),
  });
}

function stubWorkspace(
  tasks: unknown[],
  filteredSortedTasks: unknown[],
  resources: unknown[] = [],
) {
  mockUseWorkspace.mockReturnValue({
    tasks,
    setTasks: vi.fn(),
    filteredSortedTasks,
    uniqueAssignees: [],
    uniqueGroups: [],
    uniqueLabels: [],
    // The filter <select>s render the effective (orphan-resolved) values, not
    // the raw ones — see task-filters.ts.
    effectiveFilters: { assignee: "All", group: "All", label: "All" },
    tasksById: new Map(),
    taskSearchIndex: new Map(),
    resources,
    raid: [], setRaid: vi.fn(),
    absences: [], setAbsences: vi.fn(),
    shifts: [], setShifts: vi.fn(),
  });
}

function stubSettings(overrides: Record<string, unknown> = {}) {
  mockUseSettings.mockReturnValue({
    settings: {
      holidayCountries: [],
      jira: { siteUrl: "", enabled: false, projectKey: "", issueTypes: [] },
      notifications: {
        reminderLeadDays: 7,
        banner: { enabled: false },
        popup: { enabled: false },
      },
      ai: { consentAccepted: false },
      lang: "en-US",
      popout: { reuseWindow: false },
      hideFinishedTasks: false,
      ...overrides,
    },
    setSettings: vi.fn(),
    hydrated: true,
    i18nReady: true,
    lang: "en-US",
  });
}

function stubHolidaySet() {
  mockUseHolidaySet.mockReturnValue({ holidaySet: new Set<string>() });
}

function makeProps(): TasksSectionProps {
  return {
    lang: "en-US",
    today: "2026-05-22",
    // row context data + callbacks (replaced rowContextValue prop)
    jiraSiteUrl: "",
    jiraExtraProjects: [],
    onToggleSelect: vi.fn(),
    onOpenNotes: vi.fn(),
    onJumpToRaid: vi.fn(),
    onSendInquiry: vi.fn(),
    onPushToJira: vi.fn(),
    onStatusChange: vi.fn(),
    onSwimlaneDrop: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    // column manager
    hiddenCols: new Set(),
    setHiddenCols: vi.fn(),
    sizedWidths: {},
    colConfigOpen: false,
    setColConfigOpen: vi.fn(),
    colConfigRef: React.createRef<HTMLDivElement>(),
    startColResize: vi.fn(),
    resetColWidths: vi.fn(),
    // resizable table
    tableRef: React.createRef<HTMLElement>(),
    resetTableSize: vi.fn(),
    // row state
    pushingIds: new Set(),
    raidByTask: new Map(),
    changeByTask: new Map(),
    // jira
    jiraEnabled: false,
    jiraSyncing: false,
    jiraProjectKey: "",
    handleJiraSync: vi.fn(),
    // task actions
    handleCancelEdit: vi.fn(),
    setTaskModalOpen: vi.fn(),
    handleClearAll: vi.fn(),
    // bulk operations
    selectedIds: new Set(),
    allVisibleSelected: false,
    selectedJiraCount: 0,
    toggleSelectAllVisible: vi.fn(),
    clearSelection: vi.fn(),
    handleBulkSendInquiry: vi.fn(),
    handleBulkDelete: vi.fn(),
    applyBulkEdit: vi.fn(),
    cancelBulkEdit: vi.fn(),
    // Inline "Ask Claude" task edit (SP1)
    dispatcher: { getSnapshot: () => ({}) } as unknown as ToolDispatcher,
  };
}

describe("TasksSection", () => {
  beforeEach(() => {
    stubFilters();
    stubTaskForm();
    stubSettings();
    stubHolidaySet();
    pullSpy.mockClear();
  });

  it("renders 'no tasks' placeholder when tasks list is empty", () => {
    stubWorkspace([], []);
    render(<TasksSection {...makeProps()} />);
    expect(screen.getByText(t("en-US", "noTasks"))).toBeInTheDocument();
  });

  it("renders 'no tasks filtered' placeholder when tasks exist but filter yields empty", () => {
    stubWorkspace([{ id: 1, taskName: "T1" }], []);
    render(<TasksSection {...makeProps()} />);
    expect(screen.getByText(t("en-US", "noTasksFiltered"))).toBeInTheDocument();
  });

  it("renders table when both tasks and filtered list are non-empty", () => {
    const task = { id: 1, taskName: "T1" };
    stubWorkspace([task], [task]);
    const { container } = render(<TasksSection {...makeProps()} />);
    expect(container.querySelector("table")).toBeInTheDocument();
  });

  // The filter <select>s must read the workspace's ORPHAN-RESOLVED value, not
  // the raw one from useFilters, or reassigning the last task away from a
  // filtered assignee leaves the applied filter hiding every row while the
  // control no longer names it.
  //
  // The two sources are stubbed APART on purpose: with a genuinely orphaned
  // value the <option> is gone, the select falls back to its first option, and
  // the DOM value reads "All" whichever source it is bound to — so the realistic
  // setup cannot tell a correct binding from a reverted one. Keeping the stale
  // values as real options makes the bindings observably different.
  it("renders the orphan-resolved filter value, not the raw one", () => {
    mockUseFilters.mockReturnValue({
      search: "", setSearch: vi.fn(),
      searchDebounced: "",
      setSearchImmediate: vi.fn(),
      priorityFilter: "All", setPriorityFilter: vi.fn(),
      assigneeFilter: "Alice", setAssigneeFilter: vi.fn(),
      groupFilter: "G1", setGroupFilter: vi.fn(),
      labelFilter: "frontend", setLabelFilter: vi.fn(),
      healthFilter: "all", setHealthFilter: vi.fn(),
      sortKey: "taskName", sortDir: "asc",
      setSortKey: vi.fn(), setSortDir: vi.fn(),
      raidFilterTaskId: null, setRaidFilterTaskId: vi.fn(),
      resetFilters: vi.fn(),
    });
    const task = { id: 1, taskName: "T1" };
    mockUseWorkspace.mockReturnValue({
      tasks: [task],
      setTasks: vi.fn(),
      filteredSortedTasks: [task],
      uniqueAssignees: ["Alice"],
      uniqueGroups: ["G1"],
      uniqueLabels: ["frontend"],
      effectiveFilters: { assignee: "All", group: "All", label: "All" },
      tasksById: new Map(),
      taskSearchIndex: new Map(),
      resources: [],
      raid: [], setRaid: vi.fn(),
      absences: [], setAbsences: vi.fn(),
      shifts: [], setShifts: vi.fn(),
    });
    render(<TasksSection {...makeProps()} />);

    expect(screen.getByTitle(t("en-US", "assigneeFilterHint"))).toHaveValue("All");
    expect(screen.getByTitle(t("en-US", "tasksGroupFilterHint"))).toHaveValue("All");
    expect(screen.getByTitle(t("en-US", "tasksLabelFilterHint"))).toHaveValue("All");
  });

  // uniqueAssignees keeps blanks (unlike uniqueGroups), so an unassigned task
  // puts a real but EMPTY <option> in the filter — a nameless line the user
  // cannot interpret. Clearing a row's assignee now reaches that state in one
  // click via the picker's ✕, so the option has to say what it selects.
  it("labels the blank assignee option instead of rendering an empty line", () => {
    const task = { id: 1, taskName: "T1" };
    mockUseWorkspace.mockReturnValue({
      tasks: [task],
      setTasks: vi.fn(),
      filteredSortedTasks: [task],
      uniqueAssignees: ["", "Bob"],
      uniqueGroups: [],
      uniqueLabels: [],
      effectiveFilters: { assignee: "All", group: "All", label: "All" },
      tasksById: new Map(),
      taskSearchIndex: new Map(),
      resources: [],
      raid: [], setRaid: vi.fn(),
      absences: [], setAbsences: vi.fn(),
      shifts: [], setShifts: vi.fn(),
    });
    render(<TasksSection {...makeProps()} />);

    const select = screen.getByTitle(t("en-US", "assigneeFilterHint"));
    const labels = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(labels).not.toContain(""); // no nameless option
    expect(labels).toContain(t("en-US", "assigneeNone"));
  });

  it("clear-all opens a type-to-confirm dialog instead of clearing immediately", () => {
    const task = { id: 1, taskName: "T1" };
    stubWorkspace([task], [task]);
    const props = makeProps();
    render(<TasksSection {...props} />);

    // Clicking the eraser opens the dialog; nothing is cleared yet.
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "clearAll") }));
    expect(screen.getByText(t("en-US", "tasksClearDialogTitle"))).toBeInTheDocument();
    expect(props.handleClearAll).not.toHaveBeenCalled();

    // Confirm stays disabled until the exact phrase is typed.
    const confirm = screen.getByRole("button", { name: t("en-US", "tasksClearConfirmLabel") });
    expect(confirm).toBeDisabled();

    fireEvent.change(
      screen.getByLabelText(t("en-US", "typeToConfirmPrompt", "yes, clear all tasks")),
      { target: { value: "yes, clear all tasks" } },
    );
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(props.handleClearAll).toHaveBeenCalledTimes(1);
  });

  it("opens the clear-all dialog from a pending voice request nonce, then consumes it", () => {
    const task = { id: 1, taskName: "T1" };
    stubWorkspace([task], [task]);
    const onClearAllRequestConsumed = vi.fn();
    render(
      <TasksSection
        {...makeProps()}
        clearAllRequestNonce={1}
        onClearAllRequestConsumed={onClearAllRequestConsumed}
      />,
    );
    // The dialog opens from the request nonce alone — no eraser click.
    expect(screen.getByText(t("en-US", "tasksClearDialogTitle"))).toBeInTheDocument();
    // The request is consumed so a later remount can't re-fire it.
    expect(onClearAllRequestConsumed).toHaveBeenCalled();
  });

  it("does not open the dialog when there is no pending clear-all request", () => {
    const task = { id: 1, taskName: "T1" };
    stubWorkspace([task], [task]);
    const onClearAllRequestConsumed = vi.fn();
    render(
      <TasksSection
        {...makeProps()}
        clearAllRequestNonce={null}
        onClearAllRequestConsumed={onClearAllRequestConsumed}
      />,
    );
    expect(screen.queryByText(t("en-US", "tasksClearDialogTitle"))).toBeNull();
    expect(onClearAllRequestConsumed).not.toHaveBeenCalled();
  });

  it("does not re-open the dialog for an already-handled request nonce", () => {
    const task = { id: 1, taskName: "T1" };
    stubWorkspace([task], [task]);
    const { rerender } = render(
      <TasksSection {...makeProps()} clearAllRequestNonce={7} onClearAllRequestConsumed={vi.fn()} />,
    );
    // Opened by the request; dismiss it.
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "cancel") }));
    expect(screen.queryByText(t("en-US", "tasksClearDialogTitle"))).toBeNull();
    // A re-render with the SAME (already-handled) nonce must not re-open it —
    // the parent only re-fires by bumping to a new monotonic value.
    rerender(
      <TasksSection {...makeProps()} clearAllRequestNonce={7} onClearAllRequestConsumed={vi.fn()} />,
    );
    expect(screen.queryByText(t("en-US", "tasksClearDialogTitle"))).toBeNull();
  });

  it("tags each task row with its id via data-deeplink-row (deep-link flash wiring)", () => {
    const rows = [
      { id: 11, taskName: "T11" },
      { id: 22, taskName: "T22" },
    ];
    stubWorkspace(rows, rows);
    const { container } = render(<TasksSection {...makeProps()} />);
    const tagged = container.querySelectorAll("[data-deeplink-row]");
    expect(tagged.length).toBe(rows.length);
    const ids = Array.from(tagged).map((r) => r.getAttribute("data-deeplink-row"));
    expect(ids).toContain(String(rows[0].id));
  });

  it("board cards show the live resource name for a linked task (provider threads resourcesById)", () => {
    // Board mode renders the REAL TaskKanban/TaskKanbanCard (only TaskRow is
    // mocked here). The task's cached assignee is stale; its resourceId #7
    // resolves to a renamed resource. The provider must build resourcesById
    // from workspace.resources and thread it into the board so the card shows
    // the live name, not the stale cache.
    stubSettings({ tasksViewMode: "board" });
    const task = {
      id: 1,
      taskName: "T1",
      assignee: "Old Removed",
      resourceId: 7,
      priority: "Medium",
      status: "To Do",
      dueDate: "",
      lastUpdateDate: "2026-05-01",
    };
    const resources = [
      { id: 7, firstName: "Correct", lastName: "Name", roleId: null, utilizationMode: "percent", utilization: {} },
    ];
    stubWorkspace([task], [task], resources);
    render(<TasksSection {...makeProps()} />);
    expect(screen.getByText("Correct Name")).toBeInTheDocument();
    expect(screen.queryByText("Old Removed")).not.toBeInTheDocument();
  });

  it("swimlane add-lane picker excludes a resource who already owns a task-derived lane", () => {
    // The picker only excluded session-added lanes (extraLaneIds), but the
    // swimlane grid ALSO derives a lane for anyone who owns a visible task
    // (groupByStatusAndPerson). Without the union, a person whose cards are
    // already on the board stayed selectable — picking them was a silent
    // no-op. Derive from the same healthFilteredTasks list the grid renders.
    stubSettings({ tasksViewMode: "swimlane" });
    const task = {
      id: 1,
      taskName: "T1",
      assignee: "Correct Name",
      resourceId: 7,
      priority: "Medium",
      status: "To Do",
      dueDate: "",
      lastUpdateDate: "2026-05-01",
    };
    const resources = [
      { id: 7, firstName: "Correct", lastName: "Name", roleId: null, utilizationMode: "percent", utilization: {} },
      { id: 9, firstName: "Other", lastName: "Person", roleId: null, utilizationMode: "percent", utilization: {} },
    ];
    stubWorkspace([task], [task], resources);
    render(<TasksSection {...makeProps()} />);
    const select = screen.getByRole("combobox", { name: t("en-US", "swimlaneAddLane") });
    const labels = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(labels).not.toContain("Correct Name");
    expect(labels).toContain("Other Person");
  });

  it("swimlane add-lane picker excludes externals while 'Hide externals' is on, includes them while off", () => {
    // Both assign pickers (add-lane + per-card select) must stay in step with
    // the hide-externals toggle: offering an external here lets a user assign
    // work to someone whose card is then hidden by the very same toggle.
    const task = { id: 1, taskName: "T1", assignee: "", priority: "Medium", status: "To Do", dueDate: "", lastUpdateDate: "2026-05-01" };
    const resources = [
      { id: 7, firstName: "Ext", lastName: "Person", isExternal: true, roleId: null, utilizationMode: "percent", utilization: {} },
      { id: 9, firstName: "Internal", lastName: "Person", roleId: null, utilizationMode: "percent", utilization: {} },
    ];
    stubWorkspace([task], [task], resources);

    stubSettings({ tasksViewMode: "swimlane", hideExternalTasks: true });
    const { unmount } = render(<TasksSection {...makeProps()} />);
    const hiddenSelect = screen.getByRole("combobox", { name: t("en-US", "swimlaneAddLane") });
    const hiddenLabels = Array.from(hiddenSelect.querySelectorAll("option")).map((o) => o.textContent);
    expect(hiddenLabels).not.toContain("Ext Person");
    expect(hiddenLabels).toContain("Internal Person");
    unmount();

    stubSettings({ tasksViewMode: "swimlane", hideExternalTasks: false });
    render(<TasksSection {...makeProps()} />);
    const shownSelect = screen.getByRole("combobox", { name: t("en-US", "swimlaneAddLane") });
    const shownLabels = Array.from(shownSelect.querySelectorAll("option")).map((o) => o.textContent);
    expect(shownLabels).toContain("Ext Person");
  });

  it("a lane added via the picker before 'Hide externals' is toggled on stops being a live drop target", () => {
    // Excluding externals from the picker was not enough: the picker only
    // stops OFFERING them going forward, it never retracts a lane already in
    // (session-only) extraLaneIds state. Reachable sequence: toggle off, add
    // the still-empty lane via the picker (allowed — they own nothing yet),
    // then they pick up a REAL task while the toggle is still off (a
    // legitimate drop). A fixture that never gives the external real owned
    // work can't distinguish "an always-empty lane never rendered" from "a
    // lane that legitimately held a card is now correctly gone" once the
    // toggle flips on — this fixture exercises the latter.
    const otherTask = {
      id: 1, taskName: "T1", assignee: "", resourceId: 9,
      priority: "Medium", status: "To Do", dueDate: "", lastUpdateDate: "2026-05-01",
    };
    const ownedByExternal = {
      id: 2, taskName: "Owned by ext", assignee: "", resourceId: 7,
      priority: "Medium", status: "To Do", dueDate: "", lastUpdateDate: "2026-05-01",
    };
    const resources = [
      { id: 7, firstName: "Ext", lastName: "Person", isExternal: true, roleId: null, utilizationMode: "percent", utilization: {} },
      { id: 9, firstName: "Internal", lastName: "Person", roleId: null, utilizationMode: "percent", utilization: {} },
    ];

    stubSettings({ tasksViewMode: "swimlane", hideExternalTasks: false });
    stubWorkspace([otherTask], [otherTask], resources);
    const { rerender } = render(<TasksSection {...makeProps()} />);

    // Add the external's still-empty lane via the picker. Query by the lane's
    // own `<section aria-label>` (region role), not by text — the picker's
    // own <option> also reads "Ext Person" and would collide with a text query.
    fireEvent.change(
      screen.getByRole("combobox", { name: t("en-US", "swimlaneAddLane") }),
      { target: { value: "7" } },
    );
    expect(screen.getByRole("region", { name: "Ext Person" })).toBeInTheDocument();

    // They pick up a real task while the toggle is still off.
    stubWorkspace([otherTask, ownedByExternal], [otherTask, ownedByExternal], resources);
    rerender(<TasksSection {...makeProps()} />);
    expect(screen.getByTestId("swimlane-card-2")).toBeInTheDocument();

    // Toggle "Hide externals" on. Upstream filtering (workspace-context, not
    // under test here) would already have dropped the external's task from
    // filteredSortedTasks by this point — mirrored here by omitting it — but
    // the session-only extra-lane state is untouched by that toggle, so
    // WITHOUT the fix the lane (and its drop target) would still render.
    stubSettings({ tasksViewMode: "swimlane", hideExternalTasks: true });
    stubWorkspace([otherTask], [otherTask], resources);
    rerender(<TasksSection {...makeProps()} />);

    expect(screen.queryByRole("region", { name: "Ext Person" })).not.toBeInTheDocument();
    for (const status of TASK_STATUSES) {
      expect(screen.queryByTestId(`swimlane-cell-res:7-${status}`)).not.toBeInTheDocument();
    }

    // Toggling back off restores the lane — the raw extraLaneIds state was
    // never mutated, matching the app's self-healing orphaned-filter
    // convention (the picker's addLane/removeLane are the only writers).
    stubSettings({ tasksViewMode: "swimlane", hideExternalTasks: false });
    stubWorkspace([otherTask], [otherTask], resources);
    rerender(<TasksSection {...makeProps()} />);
    expect(screen.getByRole("region", { name: "Ext Person" })).toBeInTheDocument();
  });

  it("renders a Dark-Blue sticky table header", () => {
    const task = { id: 1, taskName: "T1" };
    stubWorkspace([task], [task]);
    const { container } = render(<TasksSection {...makeProps()} />);
    const thead = container.querySelector("thead");
    expect(thead).not.toBeNull();
    // The Dark-Blue fill moved to the <th> cells (via the `aipm-cockpit-thead` marker +
    // globals.css) so rounded header corners can clip it; the thead carries the
    // marker class instead of `bg-ui-dark-blue`.
    expect(thead!.className).toContain("aipm-cockpit-thead");
    expect(thead!.className).not.toContain("bg-surface-muted");
  });

  it("inline add row is present when tasks list is non-empty", () => {
    const task = { id: 1, taskName: "T1" };
    stubWorkspace([task], [task]);
    render(<TasksSection {...makeProps()} />);
    const addBtns = screen.getAllByRole("button", { name: t("en-US", "addTask") });
    expect(addBtns.length).toBeGreaterThanOrEqual(1);
  });

  it("inline add row is present when tasks list is empty", () => {
    stubWorkspace([], []);
    render(<TasksSection {...makeProps()} />);
    const addBtns = screen.getAllByRole("button", { name: t("en-US", "addTask") });
    expect(addBtns.length).toBeGreaterThanOrEqual(1);
  });

  it("clicking inline add row calls setTaskModalOpen with true", () => {
    const task = { id: 1, taskName: "T1" };
    stubWorkspace([task], [task]);
    const setTaskModalOpen = vi.fn();
    render(<TasksSection {...makeProps()} setTaskModalOpen={setTaskModalOpen} />);
    const addBtns = screen.getAllByRole("button", { name: t("en-US", "addTask") });
    fireEvent.click(addBtns[addBtns.length - 1]); // last = inline row
    expect(setTaskModalOpen).toHaveBeenCalledWith(true);
  });

  it("renders a sortable workflow-status (taskStatus) column header", () => {
    const setSortKey = vi.fn();
    mockUseFilters.mockReturnValue({
      search: "", setSearch: vi.fn(),
      searchDebounced: "",
      setSearchImmediate: vi.fn(),
      priorityFilter: "All", setPriorityFilter: vi.fn(),
      assigneeFilter: "All", setAssigneeFilter: vi.fn(),
      groupFilter: "All", setGroupFilter: vi.fn(),
      labelFilter: "All", setLabelFilter: vi.fn(),
      healthFilter: "all", setHealthFilter: vi.fn(),
      sortKey: "taskName", sortDir: "asc",
      setSortKey, setSortDir: vi.fn(),
      raidFilterTaskId: null, setRaidFilterTaskId: vi.fn(),
      resetFilters: vi.fn(),
    });
    const task = { id: 1, taskName: "T1" };
    stubWorkspace([task], [task]);
    render(<TasksSection {...makeProps()} />);
    // The RAG-dot "status" header is a non-button sr-only span; the workflow
    // taskStatus header is the only sortable button labelled "Status".
    const header = screen.getByRole("button", { name: t("en-US", "colTaskStatus") });
    fireEvent.click(header);
    // sortKey was "taskName", so clicking a different column sets it directly.
    expect(setSortKey).toHaveBeenCalledWith("taskStatus");
  });

  it("fills available height and is resizable when fillHeight is set", () => {
    const task = { id: 1, taskName: "T1" };
    stubWorkspace([task], [task]);
    const { container } = render(<TasksSection {...makeProps()} fillHeight />);
    const section = container.querySelector("section");
    expect(section?.className).toContain("h-full");
    expect(section?.className).toContain("resize");
    expect(section?.className).not.toContain("h-[560px]");
  });

  it("keeps the fixed resizable box by default (no fillHeight)", () => {
    const task = { id: 1, taskName: "T1" };
    stubWorkspace([task], [task]);
    const { container } = render(<TasksSection {...makeProps()} />);
    const section = container.querySelector("section");
    expect(section?.className).toContain("h-[560px]");
    expect(section?.className).toContain("resize");
  });

  it("hides Done and Cancelled tasks when hideFinishedTasks is on", () => {
    stubSettings({ hideFinishedTasks: true });
    const alpha = { id: 1, taskName: "Alpha", status: "To Do" };
    const bravo = { id: 2, taskName: "Bravo", status: "Done" };
    const charlie = { id: 3, taskName: "Charlie", status: "Cancelled" };
    stubWorkspace([alpha, bravo, charlie], [alpha, bravo, charlie]);
    render(<TasksSection {...makeProps()} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Bravo")).not.toBeInTheDocument();
    expect(screen.queryByText("Charlie")).not.toBeInTheDocument();
  });

  it("hides finished rows and renders no heading/count (single toolbar row)", () => {
    // The header heading + task count were dropped in favour of a single
    // milestones-style toolbar row; only the row-hiding behaviour remains.
    stubSettings({ hideFinishedTasks: true });
    const alpha = { id: 1, taskName: "Alpha", status: "To Do" };
    const bravo = { id: 2, taskName: "Bravo", status: "Done" };
    const charlie = { id: 3, taskName: "Charlie", status: "Cancelled" };
    stubWorkspace([alpha, bravo, charlie], [alpha, bravo, charlie]);
    render(<TasksSection {...makeProps()} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Bravo")).not.toBeInTheDocument();
    expect(screen.queryByText("Charlie")).not.toBeInTheDocument();
    // No heading — the modern shell supplies the view <h1>.
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("shows all tasks (incl. Done and Cancelled) when hideFinishedTasks is off", () => {
    stubSettings({ hideFinishedTasks: false });
    const alpha = { id: 1, taskName: "Alpha", status: "To Do" };
    const bravo = { id: 2, taskName: "Bravo", status: "Done" };
    const charlie = { id: 3, taskName: "Charlie", status: "Cancelled" };
    stubWorkspace([alpha, bravo, charlie], [alpha, bravo, charlie]);
    render(<TasksSection {...makeProps()} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
  });

  it("renders the board when tasksViewMode is 'board'", () => {
    stubSettings({ tasksViewMode: "board" });
    const task = { id: 1, taskName: "T1", status: "To Do" };
    stubWorkspace([task], [task]);
    render(<TasksSection {...makeProps()} />);
    expect(
      screen.getByRole("radio", { name: t("en-US", "tasksViewBoard") }),
    ).toHaveAttribute("aria-checked", "true");
    // A status column header is present in board mode.
    expect(
      screen.getByRole("heading", { name: new RegExp(t("en-US", "statusToDo")) }),
    ).toBeInTheDocument();
  });

  it("renders the table when tasksViewMode is 'table'", () => {
    stubSettings({ tasksViewMode: "table" });
    const task = { id: 1, taskName: "T1", status: "To Do" };
    stubWorkspace([task], [task]);
    render(<TasksSection {...makeProps()} />);
    expect(
      screen.getByRole("radio", { name: t("en-US", "tasksViewTable") }),
    ).toHaveAttribute("aria-checked", "true");
    // The task table renders the row in table mode.
    expect(screen.getByText("T1")).toBeInTheDocument();
  });

  it("renders the two row filters as toggle buttons that write their settings flags", () => {
    const setSettings = vi.fn();
    mockUseSettings.mockReturnValue({
      settings: {
        holidayCountries: [],
        jira: { siteUrl: "", enabled: false, projectKey: "", issueTypes: [] },
        notifications: { reminderLeadDays: 7, banner: { enabled: false }, popup: { enabled: false } },
        ai: { consentAccepted: false },
        lang: "en-US",
        popout: { reuseWindow: false },
        hideFinishedTasks: false,
        hideExternalTasks: false,
      },
      setSettings,
      hydrated: true,
      i18nReady: true,
      lang: "en-US",
    });
    const task = { id: 1, taskName: "T1", status: "To Do" };
    stubWorkspace([task], [task]);
    render(<TasksSection {...makeProps()} />);

    const finished = screen.getByRole("button", { name: t("en-US", "hideFinishedTasks") });
    expect(finished.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(finished);
    expect(setSettings).toHaveBeenCalledTimes(1);

    const external = screen.getByRole("button", { name: t("en-US", "hideExternalTasks") });
    expect(external.getAttribute("aria-pressed")).toBe("false");
  });

  it("toggling 'Hide finished' persists via setSettings, reading the flag out of the updater's own state", () => {
    const setSettings = vi.fn();
    mockUseSettings.mockReturnValue({
      settings: {
        holidayCountries: [],
        jira: { siteUrl: "", enabled: false, projectKey: "", issueTypes: [] },
        notifications: { reminderLeadDays: 7, banner: { enabled: false }, popup: { enabled: false } },
        ai: { consentAccepted: false },
        lang: "en-US",
        popout: { reuseWindow: false },
        hideFinishedTasks: false,
      },
      setSettings,
      hydrated: true,
      i18nReady: true,
      lang: "en-US",
    });
    const task = { id: 1, taskName: "T1", status: "To Do" };
    stubWorkspace([task], [task]);
    render(<TasksSection {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "hideFinishedTasks") }));
    expect(setSettings).toHaveBeenCalledTimes(1);
    // Capture the functional updater and apply it to a known baseline. The
    // handler must flip the flag it reads OFF `s`, not off the render-scope
    // `hideFinished` const — this is non-tautological: a handler that hardcoded
    // `true`, dropped the spread, or no-op'd would fail these assertions.
    const updater = setSettings.mock.calls[0][0] as (s: Settings) => Settings;
    const next = updater({ hideFinishedTasks: false, language: "en-US" } as Settings);
    expect(next.hideFinishedTasks).toBe(true);
    expect(next.language).toBe("en-US");
  });

  it("toggling 'Hide externals' persists via setSettings, reading the flag out of the updater's own state", () => {
    const setSettings = vi.fn();
    mockUseSettings.mockReturnValue({
      settings: {
        holidayCountries: [],
        jira: { siteUrl: "", enabled: false, projectKey: "", issueTypes: [] },
        notifications: { reminderLeadDays: 7, banner: { enabled: false }, popup: { enabled: false } },
        ai: { consentAccepted: false },
        lang: "en-US",
        popout: { reuseWindow: false },
        hideFinishedTasks: false,
        hideExternalTasks: false,
      },
      setSettings,
      hydrated: true,
      i18nReady: true,
      lang: "en-US",
    });
    const task = { id: 1, taskName: "T1", status: "To Do" };
    stubWorkspace([task], [task]);
    render(<TasksSection {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "hideExternalTasks") }));
    expect(setSettings).toHaveBeenCalledTimes(1);
    // Same non-tautological shape as the "Hide finished" test above.
    const updater = setSettings.mock.calls[0][0] as (s: Settings) => Settings;
    const next = updater({ hideExternalTasks: false, language: "en-US" } as Settings);
    expect(next.hideExternalTasks).toBe(true);
    expect(next.language).toBe("en-US");
  });

  // ★★ Landmine class (AGENTS.md): a toggle handler that reads the render-scope
  // `hideFinished` const instead of the updater's own `s` computes the SAME
  // target value on every click within one tick — two clicks in one tick would
  // both resolve to "on" instead of cancelling out. Simulate React applying two
  // queued functional updaters back-to-back (feeding the first's result into
  // the second, as React itself would) and assert they DO cancel out.
  it("threads two clicks in one tick through the functional updater so they cancel out", () => {
    const setSettings = vi.fn();
    mockUseSettings.mockReturnValue({
      settings: {
        holidayCountries: [],
        jira: { siteUrl: "", enabled: false, projectKey: "", issueTypes: [] },
        notifications: { reminderLeadDays: 7, banner: { enabled: false }, popup: { enabled: false } },
        ai: { consentAccepted: false },
        lang: "en-US",
        popout: { reuseWindow: false },
        hideFinishedTasks: false,
      },
      setSettings,
      hydrated: true,
      i18nReady: true,
      lang: "en-US",
    });
    const task = { id: 1, taskName: "T1", status: "To Do" };
    stubWorkspace([task], [task]);
    render(<TasksSection {...makeProps()} />);
    const finished = screen.getByRole("button", { name: t("en-US", "hideFinishedTasks") });
    fireEvent.click(finished);
    fireEvent.click(finished);
    expect(setSettings).toHaveBeenCalledTimes(2);
    const base = { hideFinishedTasks: false, language: "en-US" } as Settings;
    const afterFirst = (setSettings.mock.calls[0][0] as (s: Settings) => Settings)(base);
    expect(afterFirst.hideFinishedTasks).toBe(true);
    const afterSecond = (setSettings.mock.calls[1][0] as (s: Settings) => Settings)(afterFirst);
    expect(afterSecond.hideFinishedTasks).toBe(false);
  });

  it("view-mode toggle writes device settings when the project has no override", () => {
    const setSettings = vi.fn();
    mockUseSettings.mockReturnValue({
      settings: {
        holidayCountries: [],
        jira: { siteUrl: "", enabled: false, projectKey: "", issueTypes: [] },
        notifications: { reminderLeadDays: 7, banner: { enabled: false }, popup: { enabled: false } },
        ai: { consentAccepted: false },
        lang: "en-US",
        popout: { reuseWindow: false },
        tasksViewMode: "table",
      },
      setSettings,
      hydrated: true,
      i18nReady: true,
      lang: "en-US",
    });
    const task = { id: 1, taskName: "T1", status: "To Do" };
    stubWorkspace([task], [task]);
    render(<TasksSection {...makeProps()} settingsProjectId="p-vm-device" />);
    fireEvent.click(screen.getByRole("radio", { name: t("en-US", "tasksViewBoard") }));
    expect(setSettings).toHaveBeenCalledTimes(1);
    const updater = setSettings.mock.calls[0][0] as (s: Settings) => Settings;
    expect(updater({ tasksViewMode: "table" } as Settings).tasksViewMode).toBe("board");
    // No project appearance override was created.
    expect(getAppearanceSnapshot("p-vm-device").tasksViewMode).toBeUndefined();
  });

  it("view-mode toggle writes the project appearance store when an override is active", () => {
    const pid = "p-vm-override";
    saveProjectAppearance(pid, { tasksViewMode: "table" });
    const setSettings = vi.fn();
    mockUseSettings.mockReturnValue({
      settings: {
        holidayCountries: [],
        jira: { siteUrl: "", enabled: false, projectKey: "", issueTypes: [] },
        notifications: { reminderLeadDays: 7, banner: { enabled: false }, popup: { enabled: false } },
        ai: { consentAccepted: false },
        lang: "en-US",
        popout: { reuseWindow: false },
        tasksViewMode: "table",
      },
      setSettings,
      hydrated: true,
      i18nReady: true,
      lang: "en-US",
    });
    const task = { id: 1, taskName: "T1", status: "To Do" };
    stubWorkspace([task], [task]);
    try {
      render(<TasksSection {...makeProps()} settingsProjectId={pid} />);
      fireEvent.click(screen.getByRole("radio", { name: t("en-US", "tasksViewBoard") }));
      // The active-scope write went to the project store, NOT device settings.
      expect(setSettings).not.toHaveBeenCalled();
      expect(getAppearanceSnapshot(pid).tasksViewMode).toBe("board");
    } finally {
      saveProjectAppearance(pid, {}); // store persists across tests — clean up even on failure
    }
  });

  // AGENTS.md toolbar convention: every pane's toolbar ends with the contiguous
  // trailing group Print · reset-columns · reset-size; destructive actions go
  // BEFORE it, never between two of its members. Open Points had drifted to
  // Print · reset-size · reset-columns · Clear-all — Clear-all trailing the
  // resets, and the two resets swapped. expectButtonOrder throws on a missing
  // or duplicated control, so a deleted button can't degrade this into a
  // vacuous comparison (see src/test/toolbar-order.ts).
  it("orders the trailing toolbar group: clear-all, print, reset-columns, reset-size", () => {
    const task = { id: 1, taskName: "T1" };
    stubWorkspace([task], [task]);
    render(<TasksSection {...makeProps()} />);
    // Clear-all only has to LEAD; the trailing group must be adjacent AND in
    // the exact column/size order the convention specifies.
    expectButtonOrder(["clearAll", "printHint"]);
    expectButtonOrder(["printHint", "colResetWidthsHint", "tableResetSizeHint"], { contiguous: true });
  });

  it("gives the tasks search box a descriptive tooltip", () => {
    const task = { id: 1, taskName: "T1" };
    stubWorkspace([task], [task]);
    render(<TasksSection {...makeProps()} />);
    expect(screen.getByPlaceholderText(/search/i)).toHaveAttribute(
      "title",
      t("en-US", "tasksSearchHint")
    );
  });

  // ★ `search` is stubbed NON-empty on purpose: the field is controlled, so a
  //   test that types into it and asserts the value is back to "" passes
  //   whether or not anything clears — and with the default `search: ""` stub
  //   the ✕ never renders at all. The spy call is the only real assertion.
  it("clears the task search from a labelled button", () => {
    const setSearch = vi.fn();
    stubFilters({ search: "spec", setSearch });
    const task = { id: 1, taskName: "T1" };
    stubWorkspace([task], [task]);
    render(<TasksSection {...makeProps()} />);
    const field = screen.getByLabelText(
      t("en-US", "searchPlaceholder"),
    ) as HTMLInputElement;
    expect(field.value).toBe("spec");
    fireEvent.click(
      screen.getByRole("button", {
        name: `${t("en-US", "clear")} – ${t("en-US", "searchPlaceholder")}`,
      }),
    );
    expect(setSearch).toHaveBeenCalledWith("");
  });

  it("shows the Push-to-Outlook button when M365 is configured and task calendar sync is enabled", () => {
    stubSettings({ outlookCalendar: { task: { enabled: true, auto: false } } });
    const task = { id: 1, taskName: "T1", status: "To Do", dueDate: "2026-06-01" };
    stubWorkspace([task], [task]);
    render(<TasksSection {...makeProps()} m365Configured />);
    expect(
      screen.getByRole("button", { name: t("en-US", "calendarPush") }),
    ).toBeInTheDocument();
  });

  it("hides the Push-to-Outlook button when task calendar sync is disabled", () => {
    stubSettings({ outlookCalendar: { task: { enabled: false, auto: false } } });
    const task = { id: 1, taskName: "T1", status: "To Do", dueDate: "2026-06-01" };
    stubWorkspace([task], [task]);
    render(<TasksSection {...makeProps()} m365Configured />);
    expect(
      screen.queryByRole("button", { name: t("en-US", "calendarPush") }),
    ).not.toBeInTheDocument();
  });

  // The tasks pane now renders the shared CalendarSyncControls, whose enable toggle is
  // named per entity so that N panes' enable boxes are distinguishable (WCAG 2.4.6).
  // Querying the bare "Add to Outlook calendar" would match nothing and quietly
  // make every absence assertion below pass for the wrong reason.
  const calEnableLabel = `${t("en-US", "calendarSyncEnable")} – ${t("en-US", "calendarSyncEntityTask")}`;

  it("hides the calendar controls entirely when M365 is not configured", () => {
    stubSettings({ outlookCalendar: { task: { enabled: true, auto: false } } });
    const task = { id: 1, taskName: "T1", status: "To Do", dueDate: "2026-06-01" };
    stubWorkspace([task], [task]);
    render(<TasksSection {...makeProps()} />);
    expect(
      screen.queryByRole("button", { name: t("en-US", "calendarPush") }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: calEnableLabel }),
    ).not.toBeInTheDocument();
  });

  it("gives the Outlook enable toggle an explanatory tooltip carrying its state", () => {
    stubSettings({ outlookCalendar: { task: { enabled: true, auto: false } } });
    const task = { id: 1, taskName: "T1", status: "To Do", dueDate: "2026-06-01" };
    stubWorkspace([task], [task]);
    render(<TasksSection {...makeProps()} m365Configured />);
    const box = screen.getByRole("button", { name: calEnableLabel });
    // ★ `toContain`, not `toBe`: ToggleButton appends the current on/off state to
    //   every tooltip, so the hint is now a prefix rather than the whole title.
    expect(box.getAttribute("title")).toContain(t("en-US", "calendarSyncEnableHint"));
    // This fixture stubs the sync ON, so the tooltip must say so.
    expect(box.getAttribute("title")).toContain(t("en-US", "toggleStateOn"));
  });

  it("shows the Pull-from-Outlook button when M365 is configured and task calendar sync is enabled", () => {
    stubSettings({ outlookCalendar: { task: { enabled: true, auto: false } } });
    const task = { id: 1, taskName: "T1", status: "To Do", dueDate: "2026-06-01" };
    stubWorkspace([task], [task]);
    render(<TasksSection {...makeProps()} m365Configured />);
    expect(
      screen.getByRole("button", { name: t("en-US", "calendarPull") }),
    ).toBeInTheDocument();
  });

  it("hides the Pull-from-Outlook button when task calendar sync is disabled", () => {
    stubSettings({ outlookCalendar: { task: { enabled: false, auto: false } } });
    const task = { id: 1, taskName: "T1", status: "To Do", dueDate: "2026-06-01" };
    stubWorkspace([task], [task]);
    render(<TasksSection {...makeProps()} m365Configured />);
    expect(
      screen.queryByRole("button", { name: t("en-US", "calendarPull") }),
    ).not.toBeInTheDocument();
  });

  it("clicking Pull-from-Outlook invokes the pull hook", () => {
    stubSettings({ outlookCalendar: { task: { enabled: true, auto: false } } });
    const task = { id: 1, taskName: "T1", status: "To Do", dueDate: "2026-06-01" };
    stubWorkspace([task], [task]);
    render(<TasksSection {...makeProps()} m365Configured />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "calendarPull") }));
    expect(pullSpy).toHaveBeenCalledTimes(1);
  });

  it("hides the calendar controls in a popout (push can never fire there)", () => {
    stubSettings({ outlookCalendar: { task: { enabled: true, auto: false } } });
    const task = { id: 1, taskName: "T1", status: "To Do", dueDate: "2026-06-01" };
    stubWorkspace([task], [task]);
    render(<TasksSection {...makeProps()} m365Configured isPopout />);
    expect(
      screen.queryByRole("button", { name: t("en-US", "calendarPush") }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: calEnableLabel }),
    ).not.toBeInTheDocument();
  });

  it("captures a field-level undo entry for an inline cell edit (blockers)", () => {
    const task = { id: 1, taskName: "T1", blockers: "old note" };
    let currentTasks: unknown[] = [task];
    const setTasks = vi.fn((updater: (prev: unknown[]) => unknown[]) => {
      currentTasks = updater(currentTasks);
    });
    mockUseWorkspace.mockReturnValue({
      tasks: currentTasks,
      setTasks,
      filteredSortedTasks: currentTasks,
      uniqueAssignees: [],
      uniqueGroups: [],
      uniqueLabels: [],
      effectiveFilters: { assignee: "All", group: "All", label: "All" },
      tasksById: new Map(),
      taskSearchIndex: new Map(),
      resources: [],
      raid: [], setRaid: vi.fn(),
      absences: [], setAbsences: vi.fn(),
      shifts: [], setShifts: vi.fn(),
    });
    const captureFieldEdit = vi.fn();
    render(<TasksSection {...makeProps()} captureFieldEdit={captureFieldEdit} />);

    // TaskRow is stubbed (renders no interactive cells) — invoke the pane's
    // onInlinePatch directly via the captured RowContextProvider `value`,
    // the closest reliable seam to the real double-click-cell → blur flow
    // covered end-to-end by task-row.test.tsx.
    const ctx = capturedRowContext.current as {
      onInlinePatch: (id: number, patch: Record<string, unknown>) => void;
    };
    act(() => {
      ctx.onInlinePatch(1, { blockers: "new note" });
    });

    expect(captureFieldEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "task.updated",
        id: 1,
        before: { blockers: "old note" },
        after: { blockers: "new note" },
      }),
    );
  });

  it("does not capture an undo entry for a Jira-synced task's inline edit (no-op)", () => {
    const task = { id: 1, taskName: "T1", blockers: "old note", jiraKey: "LOP-1" };
    let currentTasks: unknown[] = [task];
    const setTasks = vi.fn((updater: (prev: unknown[]) => unknown[]) => {
      currentTasks = updater(currentTasks);
    });
    mockUseWorkspace.mockReturnValue({
      tasks: currentTasks,
      setTasks,
      filteredSortedTasks: currentTasks,
      uniqueAssignees: [],
      uniqueGroups: [],
      uniqueLabels: [],
      effectiveFilters: { assignee: "All", group: "All", label: "All" },
      tasksById: new Map(),
      taskSearchIndex: new Map(),
      resources: [],
      raid: [], setRaid: vi.fn(),
      absences: [], setAbsences: vi.fn(),
      shifts: [], setShifts: vi.fn(),
    });
    const captureFieldEdit = vi.fn();
    render(<TasksSection {...makeProps()} captureFieldEdit={captureFieldEdit} />);

    const ctx = capturedRowContext.current as {
      onInlinePatch: (id: number, patch: Record<string, unknown>) => void;
    };
    act(() => {
      ctx.onInlinePatch(1, { blockers: "new note" });
    });

    expect(captureFieldEdit).not.toHaveBeenCalled();
  });

  it("does not capture an undo entry when the inline patch value is unchanged (no-op)", () => {
    const task = { id: 1, taskName: "T1", blockers: "same note" };
    let currentTasks: unknown[] = [task];
    const setTasks = vi.fn((updater: (prev: unknown[]) => unknown[]) => {
      currentTasks = updater(currentTasks);
    });
    mockUseWorkspace.mockReturnValue({
      tasks: currentTasks,
      setTasks,
      filteredSortedTasks: currentTasks,
      uniqueAssignees: [],
      uniqueGroups: [],
      uniqueLabels: [],
      effectiveFilters: { assignee: "All", group: "All", label: "All" },
      tasksById: new Map(),
      taskSearchIndex: new Map(),
      resources: [],
      raid: [], setRaid: vi.fn(),
      absences: [], setAbsences: vi.fn(),
      shifts: [], setShifts: vi.fn(),
    });
    const captureFieldEdit = vi.fn();
    render(<TasksSection {...makeProps()} captureFieldEdit={captureFieldEdit} />);

    const ctx = capturedRowContext.current as {
      onInlinePatch: (id: number, patch: Record<string, unknown>) => void;
    };
    act(() => {
      ctx.onInlinePatch(1, { blockers: "same note" });
    });

    expect(captureFieldEdit).not.toHaveBeenCalled();
  });

  // Geometry, not pixels: jsdom has no layout engine, so assert what we EMIT.
  describe("table geometry", () => {
    function renderTable(over: Partial<TasksSectionProps> = {}) {
      const task = { id: 1, taskName: "T1" };
      stubWorkspace([task], [task]);
      return render(<TasksSection {...makeProps()} {...over} />);
    }

    /** The <col>s in render order, paired with the column id each one carries.
     *
     *  ★ Derived, never hardcoded. cols[0] is the leading gutter, so the column
     *  `visibleTaskCols(hidden)[i]` is cols[i + 1] — an index guessed from a
     *  remembered column order silently lands on some OTHER narrow column and
     *  the assertion then passes for the wrong reason. `makeProps()` passes an
     *  EMPTY hiddenCols (it does not go through useColumnManager, so the
     *  default-hidden set does not apply here) unless a test overrides it, and
     *  the length assertion below is what proves the +1 offset actually holds. */
    function colsById(container: HTMLElement, hidden: ReadonlySet<string> = new Set()) {
      const cols = Array.from(container.querySelectorAll("colgroup col"));
      const visible = visibleTaskCols(hidden);
      expect(cols).toHaveLength(visible.length + 1);
      return new Map(visible.map((col, i) => [col as string, cols[i + 1]]));
    }

    it("leaves taskName's <col> width-free so it absorbs the leftover", () => {
      const { container } = renderTable();
      const byId = colsById(container);

      expect(byId.get("taskName")!.getAttribute("style") ?? "").not.toMatch(/width/);
      // EVERY other column carries one — otherwise they would all go auto and
      // share the leftover again, which is the bug this fixes.
      for (const [col, el] of byId) {
        if (col === "taskName") continue;
        expect(el.getAttribute("style") ?? "", `${col} should declare a width`).toMatch(/width/);
      }
    });

    it("emits a width for taskName once the user has sized it", () => {
      const { container } = renderTable({ sizedWidths: { taskName: 420 } });
      expect(colsById(container).get("taskName")!.getAttribute("style") ?? "")
        .toMatch(/width:\s*420px/);
    });

    it("sets minWidth from the declared widths and drops it when a column hides", () => {
      const { container, unmount } = renderTable();
      const wide = (container.querySelector("table") as HTMLTableElement).style.minWidth;
      unmount();

      const { container: c2 } = renderTable({ hiddenCols: new Set(["priority"]) });
      const narrow = (c2.querySelector("table") as HTMLTableElement).style.minWidth;

      expect(parseInt(wide, 10) - parseInt(narrow, 10)).toBe(DEFAULT_COL_WIDTHS.priority);
    });

    it("no longer relies on width:max-content", () => {
      // With an auto column present, max-content resolves against the longest
      // task title, which would mean permanent horizontal scroll.
      const { container } = renderTable();
      const table = container.querySelector("table") as HTMLTableElement;
      expect(table.style.width).toBe("100%");
    });

    // ★★ The flex column MUST NOT be hideable, and two separate things break if
    //    it becomes so. (1) Geometry: taskName is the only <col> that emits no
    //    width, so hiding it leaves NO auto column and the surplus goes back to
    //    being split evenly across every column — the exact defect this whole
    //    change removes, reachable again through a supported user action.
    //    (2) Structure: its <th> renders UNCONDITIONALLY, unlike every hideable
    //    column's, so `visibleTaskCols` would drop the <col> while the header
    //    kept its cell — under table-layout:fixed that shifts every width onto
    //    the neighbouring column. Neither is visible in jsdom or to axe, and
    //    nothing else pins it: the guard is that taskName is absent from
    //    CONFIGURABLE_COLS, which is a module-local list one edit away.
    it("does not offer the flex column in the column-config popover", () => {
      // ★★ Assert on the KEY, not a rendered label. `CONFIGURABLE_COLS` maps
      //    key→labelKey freely, so `{ key: "taskName", labelKey: "anythingElse" }`
      //    would reintroduce the defect while a label-based assertion stayed green.
      expect(CONFIGURABLE_COLS.map((c) => c.key)).not.toContain("taskName");

      // …and the list really is what drives the popover, so the check above is
      // about the rendered control rather than an unused constant.
      renderTable({ colConfigOpen: true });
      const dialog = within(screen.getByRole("dialog", { name: t("en-US", "colConfigTitle") }));
      expect(dialog.getAllByRole("checkbox")).toHaveLength(CONFIGURABLE_COLS.length);
    });

    // ★ The gutter is the one column tableMinWidthPx accounts for but does not
    //   render from the same expression. It used to be a `w-7` class, which meant
    //   the constant and the rendered width could drift with nothing to catch it —
    //   and neither is visible to jsdom or to axe. This binds them.
    it("renders the leading gutter at exactly the width the minimum accounts for", () => {
      const { container } = renderTable();
      const gutter = container.querySelector("colgroup col") as HTMLTableColElement;
      expect(gutter.style.width).toBe(`${GUTTER_WIDTH_PX}px`);
    });
  });
});
