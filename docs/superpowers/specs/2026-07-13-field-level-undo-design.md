# Field-level edit undo — design

**Date:** 2026-07-13
**Status:** Approved (design), pending implementation plan
**Scope decision (user):** all entities · per changed field · each commit = one entry · edits only

## Problem

Today only **destructive** ops are undoable: task delete and clear-all wire
`capture()` in `use-task-row-handlers.ts`. Field **edits** — inline cell edits,
the status dropdown, and modal / full-page saves — push nothing onto the undo
stack, so there is no way to revert a mistaken field change.

The undo **engine** (`undo/undo-stack.ts` + `undo/use-undo-stack.ts`) already
has everything except a caller for edits: a shared stack, retention 25, redo,
toast with an Undo action, and the Ctrl/Cmd+Z hotkey. This feature adds the
missing **capture at edit commit points**, at per-field granularity, across all
six edited entities.

## Goals

- Undo a single inline cell edit (reverts exactly that field).
- Undo a status change (reverts status **and** its auto-managed `completedDate`).
- Undo a modal / full-page save at **per-changed-field** granularity: a save
  that changed N fields pushes N independent undo entries.
- Works for all six edited registers: tasks, RAID, changes, milestones,
  stakeholders, resources.
- Shares the existing single undo stack, UndoControl, toast, and hotkey.

## Non-goals (explicit)

- **Bulk edit** is not covered by this slice (multi-row; needs a different
  whole-row-per-row capture). It stays delete-only-undoable as today. Flagged as
  a possible later slice.
- **Creates** are not undoable (matches the request: edits only). Deletes remain
  as today (already undoable).
- No field coalescing: each blur/Enter commit is its own entry.

## Architecture

### 1. Engine extension — `captureFieldEdit`

Add one method to `useUndoStack` (in `undo/use-undo-stack.ts`), alongside
`capture` / `captureComposite`:

```ts
captureFieldEdit<T extends { id: number }>(opts: {
  setter: Dispatch<SetStateAction<readonly T[]>>;
  kind: ActivityKind;              // "<entity>.updated"
  id: number;                      // the edited row
  before: Partial<T>;              // old values of the changed key-group
  after: Partial<T>;               // new values of the same keys
  stampField?: keyof T & string;   // re-stamped to a fresh ISO ts on undo/redo
}): void
```

Runner is **merge-by-id** (not the existing whole-row replace):

```
undo: setter(prev => prev.map(r => r.id===id ? stamp({ ...r, ...before }) : r)); → redo
redo: setter(prev => prev.map(r => r.id===id ? stamp({ ...r, ...after  }) : r)); → undo
```

where `stamp(row)` sets `row[stampField] = new Date().toISOString()` when
`stampField` is provided (and the row still exists), else returns the row
unchanged. Missing id → no-op (row deleted since; the merge simply matches
nothing).

It reuses the existing `pushEntry(kind, 1, runner)` tail, so it inherits: push
onto `stack`, invalidate the redo stack, emit the `undoToastEdit` action toast,
respect `UNDO_CAP = 25`, and participate in the Ctrl/Cmd+Z / redo hotkeys and
UndoControl unchanged. `count` is always 1 (one field-group per entry).

**Why not reuse the existing `edited` / `capture` path:** that restores a
*whole row* (image replace). With several per-field entries plus later edits, a
whole-row revert clobbers unrelated fields and is order-dependent. Merge-by-key
touches only the group's keys, so per-field entries **compose** and undo
coherently in LIFO order — including overlapping edits to the same key (newest
undone first walks that key new→mid→original).

### 2. Field-groups — correlated keys that revert together

Diff granularity is the **logical** field, not the raw struct property. A few
controls write correlated keys that must move together to preserve invariants:

- **Task:**
  - `{ status, completedDate }` — holds the invariant `status==="Done" ⟺ completedDate set`.
  - `{ assignee, assigneeEmail, resourceId }` — one assignee identity.
  - all other keys are their own 1-key group.
- **RAID / change / milestone / stakeholder / resource:** default every key to
  its own group; add a multi-key group only where a single control writes a
  correlated set (decided per entity during planning).

Represent as a per-entity constant:

```ts
type FieldGroup<T> = readonly (keyof T & string)[];
const TASK_UNDO_FIELD_GROUPS: readonly FieldGroup<Task>[] = [
  ["status", "completedDate"],
  ["assignee", "assigneeEmail", "resourceId"],
];
```

A pure helper collapses a diff into one entry per changed group:

