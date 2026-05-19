# Slice 4 — Modal extraction (TaskFormModal + BulkEditModal)

**Date:** 2026-05-19
**Slice:** 4 in the `task-manager.tsx` decomposition.
**Predecessors:**
- Slice 1 — FiltersProvider (`docs/superpowers/specs/2026-05-17-filters-context-slice1-design.md`)
- Slice 2 — WorkspaceProvider (`docs/superpowers/specs/2026-05-18-workspace-context-slice2-design.md`)
- Slice 2b — TaskRow extraction + memoization (`docs/superpowers/specs/2026-05-18-task-row-memo-slice2b-design.md`)
- Slice 3 — TaskFormProvider (`docs/superpowers/specs/2026-05-18-task-form-context-slice3-design.md`)
- Slice 3 spec named the follow-up: *"with form data in context, `<TaskFormModal>` and `<BulkEditModal>` could be lifted out of `TaskManagerInner` and consume the form context directly. Out of scope for Slice 3 but newly feasible."*

## Problem

After Slice 3, the add/edit task form and the bulk-edit form draft state live in `TaskFormProvider`. The modal JSX that consumes them, however, still sits inline in `TaskManagerInner`:

- Task form modal — `src/app/task-manager.tsx` lines 2863–3260 (~400 lines).
- Bulk edit modal — `src/app/task-manager.tsx` lines 3496–3767 (~270 lines).

Together they account for roughly 670 of the file's 4224 lines and are the single largest remaining JSX blob in `TaskManagerInner`. They are self-contained: each renders only when its corresponding `*Open` flag is true, has well-defined entry/exit points (open + onCancel/onSubmit/onApply), and is consumed nowhere else. Extracting them is a pure structural refactor that shrinks `task-manager.tsx` substantially and gives the modals their own test surface.

## Goal

Lift the two modal JSX blocks into standalone components — `<TaskFormModal />` and `<BulkEditModal />` — that consume `useTaskForm()` directly for state and accept everything else as flat props. No observable behaviour change.

## Non-goals

- **Moving handlers into context.** `handleSubmit`, `handleCancelEdit`, `applyBulkEdit`, `cancelBulkEdit`, and `handleRemoveContact` are also called from non-modal sites (rows, dependency editors, keybindings). Lifting them is a separate concern that touches many call sites.
- **Re-shaping derived values.** `today`, `nextId`, `contactsList`, `absences`, `selectedIds`, `selectedJiraCount`, `uniqueGroups`, `uniqueLabels`, `editingIsJiraLinked`, and `jiraEnabled` are currently inline computations in `TaskManagerInner`. They stay computed there and flow in as props.
- **Memoization.** The new components could later become `React.memo` candidates, but the parent passes recreated handler closures each render, so memo would not help today. Defer to a follow-up if perf becomes a concern.
- **Visual / DOM / accessibility changes.** The extracted JSX is byte-for-byte the same, modulo identifier renames required by the prop wiring.
- **Folder restructure.** The two new files sit flat next to `task-manager.tsx`, matching the existing convention (`task-row.tsx`, `absence-edit-modal.tsx`, `shift-edit-modal.tsx`, `jira-conflicts-modal.tsx`).

## Architecture

### Component tree (unchanged provider stack)

```
TaskManager (default export, thin wrapper)
  └ <FiltersProvider>
      └ <WorkspaceProvider>
          └ <TaskFormProvider>
              └ <TaskManagerInner>
                  └ ... existing JSX, with two inline blocks replaced:
                        <TaskFormModal …flatProps />     NEW (replaces lines 2863–3260)
                        <BulkEditModal …flatProps />     NEW (replaces lines 3496–3767)
```

Both modal components are descendants of all three providers in the existing stack, so `useTaskForm()` resolves correctly with no provider changes. The two component instantiations occupy the **same positions** in the JSX tree as the inline blocks they replace — no reordering, no lifting to a different layout container. Reordering is explicitly out of scope and would invalidate the "no observable behaviour change" guarantee (e.g., the bulk-edit panel's surrounding `<div>` styling and the modal's drag-anchor positioning would shift).

