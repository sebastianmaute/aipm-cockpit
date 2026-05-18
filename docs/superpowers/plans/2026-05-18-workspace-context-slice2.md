# WorkspaceProvider (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `tasks` and its derivations (`uniqueAssignees`, `uniqueGroups`, `uniqueLabels`, `tasksById`, `taskSearchIndex`, `filteredSortedTasks`) out of `src/app/task-manager.tsx` into a new `WorkspaceProvider` context. Pure refactor; no observable behaviour change. Spec: `docs/superpowers/specs/2026-05-18-workspace-context-slice2-design.md`.

**Architecture:** New module `src/app/workspace-context.tsx` exports `WorkspaceProvider` (one `useState<Task[]>` + six `useMemo`s, reading filter values via `useFilters()`) and `useWorkspace()` (throws outside provider). `TaskManager` default export wraps `<FiltersProvider><WorkspaceProvider><TaskManagerInner /></WorkspaceProvider></FiltersProvider>`. `TaskManagerInner` destructures from both `useFilters()` and `useWorkspace()`. The shared constant `PRIORITY_RANK` moves to `src/app/types.ts` first so both modules can import it.

**Tech Stack:** React 19 + Next 16 (App Router, `"use client"`); TypeScript; Vitest 3 + `@testing-library/react`. Reuses Slice 1's `FiltersProvider`.

---

## File Structure

| File | Role |
|---|---|
| `src/app/types.ts` | Modified — `PRIORITY_RANK` constant moves here from `task-manager.tsx` |
| `src/app/workspace-context.tsx` | **NEW** — Context, Provider, hook |
| `src/app/workspace-context.test.tsx` | **NEW** — Vitest suite, 5 tests |
| `src/app/task-manager.tsx` | Modified — delete `tasks` useState + 6 memos, add `useWorkspace()` destructure, remove `PRIORITY_RANK` const, wrap inner with `<WorkspaceProvider>` |

---

## Task 1: Relocate PRIORITY_RANK to types.ts

**Files:**
- Modify: `src/app/types.ts`
- Modify: `src/app/task-manager.tsx`

This is a precondition: the lifted `filteredSortedTasks` memo references `PRIORITY_RANK`, which is currently a module-private const in `task-manager.tsx`. Moving it to `types.ts` (next to the `Priority` type it ranks) keeps the import graph acyclic.

No unit tests in this task — the existing `vitest run` + `npm run build` are sufficient verification because the constant's value and shape don't change.

- [ ] **Step 1: Add PRIORITY_RANK to types.ts**

In `src/app/types.ts`, immediately after the `Priority` type declaration (line 1), insert:

```ts
export const PRIORITY_RANK: Record<Priority, number> = {
  Low: 0,
  Medium: 1,
  High: 2,
  Urgent: 3,
};
```

- [ ] **Step 2: Replace task-manager.tsx's local const with an import**

In `src/app/task-manager.tsx`:

1. Find the existing `PRIORITY_RANK` declaration (currently around line 293):

   ```tsx
   const PRIORITY_RANK: Record<Priority, number> = {
     Low: 0,
     Medium: 1,
     High: 2,
     Urgent: 3,
   };
   ```

   Delete it.

2. Find the existing `Priority` import from `./types`. It currently looks like:

   ```tsx
   import { ... type Priority ... } from "./types";
   ```

   Add `PRIORITY_RANK` to the same import statement so it becomes:

   ```tsx
   import { ... PRIORITY_RANK, type Priority ... } from "./types";
   ```

   (Keep existing members; just add `PRIORITY_RANK` to the named imports.)

- [ ] **Step 3: Verify build and tests**

Run: `npm run build`
Expected: `✓ Compiled successfully` + `Finished TypeScript`. No warnings.

