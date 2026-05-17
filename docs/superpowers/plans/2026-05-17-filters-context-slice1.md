# FiltersProvider (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the 8 filter/sort `useState` calls out of `src/app/task-manager.tsx` into a shared `FiltersProvider` context, with zero observable behaviour change. Spec: `docs/superpowers/specs/2026-05-17-filters-context-slice1-design.md`.

**Architecture:** New module `src/app/filters-context.tsx` exports a `FiltersProvider` (multiple `useState` slices + a derived `searchDebounced` via `useDebounce`) and a `useFilters()` hook that throws when called outside the provider. `task-manager.tsx` is split into a thin `TaskManager` wrapper (renders `<FiltersProvider>`) and a `TaskManagerInner` component that consumes the context. No UI moves; only state ownership.

**Tech Stack:** React 19 + Next 16 (App Router, `"use client"`); TypeScript; Vitest 3 + `@testing-library/react`. Existing `useDebounce` hook at `src/app/use-debounce.ts`.

---

## File Structure

| File | Role |
|---|---|
| `src/app/filters-context.tsx` | **NEW** — Context, Provider, hook, SortKey/SortDir types |
| `src/app/filters-context.test.tsx` | **NEW** — Vitest suite for the provider+hook |
| `src/app/task-manager.tsx` | Modified — type declarations move out, state replaced by `useFilters()`, default export wraps in provider |

---

## Task 1: Scaffold context with default state

**Files:**
- Create: `src/app/filters-context.tsx`
- Create: `src/app/filters-context.test.tsx`
- Test: `src/app/filters-context.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/filters-context.test.tsx`:

```tsx
import { describe, test, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import { FiltersProvider, useFilters } from "./filters-context";

function wrapper({ children }: { children: ReactNode }) {
  return <FiltersProvider>{children}</FiltersProvider>;
}

describe("FiltersProvider", () => {
  test("exposes the documented defaults", () => {
    const { result } = renderHook(() => useFilters(), { wrapper });
    expect(result.current.search).toBe("");
    expect(result.current.searchDebounced).toBe("");
    expect(result.current.priorityFilter).toBe("All");
    expect(result.current.assigneeFilter).toBe("All");
    expect(result.current.groupFilter).toBe("All");
    expect(result.current.labelFilter).toBe("All");
    expect(result.current.sortKey).toBe("id");
    expect(result.current.sortDir).toBe("asc");
    expect(result.current.raidFilterTaskId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/filters-context.test.tsx`
Expected: FAIL with module resolution error (`Cannot find module './filters-context'`).

- [ ] **Step 3: Write minimal implementation**

Create `src/app/filters-context.tsx`:

```tsx
"use client";

import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { useDebounce } from "./use-debounce";
import { type Priority } from "./types";

// Owned here because filters-context is the new owner of sort state.
// Importers in task-manager (and any future consumer) read these from
// here so the type and the state co-locate.
export type SortKey =
  | "id"
  | "taskName"
  | "assignee"
  | "startDate"
  | "dueDate"
  | "lastUpdateDate"
  | "priority";
export type SortDir = "asc" | "desc";

interface FiltersValue {
  search: string;
  searchDebounced: string;
  priorityFilter: Priority | "All";
  assigneeFilter: string;
  groupFilter: string;
  labelFilter: string;
  sortKey: SortKey;
  sortDir: SortDir;
  raidFilterTaskId: number | null;

  setSearch: (v: string) => void;
  setPriorityFilter: (v: Priority | "All") => void;
  setAssigneeFilter: (v: string) => void;
  setGroupFilter: (v: string) => void;
  setLabelFilter: (v: string) => void;
  setSortKey: (v: SortKey) => void;
  setSortDir: (v: SortDir) => void;
  setRaidFilterTaskId: (v: number | null) => void;

  resetFilters: () => void;
}

const FiltersContext = createContext<FiltersValue | undefined>(undefined);

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [search, setSearch] = useState("");
  const searchDebounced = useDebounce(search, 150);
  const [priorityFilter, setPriorityFilter] = useState<Priority | "All">("All");
  const [assigneeFilter, setAssigneeFilter] = useState("All");
  const [groupFilter, setGroupFilter] = useState("All");
  const [labelFilter, setLabelFilter] = useState("All");
  const [sortKey, setSortKey] = useState<SortKey>("id");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [raidFilterTaskId, setRaidFilterTaskId] = useState<number | null>(null);

  const value: FiltersValue = {
    search,
    searchDebounced,
    priorityFilter,
    assigneeFilter,
    groupFilter,
    labelFilter,
    sortKey,
    sortDir,
    raidFilterTaskId,
    setSearch,
    setPriorityFilter,
    setAssigneeFilter,
    setGroupFilter,
    setLabelFilter,
    setSortKey,
    setSortDir,
    setRaidFilterTaskId,
    resetFilters: () => {
      // Placeholder — fleshed out in Task 3.
    },
  };

  return (
    <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>
  );
}

export function useFilters(): FiltersValue {
  const ctx = useContext(FiltersContext);
  // Outside-provider behaviour is tightened in Task 5.
  return ctx as FiltersValue;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/filters-context.test.tsx`
