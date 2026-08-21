# Gantt / Task-Editor UX Batch — Design

**Goal:** Six independent UX improvements shipped as one batched minor release: a
resizable Gantt name column, draggable/resizable/reset modals, RAID creation from
the task editor, nested linked-task creation, a hover-revealed leading "Ask Claude"
icon, and inline editing of Open-Points cells.

**Status:** Approved (brainstorm 2026-07-10). Slices are loosely coupled — each is
independently testable and shippable; bundled for one release/CHANGELOG entry (the
app's `ui-batch` precedent).

**Cross-cutting constraints (apply to every slice):**
- Per-device stores only (`lop-app:*` localStorage) — OUT of exports/Turso, swept by
  `clearAppConfig`. No new persisted `Workspace` field, no six-write-path, no golden regen.
- i18n EN + DE for every new control (tsc-enforced parity; DE via node utf8 write with
  real umlauts). Open Points, Gantt, RAID, Resources views are axe-scanned → new
  interactive controls need accessible names + keyboard operability + row-unique labels.
- Reuse `interaction-styles.ts` atoms; palette tokens only (no off-palette / raw shadow).
- React purity: no set-state-in-effect, no `Date.now()`/`new Date()` in render, no
  `obj.member` exhaustive-deps.
- Jira-synced tasks (`!!task.jiraKey`) are read-only — inline edit, the AI icon, RAID-from-editor,
  and nested-create respect that where they touch a task.

---

## Slice 2 — Draggable + resizable + reset Modal (shared `modal.tsx`)

*Load-bearing: the shared `Modal` backs the task form, RAID/change/stakeholder edit
modals, wizards, and confirm/alert dialogs — plus the nested modals in Slices 3/4.*

**Behavior:**
- The modal **header bar** becomes a drag handle: pointer-drag moves the panel; the
  position is clamped so the header stays within the viewport.
- Edge/corner **resize** via the existing `useResizable`.
- A **reset** button in the header restores the default centered position + default size.
- New optional prop `persistKey?: string` → persists `{x, y, w, h}` per-device at
  `lop-app:modal-geom:<key>`. Modals **without** a `persistKey` still drag/resize but do
  not persist (transient confirms/alerts).

**Preserved invariants (regression-critical):**
- Focus trap intact; topmost-only Escape/Tab stacking intact (the `modalStack` Symbol
  logic — see `modal.test.tsx`); the keydown effect still deps `[open]` alone with
  `onClose` via ref (the double-fire landmine).
- Mobile off-canvas: `<1024px` (`useMediaQuery(SIDEBAR_NARROW_QUERY)` equivalent) →
  drag + resize **disabled**, modal renders full-screen/centered as today.
- **Default stays centered** — position only diverges after a user drag or a restored
  `persistKey` geometry → no axe/a11y regression at scan time. Drag handle carries an
  `aria-label` (e.g. `modalDragHandle`); v1 has **no keyboard-move** (mouse enhancement;
  keyboard users use the reset button / centered default).
- `new Date()`/pointer math live in event handlers, never render.

**Data flow / units:**
- Pure geometry helper (new `modal-geometry.ts`, i18n-free, clock-free):
  `clampToViewport(geom, viewport)`, `defaultGeom()`, load/validate persisted geom.
  Unit-testable without a DOM.
- `useModalDrag(ref, {persistKey, enabled})` hook owns the pointer-drag lifecycle +
  geometry state + persistence (mirrors `use-gantt-bar-drag` window-listener pattern).
- `Modal` composes it; a `ModalHeader`/reset-button addition is presentational.

**Testing:** geometry helper unit tests (clamp, default, load validation); `modal.test.tsx`
gains drag-moves-position, reset-restores-default, persist-round-trip, and re-asserts the
stacking/Escape invariants. Mobile-disabled path asserted via a mocked narrow media query.

---

## Slice 1 — Resizable Gantt task-name column

**Current:** the sticky left column uses a fixed `LEFT_GUTTER_PX` constant, shared by the
header (`gantt-chrome.tsx`) and every row (`gantt-rows.tsx`).

**Design:**
- Persisted width `lop-app:gantt-namecol` (via `useResizable` or a focused width hook),
  fed to both header + rows in place of the constant (default = current `LEFT_GUTTER_PX`).
- Drag handle on the sticky column's right border (reuse `ColumnResizeHandle`, already
  `print:hidden`). Min/max width clamp.
