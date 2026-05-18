# Slice 2 — WorkspaceProvider (Workspace Context)

**Date:** 2026-05-18
**Slice:** 2 of 3 in the `task-manager.tsx` decomposition.
**Predecessor:** Slice 1 — FiltersProvider
(`docs/superpowers/specs/2026-05-17-filters-context-slice1-design.md`).
**Successor:** Slice 3 — TaskFormProvider (add/edit/bulk-edit drafts).
**Adjacent follow-up (not in this slice):** Slice 2b — extract a memo'd
`<TaskRow>` component now that data ownership is decoupled.

## Problem

After Slice 1, `task-manager.tsx` no longer holds filter state, but it
still owns every workspace data slice and every tasks-derived memo. The
critical join is `filteredSortedTasks` (`tasks × filter values →
visible rows`) which sits as a `useMemo` inside `TaskManagerInner`.
That coupling means:

- Any unrelated `useState` in `TaskManagerInner` (modal open, toast,
  bulk-edit draft, …) re-renders the same component that owns the row
  data, defeating any future `React.memo` on row components.
- The tasks-derived memos (`uniqueAssignees`, `uniqueGroups`,
  `uniqueLabels`, `tasksById`, `taskSearchIndex`) are colocated with
  the rest of `TaskManagerInner`, so consumers — including any future
  extracted `<TaskRow>` — would need to receive them as props.

Slice 1's spec named this slice's intent precisely: **"data layer,
unlocks row memoization. `filteredTasks` derivation can move into the
data provider, freeing rows to be `React.memo`-able."**

## Goal

Move `tasks` and its derivations out of `TaskManagerInner` into a new
`WorkspaceProvider`, with no observable behaviour change. This is a
pure refactor mirroring Slice 1: state ownership moves, no semantics
change.

## Non-goals

- **Row memoization.** Slice 2 is the enabler; the actual `<TaskRow>`
  extraction + `React.memo` wrapping is Slice 2b.
- **Moving `raid` / `absences` / `shifts` / `contacts`** and their
  derivations (`raidByTask`, `contactsList`). They stay in
  `TaskManagerInner` for this slice. A later slice can move them if a
  consumer outside `TaskManagerInner` ever needs them.
- **Reducer pattern.** A single `useState<Task[]>` plus existing
  updater-form callers is simpler than introducing reducer/action
  abstractions for one slice.
- **Performance benchmarking.** Success criterion is "no regression";
  perf wins land with row memo in Slice 2b.
- **Touching `FiltersProvider`.** Already settled in Slice 1.

## Architecture

### Provider composition

```
TaskManager (default export, thin wrapper)
  └ <FiltersProvider>
      └ <WorkspaceProvider>           NEW — reads useFilters() internally
          └ <TaskManagerInner>        already exists from Slice 1
```

WorkspaceProvider sits *inside* FiltersProvider so it can call
`useFilters()` to compute `filteredSortedTasks`. This ordering is a
documented dependency at the provider boundary and is caught
immediately by Slice 1's throw-outside-provider guard if reversed.

### New file: `src/app/workspace-context.tsx`

Shape (illustrative — exact types come from existing
`task-manager.tsx` definitions):

```ts
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
import { type Task } from "./types";

interface WorkspaceValue {
  // Data
  tasks: Task[];
  setTasks: Dispatch<SetStateAction<Task[]>>;

  // Pure-tasks derivations (memoized on [tasks])
  uniqueAssignees: string[];
  uniqueGroups: string[];
  uniqueLabels: string[];
  tasksById: Map<number, Task>;
  taskSearchIndex: Map<number, string>;

  // Cross-context derivation (memoized on [tasks, ...filter values])
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

  const uniqueAssignees = useMemo(/* ...same body as today */, [tasks]);
  const uniqueGroups    = useMemo(/* ...same body as today */, [tasks]);
  const uniqueLabels    = useMemo(/* ...same body as today */, [tasks]);
  const tasksById       = useMemo(/* ...same body as today */, [tasks]);
  const taskSearchIndex = useMemo(/* ...same body as today */, [tasks]);

  const filteredSortedTasks = useMemo(
    /* ...same body as today, reading the destructured filter values */,
    [
      tasks,
      taskSearchIndex,
      searchDebounced,
      priorityFilter,
      assigneeFilter,
      groupFilter,
      labelFilter,
      sortKey,
      sortDir,
    ],
  );

  const value: WorkspaceValue = {
    tasks, setTasks,
    uniqueAssignees, uniqueGroups, uniqueLabels,
    tasksById, taskSearchIndex,
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
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
```

The bodies of each `useMemo` are lifted verbatim from
`task-manager.tsx` (currently lines 1236–1330). No logic changes.

### Changes to `src/app/task-manager.tsx`

1. **Provider wrap.** The default export gains one more layer:

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

