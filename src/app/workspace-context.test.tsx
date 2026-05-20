import { describe, test, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { type ReactNode } from "react";
import { FiltersProvider, useFilters } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";

function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

function makeTask(overrides: Partial<import("./types").Task> = {}): import("./types").Task {
  return {
    id: 1,
    taskName: "Sample",
    assignee: "Alice",
    assigneeEmail: "",
    dueDate: "2026-12-01",
    lastUpdateDate: "2026-05-18",
    priority: "Medium",
    blockers: "",
    notes: "",
    group: "",
    labels: [],
    ...overrides,
  };
}

describe("WorkspaceProvider", () => {
  test("exposes empty defaults", () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });
    expect(result.current.tasks).toEqual([]);
    expect(result.current.uniqueAssignees).toEqual([]);
    expect(result.current.uniqueGroups).toEqual([]);
    expect(result.current.uniqueLabels).toEqual([]);
    expect(result.current.tasksById.size).toBe(0);
    expect(result.current.taskSearchIndex.size).toBe(0);
    expect(result.current.filteredSortedTasks).toEqual([]);
    expect(result.current.raid).toEqual([]);
    expect(result.current.absences).toEqual([]);
    expect(result.current.shifts).toEqual([]);
  });

  test("setTasks updates state and rebuilds derivations", () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });

    const seeded = [
      makeTask({ id: 1, taskName: "Alpha", assignee: "Bob",   group: "G1", labels: ["frontend"] }),
      makeTask({ id: 2, taskName: "Bravo", assignee: "Alice", group: "G2", labels: ["backend"] }),
      makeTask({ id: 3, taskName: "Cain",  assignee: "Carol", group: "G1", labels: ["frontend", "infra"] }),
    ];

    act(() => result.current.setTasks(seeded));

    expect(result.current.tasks).toEqual(seeded);
    expect(result.current.uniqueAssignees).toEqual(["Alice", "Bob", "Carol"]);
    expect(result.current.uniqueGroups).toEqual(["G1", "G2"]);
    expect(result.current.uniqueLabels).toEqual(["backend", "frontend", "infra"]);
    expect(result.current.tasksById.get(2)).toBe(seeded[1]);
    expect(result.current.taskSearchIndex.get(1)).toContain("alpha");
    expect(result.current.taskSearchIndex.get(1)).toContain("bob");
  });

  test("filteredSortedTasks narrows when priority filter changes", () => {
    const { result } = renderHook(
      () => ({ ws: useWorkspace(), filters: useFilters() }),
      { wrapper },
    );

    const seeded = [
      makeTask({ id: 1, taskName: "Low task",    priority: "Low" }),
      makeTask({ id: 2, taskName: "Medium task", priority: "Medium" }),
      makeTask({ id: 3, taskName: "High task",   priority: "High" }),
    ];

    act(() => result.current.ws.setTasks(seeded));
    expect(result.current.ws.filteredSortedTasks).toHaveLength(3);

    act(() => result.current.filters.setPriorityFilter("High"));
    expect(result.current.ws.filteredSortedTasks).toHaveLength(1);
    expect(result.current.ws.filteredSortedTasks[0].id).toBe(3);
  });

  test("sort key/dir reorders filteredSortedTasks", () => {
    const { result } = renderHook(
      () => ({ ws: useWorkspace(), filters: useFilters() }),
      { wrapper },
    );

    act(() =>
      result.current.ws.setTasks([
        makeTask({ id: 10, taskName: "Bravo" }),
        makeTask({ id: 20, taskName: "Alpha" }),
      ]),
    );

    // Default sort: id asc → [#10, #20]
    expect(result.current.ws.filteredSortedTasks.map((t) => t.id)).toEqual([10, 20]);

    // Sort by taskName asc → Alpha before Bravo
    act(() => result.current.filters.setSortKey("taskName"));
    expect(
      result.current.ws.filteredSortedTasks.map((t) => t.taskName),
    ).toEqual(["Alpha", "Bravo"]);

    // Toggle to desc → Bravo before Alpha
    act(() => result.current.filters.setSortDir("desc"));
    expect(
      result.current.ws.filteredSortedTasks.map((t) => t.taskName),
    ).toEqual(["Bravo", "Alpha"]);
  });

  test("useWorkspace() outside a WorkspaceProvider throws a documented error", () => {
    // React logs the rendering error to console.error in dev; silence it
    // so the test output stays clean. Restore after to avoid hiding
    // unrelated noise from later tests.
    const original = console.error;
    console.error = () => {};
    try {
      expect(() => renderHook(() => useWorkspace())).toThrow(
        "useWorkspace must be used within WorkspaceProvider",
      );
    } finally {
      console.error = original;
    }
  });
});