- **Reset-size button** in the Gantt toolbar (`gantt-chrome.tsx` `GanttToolbar`), the
  existing `ResetSizeButton` pattern, restores the default width — placed left of any
  existing reset/print controls.

**Testing:** width persists + reset restores default; header/rows read the same width
(no drift). Gantt is axe-scanned — the handle needs an accessible name.

---

## Slice 5 — "Ask Claude" ✨ icon: leading cell, hover-reveal

**Current:** the inline-AI edit trigger renders inside the row (trailing-ish), gated
`isAiEnabled && !isPopout && !task.jiraKey`.

**Design:**
- Move the trigger to a **leading (first) cell** of the row. The `<tr>` becomes a `group`;
  the icon is hidden (`opacity-0`) until `group-hover` **and** `focus-visible` (keyboard
  reachable). Reserve the cell's width so hover causes no layout shift.
- Gate unchanged. Click → the existing inline-AI edit popover (`use-tasks-inline-ai-edit`).
- The Kanban card path is unchanged (board renders outside `RowContextProvider`).

**Testing:** icon present-but-hidden by default, revealed on hover/focus, absent on
`jiraKey`/popout/AI-off rows; row-unique `aria-label` retained.

---

## Slice 6 — Inline Open-Points editing (name, dates, assignee, priority)

**Design:** four cell types become directly editable; each commits on blur/Enter, cancels
on Escape, and routes through the existing task save path (functional `setTasks(prev=>…)` +
the entity `sanitize`; **dates are a plain field patch — NOT `applyStatusChange`**, which is
reserved for status). Per-cell editing state lives in the row.
- **Task name:** single-click keeps opening the full editor (unchanged); **double-click**
  inline-renames. (Only the name cell has the click-conflict.)
- **Start + due dates:** single-click → inline `<input type=date>`.
- **Assignee:** single-click → inline text/select (edits the `assignee` string; the
  `resourceId` link stays owned by the full editor).
- **Priority:** single-click → inline priority `<select>`.
- **Jira-synced rows (`jiraKey`) are read-only** — cells render plain (no inline affordance).
- a11y: each inline control carries a row-unique accessible name (Open Points is axe-scanned);
  the `taskStatus` select precedent applies.

**Units:** a small `useInlineCellEdit` hook (which cell is editing + draft + commit/cancel),
consumed by the row. Pure field-patch application stays in the existing task submit path.

**Testing:** each cell edits + commits + persists; Escape cancels; double-click vs
single-click on name; synced rows non-editable; invalid date rejected by sanitize.

---

## Slice 3 — Create RAID from the task editor (quick inline mini-form) + buffer

**Design:** a collapsible **"+ Create RAID"** in a shared component mounted in BOTH editor
surfaces (`TaskEditView` + `TaskFormModal`): `[category ▾] [title] [Add]`. Add builds a
minimal `RaidItem` (`sanitizeRaidItem` supplies enum/date/status defaults),
`linkedTaskIds = [task.id]`.

**Buffer semantics (approved) — one rule, applies to Slice 3 and Slice 4 alike:**
> **If the parent task already has an id → apply immediately. If the parent is a new,
> unsaved task → stage in an editor-local buffer and flush on the parent's first save**
> (after the id is minted). Cancel of the parent editor discards the buffer.
- **Existing task:** Add creates the RAID immediately — `sanitizeRaidItem` + `nextRaidId`
  against the live list + functional `setRaid`, `linkedTaskIds = [task.id]`.
