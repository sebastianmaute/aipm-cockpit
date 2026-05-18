# Slice 2b — TaskRow Extraction + Memoization

**Date:** 2026-05-18
**Slice:** 2b of 3 in the `task-manager.tsx` decomposition.
**Predecessor:** Slice 2 — WorkspaceProvider
(`docs/superpowers/specs/2026-05-18-workspace-context-slice2-design.md`).
**Successor:** Slice 3 — TaskFormProvider (add/edit/bulk-edit drafts).

## Problem

After Slice 2, `task-manager.tsx` no longer owns task data, but the
table body still renders rows as inline JSX inside
`filteredSortedTasks.map(task => …)` — roughly 250 lines per row.
Every render of `TaskManagerInner` re-creates the JSX for every
visible row, regardless of whether the row's underlying data changed.

The result: typing in the search box (each keystroke until the 150 ms
debounce settles), opening a modal, expanding a single row's notes,
or pushing one task to Jira all trigger a full re-render of every row
in the table. With 50–200 tasks, that's hundreds of unnecessary
component reconciliations per interaction.

Slice 2 named this slice's intent: **"Slice 2b (row memoization).
With `tasks` and `filteredSortedTasks` out of `TaskManagerInner`, the
row JSX can be extracted to a `<TaskRow>` component … wrapped in
`React.memo`. Inline callbacks become `useCallback`-stabilized."**

## Goal

Extract the inline row JSX into a memoizable `<TaskRow>` component,
plus four memoized sub-components for the cells whose state can change
independently per row (`NotesCell`, `TaskActions`, `DependencyChips`,
`RaidBadge`). Stabilize the handler callbacks the row consumes via
`useCallback`. Net result: an interaction that doesn't change a
row's underlying data no longer causes that row to re-render.

This is a refactor — no observable behaviour change.

## Non-goals

- **Moving `raid` / `absences` / `shifts` / `contacts` state** out of
  `TaskManagerInner`. They stay where they are.
- **Virtualizing the row list** (`react-window`, intersection
  observers, etc.). Separate concern.
- **Extracting other row-adjacent UI** (table header, filter bar,
  toolbar). Each of those is its own future slice.
- **Refactoring non-row callbacks** (`handleSubmit`, bulk operations,
  drag-and-drop). Out of scope.
- **Adding any new functionality.** Pure refactor.

## Architecture

### Component tree

```
TaskManager (default export, thin wrapper, unchanged from Slice 2)
  └ <FiltersProvider>
      └ <WorkspaceProvider>
          └ <TaskManagerInner>
              └ <RowContext.Provider value={ambient}>   NEW
                  └ <table>…<tbody>
                      └ filteredSortedTasks.map(task =>
                          <TaskRow key={task.id} … />   NEW
                            ├ <NotesCell />             NEW
                            ├ <TaskActions />           NEW
                            ├ <DependencyChips />       NEW
                            └ <RaidBadge />             NEW (rendered conditionally)
```

`RowContext` is local to `src/app/task-row.tsx` — it's not a
project-wide concern, just the connective tissue between
`TaskManagerInner` and the row family.

### New file: `src/app/task-row.tsx`

Exports `TaskRow` (default), `NotesCell`, `TaskActions`,
`DependencyChips`, `RaidBadge`, `RowContext` (or
`TaskRowProvider`), `useTaskRowContext`.

#### `RowContextValue` shape

```ts
interface RowContextValue {
  lang: Lang;
  today: string;
  holidaySet: Set<string>;

  // Flattened from settings.jira so consumers only re-render
  // on Jira-config change, not on unrelated settings changes.
  jiraSiteUrl: string;
  jiraEnabled: boolean;
  jiraProjectKey: string;

  hiddenCols: Set<string>;
  tasksById: Map<number, Task>;

  // Stable callbacks (useCallback'd in TaskManagerInner).
  onToggleSelect: (id: number) => void;
  onToggleNoteExpanded: (id: number) => void;
  onJumpToRaid: (id: number) => void;
  onToggleComplete: (task: Task) => void;
  onSendInquiry: (task: Task) => void;
  onPushToJira: (id: number) => void;
  onEdit: (task: Task) => void;
  onDelete: (id: number) => void;
}
```

