import { describe, test, expect } from "vitest";
import { renderHook, render, fireEvent, act } from "@testing-library/react";
import { memo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
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
    status: "To Do",
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

  test("assignee options + search resolve a linked task's LIVE resource name, not the stale cache", () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });
    act(() =>
      result.current.setResources([
        { id: 7, firstName: "Live", lastName: "Person", roleId: null, utilizationMode: "percent", utilization: {} },
      ]),
    );
    act(() =>
      result.current.setTasks([
        makeTask({ id: 1, taskName: "Alpha", assignee: "Old Cache", resourceId: 7 }),
      ]),
    );
    // Dropdown option is the live name, not the stale cached "Old Cache".
    expect(result.current.uniqueAssignees).toEqual(["Live Person"]);
    // Search matches the live name, not the cache.
    expect(result.current.taskSearchIndex.get(1)).toContain("live person");
    expect(result.current.taskSearchIndex.get(1)).not.toContain("old cache");
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

  test("sorts by estimate and spent columns using minutes value", () => {
    const { result } = renderHook(
      () => ({ ws: useWorkspace(), filters: useFilters() }),
      { wrapper },
    );

    act(() =>
      result.current.ws.setTasks([
        makeTask({ id: 1, originalEstimateMinutes: 120, timeSpentMinutes: 30 }),
        makeTask({ id: 2, originalEstimateMinutes: 60,  timeSpentMinutes: 90 }),
        makeTask({ id: 3, originalEstimateMinutes: undefined, timeSpentMinutes: undefined }),
      ]),
    );

    // Sort by estimate asc → 0 (undefined→0), 60, 120
    act(() => result.current.filters.setSortKey("estimate"));
    expect(result.current.ws.filteredSortedTasks.map((t) => t.id)).toEqual([3, 2, 1]);

    // Sort by estimate desc → 120, 60, 0
    act(() => result.current.filters.setSortDir("desc"));
    expect(result.current.ws.filteredSortedTasks.map((t) => t.id)).toEqual([1, 2, 3]);

    // Sort by spent asc → 0 (undefined→0), 30, 90
    act(() => {
      result.current.filters.setSortKey("spent");
      result.current.filters.setSortDir("asc");
    });
    expect(result.current.ws.filteredSortedTasks.map((t) => t.id)).toEqual([3, 1, 2]);
  });

  test("exposes budgets and fxRates state", () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });
    expect(result.current.budgets).toEqual([]);
    expect(result.current.fxRates).toBeNull();
    act(() => result.current.setBudgets([{ id: 1, name: "B", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-06-30", status: "open", allocations: [] }]));
    expect(result.current.budgets).toHaveLength(1);
  });

  test("provides changes state defaulting to []", () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });
    expect(result.current.changes).toEqual([]);
    expect(typeof result.current.setChanges).toBe("function");
  });

  test("exposes fieldVisibility state and setter", () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });
    expect(result.current.fieldVisibility).toBeUndefined();
    act(() => result.current.setFieldVisibility({ task: { fields: ["taskName"] } }));
    expect(result.current.fieldVisibility?.task.fields).toEqual(["taskName"]);
  });

  test("exposes features state and setter", () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });
    expect(result.current.features).toBeUndefined();
    act(() => result.current.setFeatures(["raid"]));
    expect(result.current.features).toEqual(["raid"]);
  });

  test("context value is referentially stable across unrelated parent re-renders", () => {
    let consumerRenders = 0;
    const Consumer = memo(function Consumer() {
      useWorkspace();
      consumerRenders += 1;
      return null;
    });

    function Harness() {
      const [, setTick] = useState(0);
      return (
        <>
          <button onClick={() => setTick((t) => t + 1)}>tick</button>
          <FiltersProvider>
            <WorkspaceProvider>
              <Consumer />
            </WorkspaceProvider>
          </FiltersProvider>
        </>
      );
    }

    const { getByText } = render(<Harness />);
    const after = consumerRenders;
    expect(after).toBeGreaterThan(0);

    // Unrelated state above the providers: every memo dep is unchanged,
    // so the memoized value keeps its identity and the memo'd consumer
    // must not re-render.
    fireEvent.click(getByText("tick"));
    fireEvent.click(getByText("tick"));
    expect(consumerRenders).toBe(after);
  });

  test("a workspace state change still re-renders consumers (counter sanity)", () => {
    let consumerRenders = 0;
    const Consumer = memo(function Consumer() {
      useWorkspace();
      consumerRenders += 1;
      return null;
    });

    let setTasksRef: Dispatch<SetStateAction<readonly import("./types").Task[]>> | undefined;
    function CaptureSetter() {
      setTasksRef = useWorkspace().setTasks;
      return null;
    }

    render(
      <FiltersProvider>
        <WorkspaceProvider>
          <Consumer />
          <CaptureSetter />
        </WorkspaceProvider>
      </FiltersProvider>,
    );
    const after = consumerRenders;

    act(() => setTasksRef!([makeTask()]));
    expect(consumerRenders).toBeGreaterThan(after);
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

  test("workspace sections are compile-time readonly (dirty-save guard)", () => {
    // Type-level proof, never executed: the Turso dirty-table save detects
    // changes by reference equality, so an in-place mutation of a workspace
    // section would silently skip that table's save (data loss). If someone
    // reverts the ReadonlyArray sections in workspace.ts, the @ts-expect-error
    // below becomes "unused" and tsc fails the build (TS2578).
    function mutationDoesNotCompile(ws: import("./workspace").Workspace): void {
      // @ts-expect-error tasks is ReadonlyArray — in-place mutation is forbidden
      ws.tasks.push(makeTask());
      // @ts-expect-error raid is ReadonlyArray — in-place mutation is forbidden
      ws.raid.pop();
      if (ws.status) {
        // @ts-expect-error status is Readonly — property assignment is forbidden
        ws.status.narrative = "";
      }
    }
    expect(typeof mutationDoesNotCompile).toBe("function");
  });
});