```ts
partitionChanges<T>(
  changes: readonly FieldChange[],   // from diffFields(prev, next)
  groups: readonly FieldGroup<T>[],
): Array<{ before: Partial<T>; after: Partial<T> }>
```

Any changed key not named in a multi-key group becomes its own single-key entry.
A multi-key group with **any** member changed emits one entry carrying the
before/after of **all** its keys (so reverting status also reverts
completedDate). Lives in a pure, i18n-free module (e.g. `undo/field-groups.ts`)
with its own unit tests.

### 3. Wiring points (all six entities)

- **Modal / full-page save:** at each save handler that already has prev→next:
  `diffFields(prev, next)` → `partitionChanges(changes, groups)` → push one
  `captureFieldEdit` per changed group. Tasks: `use-task-submit.ts` (already
  computes `diffFields` for the audit log — reuse it). Other entities: their CRUD
  hooks (`use-change-log`, `use-stakeholders`, `use-resource-planner`) and the
  RAID / milestone save handlers.
- **Inline cell edit:** the inline patch is already exactly one group. Capture
  `before = pick(prevRow, Object.keys(patch))`, `after = patch`, one entry. Tasks
  via `tasks-section.tsx` `onInlinePatch`; other panes via the generic
  `use-inline-entity-edit.ts`.
- **Status dropdown:** `applyStatusChange` writes `{ status, completedDate }`;
  capture that pair as one entry.

The `captureFieldEdit` handle threads from `task-manager.tsx` down the same path
the existing `capture` / `captureComposite` already travel (thin panes capture in
task-manager's handlers / the per-entity hooks).

### 4. Semantics & edge cases

- One shared stack with deletes; one UndoControl; unchanged UI.
- **Re-stamp `localModifiedAt`** on undo and redo (an undo is itself a local edit
  → keeps Jira / CSV / storage sync honest). Entities without the field pass no
  `stampField` and skip it.
- **Jira-synced rows** are edit-blocked upstream (`!!jiraKey`), so capture never
  fires for them — undo can never resurrect a value the sync owns.
- **No-op guard:** skip capture when `before`≡`after`; `diffFields` already drops
  unchanged keys, so an empty partition pushes nothing.
- Retention 25 is shared: a burst of edits can push older ops off the stack
  (accepted; matches the delete model).
- Out-of-order `undoById` of a non-top entry that shares a key with a newer entry
  can set a stale value — same pre-existing caveat as the whole-row path, and the
  engine already clears the redo stack on out-of-order undo.

## Testing

**Engine / pure (`undo-stack` + `field-groups`):**
- `captureFieldEdit` undo reverts only the group's keys; redo re-applies them.
- undo↔redo round-trips repeatedly (reusable runner).
- order-independence across two overlapping same-key edits (LIFO).
- `stampField` re-stamps on undo and redo; absent → untouched.
- `partitionChanges`: 1:1 keys → one entry each; a multi-key group with one
  member changed → single entry carrying all group keys; unchanged → no entry.

**Wiring (per entity):**
- inline commit → exactly one entry; undo reverts that one field.
- modal save changing 3 fields → 3 entries; each undoes one field.
- status change → one entry reverting `status` **and** `completedDate` together.
- Jira-synced row edit path → no capture pushed.

## Files touched (anticipated)

- `undo/use-undo-stack.ts` — add `captureFieldEdit` + merge-by-id runner; extend
  `UndoStackApi`.
- `undo/field-groups.ts` (new) — `FieldGroup`, per-entity group consts,
  `partitionChanges`, `pick`.
- `undo/field-groups.test.ts`, `undo/use-undo-stack.test.tsx` (extend).
- `task-manager.tsx` — thread `captureFieldEdit` to the edit/inline/status paths.
- Tasks: `use-task-submit.ts`, `tasks-section.tsx` (`onInlinePatch`),
  status-change handler in `use-task-row-handlers.ts`.
- Other entities: `use-change-log.ts`, `use-stakeholders.ts`,
  `use-resource-planner.ts`, RAID + milestone save handlers,
  `use-inline-entity-edit.ts`.
- Tests alongside each wiring site.

## Risks

- **Breadth:** six entities × (inline + modal + where present, status). Mitigated
  by one shared capture primitive + one shared partition helper; per-entity work
  is just "supply setter + groups + before/after."
- **Field-group correctness:** a missed correlated pair (like status/completedDate)
  would revert half a logical field and break an invariant. Mitigated by the
  explicit per-entity `UNDO_FIELD_GROUPS` + unit tests asserting the pairs.
- **`localModifiedAt` drift:** forgetting to re-stamp on undo would desync Jira/CSV.
  Mitigated by `stampField` on the primitive + a test.