#### Component contracts

**`TaskRow`** — `React.memo(TaskRow)`. Props:

```ts
interface TaskRowProps {
  task: Task;
  isSelected: boolean;     // selectedIds.has(task.id)
  isEditing: boolean;      // editingId === task.id
  isExpanded: boolean;     // expandedNotes.has(task.id) — drilled to NotesCell
  isPushing: boolean;      // pushingIds.has(task.id) — drilled to TaskActions
  raidRefs: RaidItem[] | undefined; // raidByTask.get(task.id) — drilled to RaidBadge
}
```

Default shallow compare suffices — every prop is a primitive, a stable
memo'd reference, or the `task` object reference itself.

**`NotesCell`** — `React.memo`. Props:
`{ notes: string; isExpanded: boolean; taskId: number }`. Reads `lang`
and `onToggleNoteExpanded` from context. Renders the summary +
show-more/less button (the existing inline IIFE around row line
3997–4022).

**`TaskActions`** — `React.memo`. Props: `{ task: Task; isPushing:
boolean }`. Reads `lang`, `jiraSiteUrl`, `jiraEnabled`,
`jiraProjectKey`, and the five action handlers from context. Renders
the two-row button stack (Mark complete / Send inquiry / Push to Jira
→ Edit / Delete).

**`DependencyChips`** — `React.memo`. Props: `{ deps: TaskDependency[]
}`. Reads `lang` and `tasksById` from context (needs the full map to
resolve predecessor names). Renders the chip list. Caller passes the
full `task.dependencies` array; the component short-circuits to a `—`
span when `deps.length === 0`.

**`RaidBadge`** — `React.memo`. Props: `{ taskId: number; refs:
RaidItem[] }`. Caller only renders it when `refs` is non-empty. Reads
`lang` and `onJumpToRaid` from context. Renders the colored R·A·I·D
counter button.

**`useTaskRowContext()`** — throws "useTaskRowContext must be used
within RowContext.Provider" outside the provider; same pattern as
`useFilters` and `useWorkspace`.

### Changes to `src/app/task-manager.tsx`

1. **Import the new components** at the top.
2. **Wrap the ~10 row-related handler closures in `useCallback`**.
   Most close over only stable setters and have empty deps. A few
   (e.g., handlers that read `lang`, `settings.jira`, `today`,
   `holidaySet`) list those as deps and accept that rows re-render
   when the underlying value changes — these change rarely (language
   switch, settings save, date roll-over), so the trade-off is right.
3. **Memoize a `rowContextValue`** with `useMemo` listing all 16 fields
   as deps. Stable across renders when nothing in the deps changes.
4. **Replace the inline `<tr>{...250 lines}` block** with:
   ```tsx
   <RowContext.Provider value={rowContextValue}>
     <table>…<tbody>
       {filteredSortedTasks.map(task => (
         <TaskRow
           key={task.id}
           task={task}
           isSelected={selectedIds.has(task.id)}
           isEditing={editingId === task.id}
           isExpanded={expandedNotes.has(task.id)}
           isPushing={pushingIds.has(task.id)}
           raidRefs={raidByTask.get(task.id)}
         />
       ))}
     </tbody></table>
   </RowContext.Provider>
   ```
5. **Remove now-unused imports / helpers** (e.g., `Td` may move to
   `task-row.tsx` if only used there; if used elsewhere, keep
   exported from `task-manager.tsx` and re-import in `task-row.tsx`).

### Files affected

| File | Change |
|---|---|
| `src/app/task-row.tsx` | **NEW** ~350 lines (5 components + context + hook) |
| `src/app/task-row.test.tsx` | **NEW** ~120 lines, 6 tests |
| `src/app/task-manager.tsx` | net −230 / +60 lines (lift row JSX, add useCallbacks, add provider wrap) |

## Testing

`src/app/task-row.test.tsx`, 6 tests, focused on memo contract + prop
flow:

1. **TaskRow renders task data correctly.** Anchor test. Seed a task,
   render with minimal RowContext (mock callbacks via `vi.fn`).
   Assert visible content includes task name, assignee, due date,
   and priority label.