2. **Inside `TaskManagerInner`:**
   - Delete `const [tasks, setTasks] = useState<Task[]>([])` (currently
     line 414).
   - Delete the five tasks-derived `useMemo` blocks
     (`uniqueAssignees`, `uniqueGroups`, `uniqueLabels`, `tasksById`,
     `taskSearchIndex` — currently lines 1236–1303).
   - Delete `filteredSortedTasks` `useMemo` (currently lines
     1305–1330).
   - Add a destructure from `useWorkspace()` near the top of the body
     (right after the existing `useFilters()` destructure):

     ```ts
     const {
       tasks, setTasks,
       uniqueAssignees, uniqueGroups, uniqueLabels,
       tasksById, taskSearchIndex,
       filteredSortedTasks,
     } = useWorkspace();
     ```

   - Every existing in-file reference to those names keeps working
     unchanged.

### `setTasks` callers

`setTasks` is called from many sites inside `task-manager.tsx`:
storage hydration, broadcast-sync handlers, single-task edits, Jira
sync, bulk edits, RAID-driven updates, etc. Each call site simply
reads `setTasks` from the destructure now instead of from the local
`useState`. Updater-form callers (`setTasks(prev => …)`) work
unchanged because the setter type is
`Dispatch<SetStateAction<Task[]>>` — same widening Slice 1 settled on
for filter setters.

### Files affected

| File | Change |
|---|---|
| `src/app/workspace-context.tsx` | **NEW** ~110 lines |
| `src/app/workspace-context.test.tsx` | **NEW** ~120 lines, 5 tests |
| `src/app/task-manager.tsx` | net −80 / +15 lines (delete useState + 6 memos, add destructure + provider wrap) |
| `src/app/filters-context.tsx` | No change |

## Testing

`src/app/workspace-context.test.tsx`, follows the same shape as
`filters-context.test.tsx`:

1. **Default state.** Render `<FiltersProvider><WorkspaceProvider>` +
   a probe; assert `tasks === []`, `uniqueAssignees === []`,
   `uniqueGroups === []`, `uniqueLabels === []`, `tasksById.size ===
   0`, `taskSearchIndex.size === 0`, `filteredSortedTasks === []`.

2. **`setTasks` updates state and rebuilds derivations.** Seed three
   tasks with distinct assignees; assert `uniqueAssignees` contains
   all three sorted, `tasksById.get(seeded.id) === seeded`,
   `taskSearchIndex.get(seeded.id)` includes the lowercased task name.

3. **`filteredSortedTasks` reacts to FiltersProvider changes.** Seed
   three tasks with distinct priorities; act
   `setPriorityFilter("High")`; assert `filteredSortedTasks.length ===
   1` and only the High-priority task is included.

4. **Sort key/dir toggle reorders `filteredSortedTasks`.** Seed two
   tasks with distinct names; `setSortKey("taskName")` +
   `setSortDir("asc")` → first row's name < second's;
   `setSortDir("desc")` → reversed.

5. **`useWorkspace()` outside `WorkspaceProvider` throws.** Bare
   consumer (no provider); expect
   `"useWorkspace must be used within WorkspaceProvider"`.

No extra tests for the existing memos beyond what test #2 covers —
they're pure functions of `tasks` and the same code as today, just
relocated. The full filter pipeline is exercised end-to-end by test
#3.

## Verification

- `npm run build` — TypeScript clean, Next 16 bundles successfully.
- `npx vitest run` — full suite green (42 existing + 5 new = 47).
- **Manual smoke** — the five checks from the Slice 1 plan (search
  debounce, priority chip, group/label/assignee filter, sort toggle,
  RAID badge filter). They cover the data + filter join end-to-end,
  which is exactly the surface this slice changes.

## Risk & rollback

Mechanical refactor; same shape as Slice 1. State and derivations
relocate; their semantics don't change.

**Risks:**

- **Provider order.** WorkspaceProvider must sit inside FiltersProvider.
  Reversing breaks `useFilters()` inside WorkspaceProvider's render.
  Caught at first render by Slice 1's existing throw-outside-provider
  guard.
- **Missed `setTasks` call site.** ~30 call sites across
  `task-manager.tsx`. Each becomes `useWorkspace().setTasks`. A missed
  rename leaves `setTasks` undefined → TypeScript fails on the missing
  reference. Caught by `npm run build`.
- **`raid`-derived `raidByTask`** stays in `TaskManagerInner` and is
  consumed inside the row JSX. No cross-pollination because `raid`
  itself is not moved this slice.

**Rollback:** `git revert` the single commit. No storage-format
change, no API change, no migration.

## What this unlocks

- **Slice 2b (row memoization).** With `tasks` and
  `filteredSortedTasks` out of `TaskManagerInner`, the row JSX can be
  extracted to a `<TaskRow>` component that reads via `useWorkspace()`
  (or accepts its task as a prop) and is wrapped in `React.memo`.
  Inline callbacks become `useCallback`-stabilized.
- **Slice 3 (TaskFormProvider).** The add/edit/bulk-edit form drafts
  still live in `TaskManagerInner`. With data and filters now both
  in context, Slice 3 can finish the decomposition by lifting the
  form drafts to their own provider, leaving `TaskManagerInner` as
  pure layout + glue.
- **Pattern consistency.** Establishes the third `*-context.tsx` +
  `use*()` provider, all following the same shape (`Dispatch<SetStateAction>`
  setters, `useMemo`'d derivations, throw-outside-provider guard).