Expected: PASS — 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/app/filters-context.tsx src/app/filters-context.test.tsx
git commit -m "feat(filters-context): scaffold FiltersProvider + default state test"
```

---

## Task 2: Setters update state

**Files:**
- Modify: `src/app/filters-context.test.tsx`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("FiltersProvider", ...)` block, before the closing `})`:

```tsx
  test("each setter updates the corresponding slice", () => {
    const { result } = renderHook(() => useFilters(), { wrapper });

    act(() => result.current.setSearch("hello"));
    expect(result.current.search).toBe("hello");

    act(() => result.current.setPriorityFilter("High"));
    expect(result.current.priorityFilter).toBe("High");

    act(() => result.current.setAssigneeFilter("Alex Example"));
    expect(result.current.assigneeFilter).toBe("Alex Example");

    act(() => result.current.setGroupFilter("Auth Migration"));
    expect(result.current.groupFilter).toBe("Auth Migration");

    act(() => result.current.setLabelFilter("backend"));
    expect(result.current.labelFilter).toBe("backend");

    act(() => result.current.setSortKey("dueDate"));
    expect(result.current.sortKey).toBe("dueDate");

    act(() => result.current.setSortDir("desc"));
    expect(result.current.sortDir).toBe("desc");

    act(() => result.current.setRaidFilterTaskId(42));
    expect(result.current.raidFilterTaskId).toBe(42);

    act(() => result.current.setRaidFilterTaskId(null));
    expect(result.current.raidFilterTaskId).toBeNull();
  });
```

Add `act` to the imports at the top of the file:

