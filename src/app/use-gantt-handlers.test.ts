// src/app/use-gantt-handlers.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useGanttHandlers } from "./use-gantt-handlers";
import type { Task } from "./types";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    taskName: "Test task",
    assignee: "Alice",
    assigneeEmail: "",
    dueDate: "2030-12-31",
    lastUpdateDate: "2030-01-01",
    priority: "Medium",
    blockers: "",
    notes: "",
    ...overrides,
  };
}

function makeArgs(overrides: Partial<Parameters<typeof useGanttHandlers>[0]> = {}) {
  return {
    tasksRef: { current: [makeTask()] },
    setTasks: vi.fn(),
    today: "2030-01-01",
    ...overrides,
  };
}

describe("useGanttHandlers", () => {
  it("handleGanttBarUpdate calls setTasks with updated dates", () => {
    const setTasks = vi.fn();
    const { result } = renderHook(() => useGanttHandlers(makeArgs({ setTasks })));
    act(() => result.current.handleGanttBarUpdate({
      taskId: 1,
      startDate: "2030-01-01",
      dueDate: "2030-01-31",
    }));
    expect(setTasks).toHaveBeenCalled();
  });

  it("handleGanttBarUpdate no-ops on unparseable due date", () => {
    const setTasks = vi.fn();
    const { result } = renderHook(() => useGanttHandlers(makeArgs({ setTasks })));
    act(() => result.current.handleGanttBarUpdate({
      taskId: 1,
      startDate: "2030-01-01",
      dueDate: "not-a-date",
    }));
    expect(setTasks).not.toHaveBeenCalled();
  });

  it("handleGanttBarUpdate clamps start date that exceeds due date", () => {
    const setTasks = vi.fn();
    const { result } = renderHook(() => useGanttHandlers(makeArgs({ setTasks })));
    act(() => result.current.handleGanttBarUpdate({
      taskId: 1,
      startDate: "2030-02-01",
      dueDate: "2030-01-15",
    }));
    expect(setTasks).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ startDate: "2030-01-15" }),
      ]),
    );
  });
});