2. **TaskRow does not re-render on unrelated parent state change.**
   Wrapper with its own counter `useState`. Render `<TaskRow ... />`
   with stable props. Use `React.Profiler`'s `onRender` callback (or
   a render-count spy in the component) to count renders. Bump the
   wrapper's counter — assert TaskRow's render count stays at 1.

3. **TaskRow re-renders when its own props change.** Same wrapper.
   Flip `isSelected={true ↔ false}`. Assert render count increments
   and that the rendered DOM reflects the selected styling.

4. **NotesCell isolation.** Two `<NotesCell>`s side-by-side, same
   notes string. Toggle `isExpanded` on cell A. Assert cell B's
   render count is unchanged.

5. **TaskActions calls handlers with correct arguments.** Render
   `<TaskActions task={t} isPushing={false} />` inside RowContext
   with `vi.fn()` callbacks. Click "Mark complete" → assert
   `onToggleComplete` called once with `t`. Click "Edit" → assert
   `onEdit` called with `t`. Click "Delete" → assert `onDelete`
   called with `t.id`.

6. **`useTaskRowContext()` outside provider throws.** Bare consumer;
   `expect(() => renderHook(() => useTaskRowContext())).toThrow(
   "useTaskRowContext must be used within RowContext.Provider")`.
   Silence `console.error` with try/finally per Slice 1/2 pattern.

No dedicated tests for `RaidBadge` or `DependencyChips` — their
output is covered by test #1 (anchor render) when the seeded task has
RAID refs / dependencies.

## Verification

- `npm run build` — TypeScript clean, Next 16 bundles successfully.
- `npx vitest run` — full suite green (47 existing + 6 new = 53
  tests, 8 test files).
- **Manual smoke** — the 7 checks from Slice 1/2 (search debounce,
  priority chip, group/label/assignee filter, sort toggle, RAID
  badge, edit task, cross-window sync), plus one new perf check:
  with 50+ tasks loaded, type rapidly in the search box and watch
  React DevTools Profiler. Confirm that:
  - Filter dropdowns / sort toggles only re-render rows whose
    visibility/order actually changes.
  - Expanding a single task's notes re-renders only that one row.
  - Toggling a task's "complete" state re-renders only that one row.

## Risk & rollback

Higher-touch than Slice 1/2 because UI rendering code moves and
React.memo is introduced at five points.

**Risks:**

- **Visible regression.** A subtle JSX-conversion error (forgotten
  conditional, swapped variable, lost className) breaks row
  appearance. Caught by test #1 (anchor render) and the manual smoke.
- **Memo correctness — under-rendering.** A row that should re-render
  doesn't because a prop is stale. Caught by test #3 (re-renders on
  own prop change) and manual smoke including edit + mark-complete.
- **Memo correctness — over-rendering.** Rows re-render *more* than
  before because an inline lambda or object literal leaked into the
  parent JSX, busting memo. Caught by test #2 (load-bearing
  isolation test) and DevTools Profiler.
- **Stale closure in callbacks.** A `useCallback` with missing deps
  closes over stale state. Caught by test #5 (handler-argument
  verification) and manual smoke.

**Rollback:** `git revert` the slice's commits. The intermediate
commits all keep the app functional — each task adds files; the
final task is the one that changes user-visible rendering. Reverting
is clean; no data, API, or storage change.

## What this unlocks

- **Slice 3 (TaskFormProvider).** With the row stable and memoized,
  the add/edit/bulk-edit form drafts can be moved into their own
  provider next. The form's open/close state and draft contents are
  the last remaining UI-state cluster in `TaskManagerInner`.
- **Optional follow-ups** (not in any current slice):
  - Virtualize the row list with `react-window` once the row is a
    stable component.
  - Extract the action-buttons row into its own slice if those
    actions grow more complex.
  - Apply the same pattern to the Reports / Gantt / RAID panels.
- **Pattern consistency.** Establishes the "lift heavy JSX into a
  memoized component family with a local context for ambient
  state" pattern, which other panels can adopt.