```tsx
import { renderHook, act } from "@testing-library/react";
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/app/filters-context.test.tsx`
Expected: PASS — 2 tests. (The setters already exist from Task 1's scaffold; this is a behaviour check.)

- [ ] **Step 3: Commit**

```bash
git add src/app/filters-context.test.tsx
git commit -m "test(filters-context): cover all setter mutations"
```

---

## Task 3: resetFilters returns to defaults

**Files:**
- Modify: `src/app/filters-context.tsx`
- Modify: `src/app/filters-context.test.tsx`

- [ ] **Step 1: Write the failing test**

Append inside the `describe("FiltersProvider", ...)` block:

```tsx
  test("resetFilters returns every slice to its default", () => {
    const { result } = renderHook(() => useFilters(), { wrapper });

    act(() => {
      result.current.setSearch("hello");
      result.current.setPriorityFilter("High");
      result.current.setAssigneeFilter("Alex Example");
      result.current.setGroupFilter("Auth Migration");
      result.current.setLabelFilter("backend");
      result.current.setSortKey("dueDate");
      result.current.setSortDir("desc");
      result.current.setRaidFilterTaskId(42);
    });

    act(() => result.current.resetFilters());

    expect(result.current.search).toBe("");
    expect(result.current.priorityFilter).toBe("All");
    expect(result.current.assigneeFilter).toBe("All");
    expect(result.current.groupFilter).toBe("All");
    expect(result.current.labelFilter).toBe("All");
    expect(result.current.sortKey).toBe("id");
    expect(result.current.sortDir).toBe("asc");
    expect(result.current.raidFilterTaskId).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/filters-context.test.tsx`
Expected: FAIL — the resetFilters from Task 1 is a no-op placeholder, so the first assertion (`search === ""`) fails because state is still `"hello"`.

- [ ] **Step 3: Implement resetFilters**

In `src/app/filters-context.tsx`, replace the React import line:

```tsx
import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";
```

with:

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
```

Inside `FiltersProvider`, **before** the `const value` declaration, add:

```tsx
  const resetFilters = useCallback(() => {
    setSearch("");
    setPriorityFilter("All");
    setAssigneeFilter("All");
    setGroupFilter("All");
    setLabelFilter("All");
    setSortKey("id");
    setSortDir("asc");
    setRaidFilterTaskId(null);
  }, []);
```

Then in the `value` object, replace:

```tsx
    resetFilters: () => {
      // Placeholder — fleshed out in Task 3.
    },
```

with:

```tsx
    resetFilters,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/filters-context.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/filters-context.tsx src/app/filters-context.test.tsx
git commit -m "feat(filters-context): implement resetFilters"
```

---

## Task 4: searchDebounced lags search by 150 ms

**Files:**
- Modify: `src/app/filters-context.test.tsx`

- [ ] **Step 1: Write the failing test**

Add `beforeEach`/`afterEach` to the vitest imports at the top of the test file:

```tsx
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
```

Add fake-timer hooks just above the `describe` block:

```tsx
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});
```

Append inside the `describe("FiltersProvider", ...)` block:

```tsx
  test("searchDebounced lags search by 150 ms", () => {
    const { result } = renderHook(() => useFilters(), { wrapper });
    expect(result.current.searchDebounced).toBe("");

    act(() => result.current.setSearch("hello"));
    // Same tick — searchDebounced has not yet caught up.
    expect(result.current.search).toBe("hello");
    expect(result.current.searchDebounced).toBe("");

    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(result.current.searchDebounced).toBe("");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.searchDebounced).toBe("hello");
  });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/app/filters-context.test.tsx`
Expected: PASS — 4 tests. The debouncing already works from Task 1's scaffold (via `useDebounce`); this test validates the contract.

- [ ] **Step 3: Commit**

```bash
git add src/app/filters-context.test.tsx
git commit -m "test(filters-context): verify searchDebounced 150 ms lag"
```

---

## Task 5: useFilters() outside a provider throws

**Files:**
- Modify: `src/app/filters-context.tsx`
- Modify: `src/app/filters-context.test.tsx`

- [ ] **Step 1: Write the failing test**

Append inside the `describe("FiltersProvider", ...)` block:

```tsx
  test("useFilters() outside a FiltersProvider throws a documented error", () => {
    // React logs the rendering error to console.error in dev; silence it
    // so the test output stays clean. Restore after to avoid hiding
    // unrelated noise from later tests.
    const original = console.error;
    console.error = () => {};
    try {
      expect(() => renderHook(() => useFilters())).toThrow(
        "useFilters must be used within FiltersProvider",
      );
    } finally {
      console.error = original;
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/filters-context.test.tsx`
Expected: FAIL — the hook currently casts `undefined` to `FiltersValue`, so `renderHook(...)` itself does not throw the specific message we want.

- [ ] **Step 3: Implement the guard**

In `src/app/filters-context.tsx`, replace the body of `useFilters`:

```tsx
export function useFilters(): FiltersValue {
  const ctx = useContext(FiltersContext);
  // Outside-provider behaviour is tightened in Task 5.
  return ctx as FiltersValue;
}
```

with:

```tsx
export function useFilters(): FiltersValue {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error("useFilters must be used within FiltersProvider");
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/filters-context.test.tsx`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/filters-context.tsx src/app/filters-context.test.tsx
git commit -m "feat(filters-context): throw when useFilters() runs outside provider"
```

---

## Task 6: Migrate task-manager.tsx to consume FiltersProvider

**Files:**
- Modify: `src/app/task-manager.tsx`

This task has no new unit tests — `task-manager.tsx` has no test coverage of its own (intentional per the spec; tests come in Slice 3). Verification is build + full suite + manual smoke.

- [ ] **Step 1: Remove the local SortKey/SortDir type declarations**

In `src/app/task-manager.tsx`, find lines 224–232:

```tsx
type SortKey =
  | "id"
  | "taskName"
  | "assignee"
  | "startDate"
  | "dueDate"
  | "lastUpdateDate"
  | "priority";
type SortDir = "asc" | "desc";
```

Delete them. The types will be imported from `./filters-context` in the next step.

- [ ] **Step 2: Add the FiltersProvider + types import; remove unused useDebounce import**

Add this import near the other `./` imports in `src/app/task-manager.tsx`:

```tsx
import {
  FiltersProvider,
  type SortDir,
  type SortKey,
  useFilters,
} from "./filters-context";
```

Find and delete the now-unused `useDebounce` import (added in the prior session):

```tsx
import { useDebounce } from "./use-debounce";
```

If `useDebounce` is grouped with other imports, just remove that named import. There are no other callers of `useDebounce` in this file after this slice.

- [ ] **Step 3: Replace the 8 filter useState declarations + the inline useDebounce call**

In `src/app/task-manager.tsx`, find the block that currently looks like this (line numbers shift as edits accumulate; search by content):

```tsx
  const [search, setSearch] = useState("");
  // Debounced mirror of `search`. The filter useMemo reads this instead of
  // `search` directly, so re-filtering doesn't fire on every keystroke. The
  // input itself stays bound to `search` so it feels immediate.
  const searchDebounced = useDebounce(search, 150);
  const [priorityFilter, setPriorityFilter] = useState<Priority | "All">(
    "All",
  );
  const [assigneeFilter, setAssigneeFilter] = useState<string>("All");
  const [groupFilter, setGroupFilter] = useState<string>("All");
  const [labelFilter, setLabelFilter] = useState<string>("All");

  const [sortKey, setSortKey] = useState<SortKey>("id");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
```

Also find the `raidFilterTaskId` state declaration (currently around line 422):

```tsx
  const [raidFilterTaskId, setRaidFilterTaskId] = useState<number | null>(null);
```

Replace **both** blocks with a single destructure of `useFilters()`. Place the destructure where the first deleted block was:

```tsx
  // Filter / sort state owned by FiltersProvider (Slice 1 of the
  // task-manager decomposition; see
  // docs/superpowers/specs/2026-05-17-filters-context-slice1-design.md).
  // The default export wraps this component in <FiltersProvider>.
  const {
    search,
    searchDebounced,
    priorityFilter,
    assigneeFilter,
    groupFilter,
    labelFilter,
    sortKey,
    sortDir,
    raidFilterTaskId,
    setSearch,
    setPriorityFilter,
    setAssigneeFilter,
    setGroupFilter,
    setLabelFilter,
    setSortKey,
    setSortDir,
    setRaidFilterTaskId,
    resetFilters,
  } = useFilters();
```

Every existing reference to these names elsewhere in the file keeps working unchanged.

- [ ] **Step 4: Split the default export into wrapper + inner component**

Find the current default export (search for `export default function TaskManager`). Rename it to `TaskManagerInner`, then add a thin default export at the bottom of the file.

Change:

```tsx
export default function TaskManager() {
  // ... body of TaskManager (thousands of lines, unchanged) ...
}
```

to:

```tsx
function TaskManagerInner() {
  // ... body of TaskManager (thousands of lines, unchanged) ...
}

export default function TaskManager() {
  return (
    <FiltersProvider>
      <TaskManagerInner />
    </FiltersProvider>
  );
}
```

Note: the existing component takes no props (it is the top-level page client component). Confirm by inspecting the current signature before editing.

- [ ] **Step 5: Build to verify TypeScript and Next compilation**

Run: `npm run build`
Expected: `✓ Compiled successfully` + `Finished TypeScript`. No new warnings.

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: All tests pass, including the 5 new filters-context tests and the existing 37. Total: 42 tests across 6 files.

- [ ] **Step 7: Manual smoke (uncommitted)**

Run: `npm run dev`. Open `http://localhost:3000`. Verify:

1. Search box: type a query. The task list updates after ~150 ms (debounce behaviour preserved).
2. Priority chip: click it. Filtering still narrows the list.
3. Group / Label / Assignee filter: still works.
4. Sortable column header: click. Sort direction toggles.
5. Click a task row's RAID badge: RaidPanel opens with the task filter applied; clear-filter still works.

Stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add src/app/task-manager.tsx
git commit -m "refactor(task-manager): consume FiltersProvider for filter/sort state"
```

---

## Done

After Task 6:
- `src/app/filters-context.tsx` owns all filter/sort state.
- `src/app/task-manager.tsx` is ~25 lines shorter and no longer manages filter state inline.
- Five new tests in `src/app/filters-context.test.tsx`.
- Existing test suite still green.
- Next slice (WorkspaceProvider, item #4 Slice 2 in the prior review) can build on top by wrapping `<FiltersProvider>` from a higher provider.