### New file: `src/app/task-form-modal.tsx`

Contains:

- The `<TaskFormModal>` component itself (the JSX currently at lines 2863–3260).
- The `Field` helper (currently lines 4023–4043 in `task-manager.tsx`). It is used in 14 places, all inside the task-form modal — confirmed by `grep`. No other consumer.
- The `InlineMicButton` `next/dynamic` import (currently line 170–171 in `task-manager.tsx`). Only used inside the task-form modal.

Props (illustrative):

```ts
interface TaskFormModalProps {
  lang: Lang;
  today: string;
  nextId: number;
  contactsList: Contact[];
  absences: Absence[];
  tasksForDeps: Task[];          // for <DependenciesEditor>
  uniqueGroups: string[];
  uniqueLabels: string[];
  editingIsJiraLinked: boolean;
  jiraEnabled: boolean;
  modalRef: React.RefObject<HTMLDivElement>;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  onRemoveContact: (name: string) => void;
  onShowToast: (kind: ToastKind, msg: string) => void;
}
```

The `{taskModalOpen && (...)}` guard from the call site moves *inside* the component: when `taskModalOpen` from `useTaskForm()` is `false`, the component returns `null`.

### New file: `src/app/bulk-edit-modal.tsx`

Contains:

- The `<BulkEditModal>` component itself (the JSX currently at lines 3496–3767).
- The `BulkEditFieldRow` helper (currently lines 4191+ in `task-manager.tsx`). Used in 9 places, all inside the bulk-edit modal — confirmed by `grep`. No other consumer.

Props (illustrative):

```ts
interface BulkEditModalProps {
  lang: Lang;
  today: string;
  selectedIds: Set<number>;
  selectedJiraCount: number;
  uniqueGroups: string[];
  uniqueLabels: string[];
  onApply: () => void;
  onCancel: () => void;
}
```

The `{bulkEditOpen && selectedIds.size > 0 && (...)}` guard moves inside the component: both conditions are checked against `bulkEditOpen` (from `useTaskForm()`) and the `selectedIds` prop; if either fails the component returns `null`.

### Changed file: `src/app/task-manager.tsx`

The two large inline modal blocks are replaced by component instantiations. The `Field`, `BulkEditFieldRow` helpers and the `InlineMicButton` dynamic import are deleted (they move with their modal). Net file shrink ≈ 700 lines (4224 → ~3500).

Resulting call sites:

```tsx
<TaskFormModal
  lang={lang}
  today={today}
  nextId={nextId}
  contactsList={contactsList}
  absences={absences}
  tasksForDeps={tasks}
  uniqueGroups={uniqueGroups}
  uniqueLabels={uniqueLabels}
  editingIsJiraLinked={editingIsJiraLinked}
  jiraEnabled={jiraEnabled}
  modalRef={modalRef}
  onSubmit={handleSubmit}
  onCancel={handleCancelEdit}
  onRemoveContact={handleRemoveContact}
  onShowToast={showToast}
/>

<BulkEditModal
  lang={lang}
  today={today}
  selectedIds={selectedIds}
  selectedJiraCount={selectedJiraCount}
  uniqueGroups={uniqueGroups}
  uniqueLabels={uniqueLabels}
  onApply={applyBulkEdit}
  onCancel={cancelBulkEdit}
/>
```

### Data flow

```
TaskManagerInner
├─ owns (unchanged): handlers (handleSubmit, handleCancelEdit, applyBulkEdit,
│                              cancelBulkEdit, handleRemoveContact)
│                    derived values (today, nextId, contactsList, absences,
│                                    uniqueGroups, uniqueLabels,
│                                    editingIsJiraLinked, selectedJiraCount,
│                                    selectedIds, jiraEnabled)
│                    modalRef (used by drag/resize logic outside the modal)
│                    showToast, lang
│
├─ <TaskFormModal …flatProps />   ← reads form/editingId/taskModalOpen via useTaskForm()
│                                   returns null when !taskModalOpen
│
└─ <BulkEditModal …flatProps />   ← reads bulkEdit/bulkEditOpen via useTaskForm()
                                    returns null when !bulkEditOpen || selectedIds.size === 0
```

