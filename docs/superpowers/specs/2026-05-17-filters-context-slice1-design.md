# Slice 1 — FiltersProvider (Filters Context)

**Date:** 2026-05-17
**Slice:** 1 of 3 in the `task-manager.tsx` decomposition (item #4 of the
2026-05-17 frontend-patterns review).
**Subsequent slices:** Slice 2 — WorkspaceProvider (data layer, unlocks row
memoization); Slice 3 — TaskFormProvider (add/edit/bulk-edit drafts).

## Problem

`src/app/task-manager.tsx` is a 4,613-line client component holding ~40
`useState` calls. Eight of them are filter/sort state:

| State | Type | Purpose |
|---|---|---|
| `search` | `string` | Search input (immediate) |
| `searchDebounced` | derived | Mirror of `search` after 150ms quiet — read by the filter useMemo |
| `priorityFilter` | `Priority \| "All"` | Header chip |
| `assigneeFilter` | `string` | Header chip |
| `groupFilter` | `string` | Header chip |
| `labelFilter` | `string` | Header chip |
| `sortKey` | `SortKey` | Sortable-header click |
| `sortDir` | `SortDir` | Sortable-header click |
| `raidFilterTaskId` | `number \| null` | Set by task row clicking the RAID badge |

Every keystroke and every chip click re-renders the entire 4,613-line
component. Slice 2 plans to unlock row-level `React.memo`; that's only
viable once filter and data state aren't both interleaved in the same
component scope.

## Goal

Move the eight filter state slices out of `task-manager.tsx` into a
shared React context, with no observable behaviour change. This is a
pure refactor: the filter UI, the `filteredTasks` derivation, and all
event handlers stay in their current files. Only the *ownership* of the
state moves.

## Non-goals

- Toolbar / filter-chip component extraction. UI stays inline.
- Reducer pattern. The setters are trivial and independent; multiple
  `useState` inside the provider is simpler.
- Row memoization. That's Slice 2's deliverable.
- Threading `raidFilterTaskId` through context all the way into
  `RaidPanel`. The panel is dynamic-imported and reaching the context
  from its tree requires hoisting the provider above the `dynamic()`
  boundary — bigger scope than this slice. `RaidPanel` keeps its
  current prop-based access; `task-manager.tsx` reads
  `raidFilterTaskId` from `useFilters()` and passes it down as a prop.

## Architecture

### New file: `src/app/filters-context.tsx`

Shape (illustrative — exact types come from existing task-manager.tsx
definitions):

```ts
"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useDebounce } from "./use-debounce";
import { type Priority } from "./types";

// SortKey and SortDir are currently declared inside task-manager.tsx
// (lines 224-232). They move to filters-context (the new owner of sort
// state) so task-manager and any future consumer import them from the
// same place.
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
  searchDebounced: string;          // useDebounce(search, 150)
  priorityFilter: Priority | "All";
  assigneeFilter: string;            // "All" | specific name
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

  // Note: the value object identity changes on every render (new object
  // literal each time). That's intentional for Slice 1 — consumers are
  // still colocated in task-manager.tsx so they re-render with it
  // anyway. Slice 2 will introduce value/setter splits if needed.
  const value: FiltersValue = {
    search, searchDebounced, priorityFilter, assigneeFilter,
    groupFilter, labelFilter, sortKey, sortDir, raidFilterTaskId,
    setSearch, setPriorityFilter, setAssigneeFilter, setGroupFilter,
    setLabelFilter, setSortKey, setSortDir, setRaidFilterTaskId,
    resetFilters,
  };

  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
}

export function useFilters(): FiltersValue {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error("useFilters must be used within FiltersProvider");
  return ctx;
}
```

### Change to `src/app/task-manager.tsx`

1. The `TaskManager` default export becomes a thin wrapper:

   ```tsx
   export default function TaskManager() {
     return (
       <FiltersProvider>
         <TaskManagerInner />
       </FiltersProvider>
     );
   }
   ```

   The current body moves into a new local `TaskManagerInner`
   component. This is necessary because `useFilters()` can't be called
   from the same component that renders `<FiltersProvider>`.

2. Inside `TaskManagerInner`:
   - Delete the 8 filter `useState` calls (currently around lines
     486–502).
   - Delete the `useDebounce(search, 150)` line (it moves into the
     provider).
   - Add at the top of the body:
     ```ts
     const {
       search, searchDebounced, priorityFilter, assigneeFilter,
       groupFilter, labelFilter, sortKey, sortDir, raidFilterTaskId,
       setSearch, setPriorityFilter, setAssigneeFilter, setGroupFilter,
       setLabelFilter, setSortKey, setSortDir, setRaidFilterTaskId,
       resetFilters,
     } = useFilters();
     ```
   - Every existing in-file reference to those variables keeps working
     unchanged.

### Files affected

| File | Change |
|---|---|
| `src/app/filters-context.tsx` | **NEW** ~90 lines |
| `src/app/filters-context.test.tsx` | **NEW** ~80 lines, ~6 tests |
| `src/app/task-manager.tsx` | −20 / +15 lines (state delete, wrapper, destructure) |
| `src/app/use-debounce.ts` | No change — the search debounce just moves to a different caller |

## Testing

`src/app/filters-context.test.tsx` covers:

1. **Default state** — render `<FiltersProvider>` + a probe; assert all
   defaults (`""`, `"All"`, `"id"`, `"asc"`, `null`).
2. **Setters update state** — call `setPriorityFilter("High")` via
   `act()`; assert next render exposes `"High"`.
3. **`searchDebounced` lags `search`** — use `vi.useFakeTimers()`;
   `setSearch("x")`, assert `searchDebounced === ""` before timer
   advances 150 ms, then `"x"` after.
4. **`resetFilters()`** — mutate several fields, call reset, assert
   defaults.
5. **`useFilters()` outside provider throws** — render bare consumer,
   expect the documented error.
6. **`raidFilterTaskId` setter** — covered for completeness since this
   is the slice consumers (RaidPanel) still rely on.

No additional task-manager-level tests in this slice. Task-manager
tests come later — likely in Slice 3 once the form is extractable.

## Verification

- `npm run build` — TypeScript clean, Next 16 bundles successfully.
- `npx vitest run` — full suite green, with 6 new tests added.
- **Manual smoke (uncommitted):** type in the search box and confirm
  the filtered list still updates after the 150 ms pause; click a
  priority chip and confirm filtering still works; click a task's RAID
  badge and confirm `RaidPanel` still shows the filter.

## Risk & rollback

The change is mechanical: state ownership moves; references don't. The
worst plausible failure is a TypeScript error or a missed reference
that breaks compilation — both caught immediately by `npm run build`.

Rollback: `git revert` the single commit. No data migration, no
storage-format change, no API change to consumer components.

## What this unlocks

- **Slice 2 (WorkspaceProvider):** can wrap `FiltersProvider` from
  above and combine its outputs with workspace data. `filteredTasks`
  derivation can move into the data provider, freeing rows to be
  `React.memo`-able.
- **Pattern consistency:** establishes the
  `*-context.tsx` + `use*()` shape that Slices 2 and 3 will mirror.
