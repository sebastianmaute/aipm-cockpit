import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { t } from "./i18n";

vi.mock("./workspace-context", () => ({ useWorkspace: vi.fn() }));
vi.mock("./filters-context", () => ({ useFilters: vi.fn() }));
vi.mock("./task-form-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./task-form-context")>();
  return { ...actual, useTaskForm: vi.fn() };
});
vi.mock("./task-row", () => ({
  RowContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TaskRow: ({ task }: { task: { id: number; taskName: string } }) => (
    <tr><td>{task.taskName}</td></tr>
  ),
}));
vi.mock("./use-settings", () => ({ useSettings: vi.fn() }));
vi.mock("./use-holiday-set", () => ({ useHolidaySet: vi.fn() }));

import { useWorkspace } from "./workspace-context";
import { useFilters } from "./filters-context";
import { useTaskForm, emptyForm, emptyBulkEdit } from "./task-form-context";
import { useSettings } from "./use-settings";
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

function stubWorkspace(tasks: unknown[], filteredSortedTasks: unknown[]) {
  mockUseWorkspace.mockReturnValue({
    tasks,
    setTasks: vi.fn(),
    filteredSortedTasks,
    uniqueAssignees: [],
    uniqueGroups: [],
    uniqueLabels: [],
    tasksById: new Map(),
    taskSearchIndex: new Map(),
    raid: [], setRaid: vi.fn(),
    absences: [], setAbsences: vi.fn(),
    shifts: [], setShifts: vi.fn(),
  });
}

function stubSettings() {
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
    onToggleSelect: vi.fn(),
    onToggleNoteExpanded: vi.fn(),
    onJumpToRaid: vi.fn(),
    onToggleComplete: vi.fn(),
    onSendInquiry: vi.fn(),
    onPushToJira: vi.fn(),
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
  };
}

describe("TasksSection", () => {
  beforeEach(() => {
    stubFilters();
    stubTaskForm();
    stubSettings();
    stubHolidaySet();
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
});