Run: `npx vitest run`
Expected: All 42 existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/types.ts src/app/task-manager.tsx
git commit -m "refactor(types): move PRIORITY_RANK from task-manager to types"
```

---

## Task 2: Scaffold WorkspaceProvider with default state

**Files:**
- Create: `src/app/workspace-context.tsx`
- Create: `src/app/workspace-context.test.tsx`
- Test: `src/app/workspace-context.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/workspace-context.test.tsx`:

```tsx
import { describe, test, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";

function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
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
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/workspace-context.test.tsx`
Expected: FAIL with module resolution error (`Cannot find module './workspace-context'`).

- [ ] **Step 3: Write minimal implementation**

Create `src/app/workspace-context.tsx`:

```tsx
"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useFilters } from "./filters-context";
import { PRIORITY_RANK, type Task } from "./types";

interface WorkspaceValue {
  tasks: Task[];
  setTasks: Dispatch<SetStateAction<Task[]>>;

  uniqueAssignees: string[];
  uniqueGroups: string[];
  uniqueLabels: string[];
  tasksById: Map<number, Task>;
  taskSearchIndex: Map<number, string>;

  filteredSortedTasks: Task[];
}

const WorkspaceContext = createContext<WorkspaceValue | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const {
    searchDebounced,
    priorityFilter,
    assigneeFilter,
    groupFilter,
    labelFilter,
    sortKey,
    sortDir,
  } = useFilters();

  const uniqueAssignees = useMemo(
    () =>
      Array.from(new Set(tasks.map((t) => t.assignee))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [tasks],
  );

  const uniqueGroups = useMemo(
    () =>
      Array.from(
        new Set(tasks.map((t) => (t.group ?? "").trim()).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b)),
    [tasks],
  );

  const uniqueLabels = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      for (const l of t.labels ?? []) {
        const clean = l.trim();
        if (clean) set.add(clean);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  const tasksById = useMemo(() => {
    const m = new Map<number, Task>();
    for (const t of tasks) m.set(t.id, t);
    return m;
  }, [tasks]);

  const taskSearchIndex = useMemo(() => {
    const map = new Map<number, string>();
    for (const t of tasks) {
      map.set(
        t.id,
        [
          `#${t.id}`,
          t.taskName,
          t.assignee,
          t.blockers,
          t.notes,
          t.group ?? "",
          (t.labels ?? []).join(" "),
        ]
          .join(" ")
          .toLowerCase(),
      );
    }
    return map;
  }, [tasks]);

  const filteredSortedTasks = useMemo(() => {
    const q = searchDebounced.trim().toLowerCase();
    const filtered = tasks.filter((t) => {
      if (priorityFilter !== "All" && t.priority !== priorityFilter)
        return false;
      if (assigneeFilter !== "All" && t.assignee !== assigneeFilter)
        return false;
      if (groupFilter !== "All" && (t.group ?? "") !== groupFilter)
        return false;
      if (
        labelFilter !== "All" &&
        !(t.labels ?? []).some(
          (l) => l.toLowerCase() === labelFilter.toLowerCase(),
        )
      )
        return false;
      if (q) {
        const haystack = taskSearchIndex.get(t.id) ?? "";
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    return filtered.slice().sort((a, b) => {
      let cmp = 0;
      if (sortKey === "id") cmp = a.id - b.id;
      else if (sortKey === "priority")
        cmp = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      else if (sortKey === "startDate") {
        const av = a.startDate ?? "";
        const bv = b.startDate ?? "";
        if (av && !bv) cmp = -1;
        else if (!av && bv) cmp = 1;
        else if (!av && !bv) cmp = 0;
        else cmp = av.localeCompare(bv);
      } else cmp = a[sortKey].localeCompare(b[sortKey]);
      return cmp * dir;
    });
  }, [
    tasks,
    taskSearchIndex,
    searchDebounced,
    priorityFilter,
    assigneeFilter,
    groupFilter,
    labelFilter,
    sortKey,
    sortDir,
  ]);

  const value: WorkspaceValue = {
    tasks,
    setTasks,
    uniqueAssignees,
    uniqueGroups,
    uniqueLabels,
    tasksById,
    taskSearchIndex,
    filteredSortedTasks,
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceValue {
  const ctx = useContext(WorkspaceContext);
  // Outside-provider behaviour is tightened in Task 6.
  return ctx as WorkspaceValue;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/workspace-context.test.tsx`
Expected: PASS — 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/app/workspace-context.tsx src/app/workspace-context.test.tsx
git commit -m "feat(workspace-context): scaffold WorkspaceProvider + default state test"
```

---

## Task 3: setTasks updates state and rebuilds derivations

**Files:**
- Modify: `src/app/workspace-context.test.tsx`

- [ ] **Step 1: Write the failing test**

Add `act` to the `@testing-library/react` import at the top of `src/app/workspace-context.test.tsx`:

```tsx
import { renderHook, act } from "@testing-library/react";
```

Append a new `Task` factory helper just above the `describe` block:

```tsx
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
```

Append inside the existing `describe("WorkspaceProvider", ...)` block, before the closing `})`:

```tsx
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
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/app/workspace-context.test.tsx`
Expected: PASS — 2 tests. (The provider already builds these derivations from Task 2's scaffold; this test verifies behaviour.)

- [ ] **Step 3: Commit**

```bash
git add src/app/workspace-context.test.tsx
git commit -m "test(workspace-context): cover setTasks + tasks-derived memos"
```

---

## Task 4: filteredSortedTasks reacts to FiltersProvider changes

**Files:**
- Modify: `src/app/workspace-context.test.tsx`

- [ ] **Step 1: Write the failing test**

We need a test that mutates filter state while observing workspace output. The cleanest approach is to render a combined probe via `renderHook` that returns both contexts so the test can call setters on one and observe the other.

Add the `useFilters` import at the top of the test file:

```tsx
import { FiltersProvider, useFilters } from "./filters-context";
```

Then append the test inside the `describe("WorkspaceProvider", ...)` block:

```tsx
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
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/app/workspace-context.test.tsx`
Expected: PASS — 3 tests. (The `filteredSortedTasks` `useMemo` already depends on `priorityFilter` from Task 2's scaffold; this validates the wiring.)

- [ ] **Step 3: Commit**

```bash
git add src/app/workspace-context.test.tsx
git commit -m "test(workspace-context): verify filteredSortedTasks reacts to FiltersProvider"
```

---

## Task 5: Sort key/dir toggle reorders filteredSortedTasks

**Files:**
- Modify: `src/app/workspace-context.test.tsx`

- [ ] **Step 1: Write the failing test**

Append inside the `describe("WorkspaceProvider", ...)` block:

```tsx
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
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/app/workspace-context.test.tsx`
Expected: PASS — 4 tests.

- [ ] **Step 3: Commit**

```bash
git add src/app/workspace-context.test.tsx
git commit -m "test(workspace-context): cover sortKey/sortDir reordering"
```

---

## Task 6: useWorkspace() outside a provider throws

**Files:**
- Modify: `src/app/workspace-context.tsx`
- Modify: `src/app/workspace-context.test.tsx`

- [ ] **Step 1: Write the failing test**

Append inside the `describe("WorkspaceProvider", ...)` block:

```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/workspace-context.test.tsx`
Expected: FAIL — the hook currently casts `undefined` to `WorkspaceValue`, so `renderHook(...)` does not throw the specific message yet.

- [ ] **Step 3: Implement the guard**

In `src/app/workspace-context.tsx`, replace the body of `useWorkspace`:

```tsx
export function useWorkspace(): WorkspaceValue {
  const ctx = useContext(WorkspaceContext);
  // Outside-provider behaviour is tightened in Task 6.
  return ctx as WorkspaceValue;
}
```

with:

```tsx
export function useWorkspace(): WorkspaceValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/workspace-context.test.tsx`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/workspace-context.tsx src/app/workspace-context.test.tsx
git commit -m "feat(workspace-context): throw when useWorkspace() runs outside provider"
```

---

## Task 7: Migrate task-manager.tsx to consume WorkspaceProvider

**Files:**
- Modify: `src/app/task-manager.tsx`

No new unit tests in this task. Verification is build + full suite + manual smoke. The existing 5 filters-context tests + 5 new workspace-context tests already cover the data + filter join end-to-end.

- [ ] **Step 1: Add the WorkspaceProvider + useWorkspace import**

In `src/app/task-manager.tsx`, find the existing `filters-context` import:

```tsx
import {
  FiltersProvider,
  type SortDir,
  type SortKey,
  useFilters,
} from "./filters-context";
```

Add a sibling import just below it:

```tsx
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
```

- [ ] **Step 2: Delete the local `tasks` useState**

In `src/app/task-manager.tsx`, find:

```tsx
  const [tasks, setTasks] = useState<Task[]>([]);
```

(currently around line 414, inside `TaskManagerInner`). Delete the line. The replacement destructure goes in Step 4.

- [ ] **Step 3: Delete the six relocated useMemo blocks**

In `src/app/task-manager.tsx`, find and delete the following six `useMemo` declarations inside `TaskManagerInner` (currently around lines 1236–1356). Search by content, not by line number — line numbers shift as edits accumulate.

1. `uniqueAssignees` (`useMemo(() => Array.from(new Set(tasks.map(...))).sort(...), [tasks])`)
2. `uniqueGroups` (same shape, filtering trimmed group names)
3. `uniqueLabels` (set of trimmed label strings from all tasks)
4. `tasksById` (`Map<number, Task>` index)
5. `taskSearchIndex` (lowercased haystack per task)
6. `filteredSortedTasks` (the filter + sort pipeline)

Delete each entire `const X = useMemo(...)` declaration through to its closing `);`. Keep the rest of the function body intact, including the `toggleSort` helper that follows `filteredSortedTasks`.

- [ ] **Step 4: Add the useWorkspace() destructure**

In `src/app/task-manager.tsx`, find the existing `useFilters()` destructure inside `TaskManagerInner` (added in Slice 1; search for `} = useFilters();`).

Immediately after that destructure block, add:

```tsx
  // Tasks data + derivations owned by WorkspaceProvider (Slice 2 of the
  // task-manager decomposition; see
  // docs/superpowers/specs/2026-05-18-workspace-context-slice2-design.md).
  // The default export wraps this component in <WorkspaceProvider> inside
  // <FiltersProvider>.
  const {
    tasks,
    setTasks,
    uniqueAssignees,
    uniqueGroups,
    uniqueLabels,
    tasksById,
    taskSearchIndex,
    filteredSortedTasks,
  } = useWorkspace();
```

Every existing reference to these names elsewhere in the file keeps working unchanged.

- [ ] **Step 5: Update the default export to wrap with WorkspaceProvider**

Find the current default export at the bottom of the file:

```tsx
export default function TaskManager() {
  return (
    <FiltersProvider>
      <TaskManagerInner />
    </FiltersProvider>
  );
}
```

Replace it with:

```tsx
export default function TaskManager() {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <TaskManagerInner />
      </WorkspaceProvider>
    </FiltersProvider>
  );
}
```

- [ ] **Step 6: Build to verify TypeScript and Next compilation**

Run: `npm run build`
Expected: `✓ Compiled successfully` + `Finished TypeScript`. No new warnings.

If TypeScript complains about an undefined `tasks`, `setTasks`, or one of the derived names, you missed a step — the destructure in Step 4 must come *before* the first usage of any of these names. The destructure should sit right after `useFilters()` near the top of `TaskManagerInner`'s body.

- [ ] **Step 7: Run the full test suite**

Run: `npx vitest run`
Expected: All tests pass — existing 42 + 5 new workspace-context tests = 47. Total 7 test files.

- [ ] **Step 8: Manual smoke (uncommitted)**

Run: `npm run dev`. Open `http://localhost:3000`. Verify:

1. **Search debounce:** type a query in the search box. The task list updates after ~150 ms.
2. **Priority filter:** pick a priority. List narrows.
3. **Group / Label / Assignee filter:** each narrows the list.
4. **Sortable column header:** click. Sort direction toggles.
5. **RAID badge:** click a task row's RAID badge. RaidPanel opens with the task filter applied; clear-filter still works.
6. **Edit a task:** open Edit, change a field, save. The row updates immediately (verifies `setTasks` still flows from the form handler through the context).
7. **Cross-window sync (optional):** open the app in a second tab. Edit a task in tab A. Confirm tab B updates within ~1 second (verifies broadcast-sync still calls `setTasks` through the context).

Stop the dev server.

- [ ] **Step 9: Commit**

```bash
git add src/app/task-manager.tsx
git commit -m "refactor(task-manager): consume WorkspaceProvider for tasks + derivations"
```

---

## Done

After Task 7:

- `src/app/workspace-context.tsx` owns `tasks` and all 6 tasks-derived memos including `filteredSortedTasks`.
- `src/app/task-manager.tsx` is ~80 lines shorter and no longer manages `tasks` or any of its derivations inline.
- Five new tests in `src/app/workspace-context.test.tsx`.
- Existing test suite still green; new total 47 tests across 7 files.
- `PRIORITY_RANK` now lives in `src/app/types.ts` alongside `Priority`.
- Slice 2b (row memoization) can now extract a `<TaskRow>` component that reads from `useWorkspace()` and is wrapped in `React.memo`.