- **New task (no id yet):** Add stages the RAID spec in `pendingRaid[]` (shown as a pending
  list in the editor). On the parent's first save, mint the parent id, then create each
  buffered RAID with `linkedTaskIds = [newParentId]` via the same sanitize/mint/setRaid path.

**Testing:** add-to-buffer renders a pending row; save flushes real RAID linked to the
(possibly newly-minted) task id; cancel discards; `nextRaidId` re-mint against live list.

---

## Slice 4 — Nested "create linked task" + buffer

**Design:** a **"+ New linked task"** button in the editor opens a **nested `TaskFormModal`**
layered on top (rides the `modalStack`, so it works over both the full-page `TaskEditView`
and the modal `TaskFormModal` parent). The nested form carries a **predecessor/successor
toggle** (default link type FS).
- On nested save: create the child task (existing task-id mint + functional `setTasks`) —
  the child is a real task immediately. Then record the **link** between parent and child:
  - **predecessor:** `parent.dependencies += { taskId: child.id, type: FS }`
    (child constrains parent).
  - **successor:** `child.dependencies += { taskId: parent.id, type: FS }`
    (parent constrains child).
  Recall `TaskDependency.taskId` is the **predecessor**.
- Parent editor stays open underneath (parent is not closed).

**Buffer semantics (approved):**
- **Existing parent (has id):** the link is applied immediately to the correct task's
  `dependencies` (functional `setTasks`).
- **New parent (no id):** the child is still created immediately (real id), but the
  parent-side link is staged in a `pendingLinks[]` buffer `{childId, direction, type}` and
  flushed on the parent's first save (once the parent id exists). Successor links whose
  target is the parent are also deferred until the parent id exists.
- Cancel of the PARENT editor discards `pendingLinks` (the already-created child tasks
  remain — they were committed on nested-save; only the *link* is buffered). This is the
  documented, accepted trade-off: a nested child is a real task the moment you save it,
  independent of whether you later cancel the parent.

**Nesting bound:** the nested editor itself does not offer its own nested-create/RAID-buffer
recursion in v1 (one level) — keep the stack shallow and predictable.

**Testing:** nested modal stacks (topmost Escape closes only it); direction toggle wires the
correct task's `dependencies`; existing-parent applies immediately; new-parent buffers +
flushes on save; child persists even if parent cancelled.

---

## Shared editor buffer (Slices 3 + 4)

Both slices share one editor-scoped staging buffer, needed ONLY while the parent task is new
(no id). A single `useTaskEditorBuffer` hook holds `{ pendingRaid: RaidSpec[], pendingLinks:
LinkSpec[] }` + `flush(parentTaskId)` (creates the buffered RAID + wires the buffered links
against the real id) + `discard()`. Wired at the task-editor orchestration layer, threaded to
`TaskEditView` + `TaskFormModal`. When the parent already has an id, Slices 3/4 bypass the
buffer and apply immediately; when it is new, they stage, and `flush` runs in the task-save
commit AFTER the parent id is resolved. Discard on cancel drops only the buffered links/RAID
(nested child tasks, committed on their own save, remain).

---

## Out of scope (v1)

- Keyboard drag-move of modals (reset + centered default cover keyboard users).
- Multi-level nested editors (one nesting level).
- Inline-editing RAID/change/other registers (Open Points only for Slice 6).
- Persisting modal geometry across devices (per-device only).

## Testing summary

Unit: `modal-geometry`, `useTaskEditorBuffer` flush/discard, gantt width persist/reset,
inline-cell commit/cancel. Component: `modal.test.tsx` (drag/reset/persist + stacking
invariants), task-row inline edits + AI-icon hover gating, RAID-from-editor buffer flush,
nested-create direction + buffer. axe: re-run the scanned views (Open Points, Gantt, RAID,
Resources) for the new controls. Full `tsc`/`lint`/`test:run`/`size:check`/`dup:check`.