### Judgment calls on prop boundary

- **`modalRef` stays in `TaskManagerInner`.** It's used by the drag/resize logic that lives outside the modal, so it cannot simply move. It flows down as a prop and attaches inside `<TaskFormModal>` on the same `<div>` it sits on today.
- **`tasksForDeps`** — the `<DependenciesEditor>` inside the form modal needs the full task list. Passing it as a prop avoids adding another `useWorkspace()` consumer and the extra re-renders that would entail when unrelated workspace fields change.
- **Toast and lang** — passed as flat props rather than consumed from globals. Keeps each modal component testable in isolation without needing the full app shell mounted.

### Files affected

| File | Change |
|---|---|
| `src/app/task-form-modal.tsx` | **NEW** ~420 lines (modal JSX + `Field` helper + `InlineMicButton` dynamic import + types) |
| `src/app/task-form-modal.test.tsx` | **NEW** ~120 lines, 4 tests |
| `src/app/bulk-edit-modal.tsx` | **NEW** ~330 lines (modal JSX + `BulkEditFieldRow` helper + types) |
| `src/app/bulk-edit-modal.test.tsx` | **NEW** ~130 lines, 7 tests |
| `src/app/task-manager.tsx` | net −700 lines: delete two modal JSX blocks (~670), delete `Field` + `BulkEditFieldRow` + `InlineMicButton` import (~80), add two component instantiations (~30), add two imports |
| `src/app/task-form-context.tsx`, `src/app/workspace-context.tsx`, `src/app/filters-context.tsx`, `src/app/task-row.tsx` | No change |

## Testing

Two new RTL test files, mirroring the per-component convention already in place (`task-row.test.tsx`, `task-form-context.test.tsx`, `workspace-context.test.tsx`). Each test wraps its modal in `<TaskFormProvider>` via a tiny local helper that pre-sets the relevant `*Open` flag.

### `src/app/task-form-modal.test.tsx` — 4 tests

1. **Renders null when modal closed.** With `taskModalOpen = false`, the component returns no DOM. Asserts the modal title text and the `<form>` element are both absent.
2. **Renders header + form when modal open.** Provider sets `taskModalOpen = true`. Title text from `t(lang, "tabNewTask")` is in the document; a `<form>` element is present.
3. **Close button fires `onCancel`.** Clicking the close `<button aria-label="…">` calls the `onCancel` prop exactly once. Does not assert what `onCancel` does — that closure stays in `TaskManagerInner` and is covered by existing tests there.
4. **Submit fires `onSubmit`.** `form.requestSubmit()` (or clicking the submit button) calls the `onSubmit` prop with a `FormEvent`.

### `src/app/bulk-edit-modal.test.tsx` — 7 tests

1. **Renders null when `bulkEditOpen = false`.**
2. **Renders null when `selectedIds.size === 0`** (even with `bulkEditOpen = true`). Both guards must hold.
3. **Renders the singular title for one selection.** `t(lang, "bulkEditTitleOne")`.
4. **Renders the plural title for multiple selections.** `t(lang, "bulkEditTitleMany", n)`.
5. **Cancel button fires `onCancel`.**
6. **Apply button fires `onApply`.**
7. **Toggling a row updates `bulkEdit.enabled`.** Clicking the priority row's toggle flips `bulkEdit.enabled.priority` from `false` to `true` via the provider's `setBulkEdit`. The remaining eight rows are structurally identical; covering one suffices to validate the row→provider wiring.

### What is deliberately not tested

