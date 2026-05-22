// src/app/use-task-row-handlers.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTaskRowHandlers } from "./use-task-row-handlers";
import type { Task } from "./types";

vi.mock("./workspace-tab-context", () => ({
  useWorkspaceTab: vi.fn(() => ({
    activeTab: "chat" as const,
    setActiveTab: vi.fn(),
    isPopout: false,
  })),
}));

vi.mock("./use-workspace-collapsed", () => ({
  useWorkspaceCollapsed: vi.fn(() => ({
    workspaceCollapsed: false,
    setWorkspaceCollapsed: vi.fn(),
  })),
}));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    taskName: "Test task",
    assignee: "Alice",
    assigneeEmail: "alice@example.com",
    dueDate: "2030-12-31",
    lastUpdateDate: "2030-01-01",
    priority: "Medium",
    blockers: "",
    notes: "",
    ...overrides,
  };
}

function makeArgs(
  overrides: Partial<Parameters<typeof useTaskRowHandlers>[0]> = {},
) {
  const tasksRef = { current: [makeTask()] };
  return {
    tasksRef,
    settings: {
      jira: {
        enabled: false,
        siteUrl: "",
        email: "",
        apiToken: "",
        projectKey: "",
        issueTypes: [],
      },
    } as unknown as Parameters<typeof useTaskRowHandlers>[0]["settings"],
    lang: "en-US" as const,
    today: "2030-01-01",
    editingId: null,
    showToast: vi.fn() as (kind: "info" | "error", text: string) => void,
    openEditModal: vi.fn() as (task: Task) => void,
    setTasks: vi.fn() as Parameters<typeof useTaskRowHandlers>[0]["setTasks"],
    setRaidFilterTaskId: vi.fn() as Parameters<
      typeof useTaskRowHandlers
    >[0]["setRaidFilterTaskId"],
    deselectIdRef: { current: vi.fn() as (id: number) => void },
    handleCancelEdit: vi.fn(),
    logActivity: vi.fn() as Parameters<
      typeof useTaskRowHandlers
    >[0]["logActivity"],
    ...overrides,
  };
}

describe("useTaskRowHandlers", () => {
  it("returns empty expandedNotes and pushingIds initially", () => {
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs()));
    expect(result.current.expandedNotes.size).toBe(0);
    expect(result.current.pushingIds.size).toBe(0);
  });

  it("onToggleNoteExpanded adds then removes id from expandedNotes", () => {
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs()));
    act(() => result.current.onToggleNoteExpanded(1));
    expect(result.current.expandedNotes.has(1)).toBe(true);
    act(() => result.current.onToggleNoteExpanded(1));
    expect(result.current.expandedNotes.has(1)).toBe(false);
  });

  it("onToggleComplete calls setTasks", () => {
    const setTasks = vi.fn();
    const task = makeTask();
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ setTasks })),
    );
    act(() => result.current.onToggleComplete(task));
    expect(setTasks).toHaveBeenCalled();
  });

  it("onDelete calls setTasks when user confirms", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const setTasks = vi.fn();
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ setTasks })),
    );
    act(() => result.current.onDelete(1));
    expect(setTasks).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("onEdit calls openEditModal with the task", () => {
    const openEditModal = vi.fn();
    const task = makeTask();
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ openEditModal })),
    );
    act(() => result.current.onEdit(task));
    expect(openEditModal).toHaveBeenCalledWith(task);
  });

  it("handleClearRaidTaskFilter calls setRaidFilterTaskId with null", () => {
    const setRaidFilterTaskId = vi.fn();
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ setRaidFilterTaskId })),
    );
    act(() => result.current.handleClearRaidTaskFilter());
    expect(setRaidFilterTaskId).toHaveBeenCalledWith(null);
  });
});
