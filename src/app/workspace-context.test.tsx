import { describe, test, expect, beforeEach } from "vitest";
import { renderHook, render, fireEvent, act } from "@testing-library/react";
import { memo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { FiltersProvider, useFilters } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { SETTINGS_KEY } from "./use-settings";
import { defaultSettings } from "./settings-types";
import { __resetMintStateForTests } from "./id-mint-session";

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
    description: "",
    group: "",
    labels: [],
    ...overrides,
  };
}

function makeResource(
  overrides: Partial<import("./types").Resource> = {},
): import("./types").Resource {
  return {
    id: 1,
    firstName: "Res",
    lastName: "Ource",
    roleId: null,
    utilizationMode: "percent",
    utilization: {},
    ...overrides,
  };
}

function seedHideExternalTasks() {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ ...defaultSettings, hideExternalTasks: true }),
  );
}

describe("WorkspaceProvider", () => {
  beforeEach(() => {
    localStorage.clear();
  });

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

  // Reported bug: filter by an assignee, reassign every one of their tasks, and
  // the dropdown option disappears while the filter state keeps pointing at it —
  // still hiding every row, but with the control falling back to "All" so
  // nothing on screen explains the empty table. The effective value is derived
  // rather than written back, so the raw choice survives and undoing the
  // reassign restores it.
  test("a filter whose value no longer exists on any task stops hiding every row", () => {
    const { result } = renderHook(
      () => ({ ws: useWorkspace(), filters: useFilters() }),
      { wrapper },
    );

    act(() =>
      result.current.ws.setTasks([
        makeTask({ id: 1, taskName: "Alpha", assignee: "Alice" }),
        makeTask({ id: 2, taskName: "Bravo", assignee: "Alice" }),
      ]),
    );
    act(() => result.current.filters.setAssigneeFilter("Alice"));
    expect(result.current.ws.filteredSortedTasks).toHaveLength(2);
    expect(result.current.ws.effectiveFilters.assignee).toBe("Alice");

    // Reassign every Alice task — "Alice" is no longer an option.
    act(() =>
      result.current.ws.setTasks((prev) => prev.map((t) => ({ ...t, assignee: "Bob" }))),
    );

    expect(result.current.ws.uniqueAssignees).toEqual(["Bob"]);
    expect(result.current.ws.effectiveFilters.assignee).toBe("All");
    expect(result.current.ws.filteredSortedTasks).toHaveLength(2);
    // The raw choice is untouched, so restoring the tasks restores the filter.
    expect(result.current.filters.assigneeFilter).toBe("Alice");
    act(() =>
      result.current.ws.setTasks((prev) => prev.map((t) => ({ ...t, assignee: "Alice" }))),
    );
    expect(result.current.ws.effectiveFilters.assignee).toBe("Alice");
    expect(result.current.ws.filteredSortedTasks).toHaveLength(2);
  });

  test("an orphaned group or label filter stops hiding every row", () => {
    const { result } = renderHook(
      () => ({ ws: useWorkspace(), filters: useFilters() }),
      { wrapper },
    );

    act(() =>
      result.current.ws.setTasks([makeTask({ id: 1, group: "G1", labels: ["frontend"] })]),
    );
    act(() => result.current.filters.setGroupFilter("G1"));
    act(() => result.current.filters.setLabelFilter("frontend"));
    expect(result.current.ws.filteredSortedTasks).toHaveLength(1);

    act(() =>
      result.current.ws.setTasks((prev) =>
        prev.map((t) => ({ ...t, group: "G2", labels: ["backend"] })),
      ),
    );

    expect(result.current.ws.effectiveFilters.group).toBe("All");
    expect(result.current.ws.effectiveFilters.label).toBe("All");
    expect(result.current.ws.filteredSortedTasks).toHaveLength(1);
  });

  // The group <select> offers a permanent "No group" option, but uniqueGroups
  // drops blanks — so the empty group filter is exempt from the orphan fallback.
  // Without the exemption "No group" resolves to All and becomes unselectable.
  // The pure resolver is tested directly; this pins the wiring end to end.
  test("the No-group filter survives the provider and still matches blank-group rows", () => {
    const { result } = renderHook(
      () => ({ ws: useWorkspace(), filters: useFilters() }),
      { wrapper },
    );

    act(() =>
      result.current.ws.setTasks([
        makeTask({ id: 1, taskName: "Ungrouped", group: "" }),
        makeTask({ id: 2, taskName: "Grouped", group: "G1" }),
      ]),
    );
    act(() => result.current.filters.setGroupFilter(""));

    expect(result.current.ws.uniqueGroups).toEqual(["G1"]); // "" is never an option
    expect(result.current.ws.effectiveFilters.group).toBe("");
    expect(result.current.ws.filteredSortedTasks.map((t) => t.id)).toEqual([1]);
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

  test("sorts by the createdDate column", () => {
    const { result } = renderHook(
      () => ({ ws: useWorkspace(), filters: useFilters() }),
      { wrapper },
    );

    act(() =>
      result.current.ws.setTasks([
        makeTask({ id: 1, createdDate: "2026-03-01" }),
        makeTask({ id: 2, createdDate: "2026-01-15" }),
        makeTask({ id: 3, createdDate: undefined }),
      ]),
    );

    // Sort by createdDate asc → undefined ("") sorts first, then earliest date.
    act(() => result.current.filters.setSortKey("createdDate"));
    expect(result.current.ws.filteredSortedTasks.map((t) => t.id)).toEqual([3, 2, 1]);

    // Toggle to desc → reverse order.
    act(() => result.current.filters.setSortDir("desc"));
    expect(result.current.ws.filteredSortedTasks.map((t) => t.id)).toEqual([1, 2, 3]);
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

  test("exposes documentAssets state and setter, defaulting to undefined like calendarEvents", () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });
    expect(result.current.documentAssets).toBeUndefined();
    act(() =>
      result.current.setDocumentAssets([
        {
          id: "asset-1",
          name: "diagram.png",
          mime: "image/png",
          size: 1234,
          hash: "abc123",
          createdAt: "2026-08-06T00:00:00.000Z",
        },
      ]),
    );
    expect(result.current.documentAssets).toHaveLength(1);
    expect(result.current.documentAssets?.[0].id).toBe("asset-1");
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

  describe("hideExternalTasks", () => {
    test("hiding externals removes their rows AND their assignee option", async () => {
      seedHideExternalTasks();
      const { result } = renderHook(() => useWorkspace(), { wrapper });
      await act(async () => {});

      act(() =>
        result.current.setResources([
          makeResource({ id: 1, firstName: "Ext", lastName: "Ernal", isExternal: true }),
          makeResource({ id: 2, firstName: "Int", lastName: "Ernal", isExternal: false }),
        ]),
      );
      act(() =>
        result.current.setTasks([
          makeTask({ id: 1, taskName: "External work", assignee: "Ext Ernal", resourceId: 1 }),
          makeTask({ id: 2, taskName: "Internal work", assignee: "Int Ernal", resourceId: 2 }),
        ]),
      );

      expect(result.current.filteredSortedTasks.map((t) => t.id)).toEqual([2]);
      expect(result.current.uniqueAssignees).not.toContain("Ext Ernal");
    });

    test("group and label options drop values only hidden tasks carried", async () => {
      seedHideExternalTasks();
      const { result } = renderHook(() => useWorkspace(), { wrapper });
      await act(async () => {});

      act(() =>
        result.current.setResources([
          makeResource({ id: 1, firstName: "Ext", lastName: "Ernal", isExternal: true }),
        ]),
      );
      act(() =>
        result.current.setTasks([
          makeTask({
            id: 1,
            taskName: "External work",
            assignee: "Ext Ernal",
            resourceId: 1,
            group: "OnlyExternal",
            labels: ["onlyExternalLabel"],
          }),
          makeTask({ id: 2, taskName: "Internal work", group: "Shared", labels: ["shared"] }),
        ]),
      );

      expect(result.current.uniqueGroups).not.toContain("OnlyExternal");
      expect(result.current.uniqueLabels).not.toContain("onlyExternalLabel");
    });

    test("tasksById still resolves a hidden external's task", async () => {
      seedHideExternalTasks();
      const { result } = renderHook(() => useWorkspace(), { wrapper });
      await act(async () => {});

      act(() =>
        result.current.setResources([
          makeResource({ id: 1, firstName: "Ext", lastName: "Ernal", isExternal: true }),
        ]),
      );
      act(() =>
        result.current.setTasks([
          makeTask({ id: 1, taskName: "External work", assignee: "Ext Ernal", resourceId: 1 }),
        ]),
      );

      expect(result.current.filteredSortedTasks).toHaveLength(0);
      expect(result.current.tasksById.get(1)).toBeDefined();
    });

    test("an assignee filter pointing at a hidden external resolves to All", async () => {
      seedHideExternalTasks();
      const { result } = renderHook(
        () => ({ ws: useWorkspace(), filters: useFilters() }),
        { wrapper },
      );
      await act(async () => {});

      act(() =>
        result.current.ws.setResources([
          makeResource({ id: 1, firstName: "Ext", lastName: "Ernal", isExternal: true }),
        ]),
      );
      act(() =>
        result.current.ws.setTasks([
          makeTask({ id: 1, taskName: "External work", assignee: "Ext Ernal", resourceId: 1 }),
        ]),
      );
      act(() => result.current.filters.setAssigneeFilter("Ext Ernal"));

      expect(result.current.ws.effectiveFilters.assignee).toBe("All");
    });
  });

  // `mutateDocuments` is the single entry point both the Documents pane and the
  // AI tools write through, and the whole point of routing them through ONE
  // callback is that the before-image snapshot and the document write cannot
  // come apart. These two tests pin the two ways they could.
  describe("mutateDocuments", () => {
    beforeEach(() => {
      // Ids are session-global and monotonic, so without this a later test in
      // this file would see ids carried over from an earlier one.
      __resetMintStateForTests();
    });

    // Mutation-proved: moving the version append into the `setDocuments`
    // functional updater makes this go red with 2 versions.
    // ★★★ STRICTMODE IS REQUIRED HERE, BUT ITS SHAPE IS NOT — and the second
    // half is the surprise, so do not "harden" this into the mount-commit rule.
    // Measured against the double-appending implementation, all three ways:
    // `reactStrictMode: true` RED (2), a wrapper-nested `<StrictMode>` also RED
    // (2), no StrictMode at all GREEN (1). The placement/mount-commit rule in
    // src/app/strictmode.meta.test.tsx governs EFFECT double-invocation; what
    // catches this defect is the double-invocation of a state UPDATER during
    // render, which applies to any component under StrictMode on any commit —
    // so the vacuity trap that rule warns about cannot bite this test.
    // `reactStrictMode: true` is kept anyway: it is the shape that is correct
    // for both mechanisms, so a future assertion here about effects is safe.
    test("writes exactly one version per mutation under StrictMode", () => {
      const { result } = renderHook(() => useWorkspace(), { wrapper, reactStrictMode: true });

      let docId = 0;
      act(() => {
        docId = result.current.mutateDocuments({ kind: "create", title: "A" }, "user").documentId ?? 0;
      });
      // A create replaces nothing, so it snapshots nothing.
      expect(result.current.documentVersions).toEqual([]);

      act(() => {
        result.current.mutateDocuments({ kind: "rename", id: docId, title: "B" }, "user");
      });

      expect(result.current.documents.map((d) => d.title)).toEqual(["B"]);
      expect(result.current.documentVersions).toHaveLength(1);
      // The version is the BEFORE-image, so it carries the pre-rename title.
      expect(result.current.documentVersions[0].title).toBe("A");
      expect(result.current.documentVersions[0].op).toBe("rename");
      expect(result.current.documentVersions[0].source).toBe("user");
    });

    // React has not re-rendered when the second call runs, so a callback that
    // read state instead of the refs it just wrote would snapshot the same
    // stale before-image twice AND build its version list from one missing the
    // first mutation's entry — dropping it outright.
    // Mutation-proved: deleting the two ref writes from the callback (leaving
    // the mirroring effects as the only writers) makes this go red with ["A"].
    // ★ NOT proved by moving those writes to after the two setters — the
    // setters are batched, so that swap leaves the test green. Ordering within
    // the callback is not what this pins; writing the refs at all is.
    test("snapshots the CURRENT document on a second mutation in the same tick", () => {
      const { result } = renderHook(() => useWorkspace(), { wrapper });

      let docId = 0;
      act(() => {
        docId = result.current.mutateDocuments({ kind: "create", title: "A" }, "user").documentId ?? 0;
      });

      act(() => {
        result.current.mutateDocuments({ kind: "rename", id: docId, title: "B" }, "user");
        result.current.mutateDocuments({ kind: "rename", id: docId, title: "C" }, "user");
      });

      expect(result.current.documents.map((d) => d.title)).toEqual(["C"]);
      expect(result.current.documentVersions.map((v) => v.title)).toEqual(["A", "B"]);
    });

    // A refused mutation must leave both slices alone — including their array
    // identities, which the Turso/IndexedDB dirty checks read.
    test("a rejected mutation writes neither slice", () => {
      const { result } = renderHook(() => useWorkspace(), { wrapper });

      const before = result.current.documents;
      let rejected: readonly string[] = [];
      act(() => {
        const res = result.current.mutateDocuments({ kind: "rename", id: 999, title: "X" }, "ai");
        rejected = res.rejected;
        expect(res.changed).toBe(false);
      });

      expect(rejected).toEqual(["document #999 not found"]);
      expect(result.current.documents).toBe(before);
      expect(result.current.documentVersions).toEqual([]);
    });
  });
});