- Every input field's `onChange` — no behaviour change vs. pre-extraction; not the boundary under test.
- DOM snapshots — noisy with Tailwind class strings and high churn on cosmetic changes.
- Memoization — none added in this slice.
- E2E flows — existing manual coverage unchanged; no new user-visible flow introduced.

## Verification

- `npm run build` — TypeScript clean, Next 16 bundles successfully. Catches missed renames and stale imports.
- `npx vitest run` — full suite green (58 pre-slice tests + 11 new = 69 tests, 11 test files).
- **Manual smoke** — open the add-task modal, fill, submit; edit an existing task; open bulk edit on two selections, toggle two fields, apply, cancel. ~2 min check. The drag/resize handle on the task-form modal must still respond — confirms `modalRef` wiring.

## TDD ordering / commits

Following the prior-slice pattern: each commit is RED → GREEN, small enough to verify in isolation.

- **Commit A** — `task-form-modal.tsx` scaffold + first test (`renders null when modal closed`) GREEN against a stub component that always returns `null`.
- **Commit B** — Paste the real modal JSX into `task-form-modal.tsx`, wire the props, delete the original block from `task-manager.tsx`, delete `Field` + `InlineMicButton` import. Add the remaining 3 tests; all 4 now GREEN.
- **Commit C** — `bulk-edit-modal.tsx` scaffold + first two tests (`renders null when bulkEditOpen=false`, `renders null when selectedIds empty`) GREEN against a stub that always returns `null`.
- **Commit D** — Paste the real bulk-edit JSX, wire props, delete the original block + `BulkEditFieldRow` from `task-manager.tsx`. Add the remaining 5 tests; all 7 now GREEN.

Four commits, each verifiable on its own.

## Risk & rollback

Mechanical refactor of JSX whose data dependencies are already settled (slice 3). Same risk shape as Slice 2b's `TaskRow` extraction, modulo size.

**Risks:**

- **Missed identifier.** Each modal references dozens of local closures and derived values. After extraction, every one must arrive as a prop. A missed reference → TypeScript fails on undefined identifier. Caught by `npm run build`.
- **`modalRef` mis-wire.** The ref must attach to the same DOM element the parent's drag/resize logic operates on. Wiring it to the wrong `<div>` silently breaks drag. Mitigated by attaching it to the same `<div>` it sits on today (no re-targeting) and by the manual smoke check.
- **`tasksForDeps` referential stability.** The form modal passes `tasks` into `<DependenciesEditor>` via a prop. If `tasks` reference changes more often than before (it shouldn't — same `useWorkspace()` source), unrelated re-renders inside the dependency editor could leak in. Same baseline behaviour as today; no regression expected.
- **`InlineMicButton` dynamic-import move.** `next/dynamic` works the same wherever the import lives, but moving it does change which module owns the dynamic chunk. No SSR/CSR boundary changes; verified by `npm run build` succeeding.
- **`Field` / `BulkEditFieldRow` collision.** Both names are local. `grep` confirms each is used only inside its corresponding modal block; safe to move.

**Rollback**: `git revert` the slice's commits. No storage, API, or migration change.

## What this unlocks

- **`task-manager.tsx` falls to ~3500 lines.** Still the largest file in the codebase, but the largest single JSX blob is gone. The remaining content is orchestration, smaller modal/popover state clusters, and the table.
- **Modal-specific tests live next to the modal code.** Test failures point at the right file; future modal changes don't require navigating the giant `task-manager` test file.
- **Memoization is feasible as a future slice.** With the modals as named components and clear prop boundaries, `React.memo` plus stable handler closures (`useCallback`) become a straightforward follow-up if perf measurements ever justify it.
- **Pattern consistency.** Per-component files now follow the same shape across the app (`task-row.tsx`, `task-form-modal.tsx`, `bulk-edit-modal.tsx`, plus the existing `absence-edit-modal.tsx`, `shift-edit-modal.tsx`, `jira-conflicts-modal.tsx`). Future modal/component work can mirror the convention.
