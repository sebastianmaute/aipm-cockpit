import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { t } from "./i18n";

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
import { TasksSection, type TasksSectionProps } from "./tasks-section";

const mockUseWorkspace = useWorkspace as ReturnType<typeof vi.fn>;
const mockUseFilters = useFilters as ReturnType<typeof vi.fn>;
const mockUseTaskForm = useTaskForm as ReturnType<typeof vi.fn>;
const mockUseSettings = useSettings as ReturnType<typeof vi.fn>;
const mockUseHolidaySet = useHolidaySet as ReturnType<typeof vi.fn>;

function stubFilters() {
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
    onToggleNoteExpanded: vi.fn(),
    onJumpToRaid: vi.fn(),
    onSendInquiry: vi.fn(),
    onPushToJira: vi.fn(),
    onStatusChange: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    // column manager
    hiddenCols: new Set(),
    setHiddenCols: vi.fn(),
    colWidths: {},
    colConfigOpen: false,
    setColConfigOpen: vi.fn(),
    colConfigRef: React.createRef<HTMLDivElement>(),
    startColResize: vi.fn(),
    resetColWidths: vi.fn(),
    // resizable table
    tableRef: React.createRef<HTMLElement>(),
    resetTableSize: vi.fn(),
    // row state
    expandedNotes: new Set(),
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

  it("renders a Dark-Blue sticky table header", () => {
    const task = { id: 1, taskName: "T1" };
    stubWorkspace([task], [task]);
    const { container } = render(<TasksSection {...makeProps()} />);
    const thead = container.querySelector("thead");
    expect(thead).not.toBeNull();
    // The Dark-Blue fill moved to the <th> cells (via the `aipm-cockpit-thead` marker +
    // globals.css) so rounded header corners can clip it; the thead carries the
    // marker class instead of `bg-AIPM-dark-blue`.
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
      screen.getByRole("button", { name: t("en-US", "tasksViewBoard") }),
    ).toHaveAttribute("aria-pressed", "true");
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
      screen.getByRole("button", { name: t("en-US", "tasksViewTable") }),
    ).toHaveAttribute("aria-pressed", "true");
    // The task table renders the row in table mode.
    expect(screen.getByText("T1")).toBeInTheDocument();
  });

  it("toggling 'Hide finished' persists via setSettings", () => {
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
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "hideFinishedTasks") }));
    expect(setSettings).toHaveBeenCalledTimes(1);
    // Capture the functional updater and apply it to a known baseline. The
    // handler forwards e.target.checked (which RTL reports as the controlled
    // prop value, false) into a spread update — so the updater writes false and
    // preserves siblings. This is non-tautological: a handler that hardcoded
    // `true`, dropped the spread, or no-op'd would fail these assertions.
    const updater = setSettings.mock.calls[0][0] as (s: Settings) => Settings;
    const next = updater({ hideFinishedTasks: true, language: "en-US" } as Settings);
    expect(next.hideFinishedTasks).toBe(false);
    expect(next.language).toBe("en-US");
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

  it("hides the calendar controls entirely when M365 is not configured", () => {
    stubSettings({ outlookCalendar: { task: { enabled: true, auto: false } } });
    const task = { id: 1, taskName: "T1", status: "To Do", dueDate: "2026-06-01" };
    stubWorkspace([task], [task]);
    render(<TasksSection {...makeProps()} />);
    expect(
      screen.queryByRole("button", { name: t("en-US", "calendarPush") }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: t("en-US", "calendarSyncEnable") }),
    ).not.toBeInTheDocument();
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
      screen.queryByRole("checkbox", { name: t("en-US", "calendarSyncEnable") }),
    ).not.toBeInTheDocument();
  });

  it("captures a field-level undo entry for an inline cell edit (notes)", () => {
    const task = { id: 1, taskName: "T1", notes: "old note" };
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
      ctx.onInlinePatch(1, { notes: "new note" });
    });

    expect(captureFieldEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "task.updated",
        id: 1,
        before: { notes: "old note" },
        after: { notes: "new note" },
      }),
    );
  });

  it("does not capture an undo entry for a Jira-synced task's inline edit (no-op)", () => {
    const task = { id: 1, taskName: "T1", notes: "old note", jiraKey: "LOP-1" };
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
      ctx.onInlinePatch(1, { notes: "new note" });
    });

    expect(captureFieldEdit).not.toHaveBeenCalled();
  });

  it("does not capture an undo entry when the inline patch value is unchanged (no-op)", () => {
    const task = { id: 1, taskName: "T1", notes: "same note" };
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
      ctx.onInlinePatch(1, { notes: "same note" });
    });

    expect(captureFieldEdit).not.toHaveBeenCalled();
  });
});
