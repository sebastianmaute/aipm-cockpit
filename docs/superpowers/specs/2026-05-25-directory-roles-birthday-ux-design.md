# Directory / Roles / Birthday UX Refinements — Design

**Date:** 2026-05-25
**Status:** Approved (design)

Six related UI refinements across the Tasks table and the Resources feature
(Directory tab, resource edit modal, Manage Roles modal), plus a cross-cutting
tooltip fix. Grouped into four independently-shippable phases.

## Goals

1. **Tasks** — clicking a task's ID or name opens it for editing (same as Edit).
2. **Tasks/tooltips** — the hover hint must describe the actual field and its
   content; today it always reads "Drag the bottom-right corner to resize the
   table" everywhere.
3. **Directory** — the address-book table is sortable and filterable.
4. **Resource birthday** — a calendar date picker with an optional year.
5. **Manage Roles** — disciplines and grades can be deleted; a deleted
   dimension degrades affected roles to "n/a" with rates set to 0.
6. **Manage Roles** — disciplines and grades can be reordered by mouse drag.

## Non-goals

- No IndexedDB schema-version bump. The birthday change is a backward-compatible
  string-format widening; the n/a sentinel fits the existing `number` id type.
- No change to how reminders fire (still month-day based).
- No redesign of the Resources pane layout or the Planning/Calendar/Workload
  tabs.

---

## Phase 1 — Tasks: click-to-edit + tooltip fix

**Files:** `task-row.tsx`, `tasks-section.tsx`, `notifications.tsx`,
`jira-conflicts-modal.tsx`.

### Click-to-edit
- In `task-row.tsx`, the ID cell (currently `#{task.id}` at ~line 175) and the
  task-name cell (`<span>{task.taskName}</span>` at ~line 204) become clickable
  controls that call the existing `onEdit(task)` from `useTaskRowContext()`.
- Render each as a `<button type="button">` (or a `<span role="button" tabIndex={0}>`
  with Enter/Space handlers) styled inline — cursor-pointer, hover color/underline
  — so it reads as actionable without changing row layout.
- Must not interfere with row selection, the RAID badge on the name cell, or
  long-note truncation (the name cell also renders `RaidBadge`; keep the badge
  outside the clickable text or give it its own stopPropagation).

### Tooltip fix
- **Root cause:** `title={t(lang, "tableResizeHint")}` is set on the *wrapping*
  elements — `tasks-section.tsx:201` (`<section>` around the whole table),
  `notifications.tsx:163`, `jira-conflicts-modal.tsx:121`. Children without
  their own `title` inherit the parent's tooltip on hover, so the resize hint
  appears everywhere.
- **Remove** the `title` from those three wrapping containers.
- **Re-add discoverability** as a small bottom-right resize **grip** element
  (absolutely positioned, non-blocking) whose own `title` is `tableResizeHint`,
  so the hint shows only when hovering the corner. Applies to each of the three
  resizable containers.
- **Meaningful per-cell hints (Tasks table, `task-row.tsx`):** each data cell
  gets a `title`:
  - ID cell: `"Task #{id} — {edit}"` (edit = localized "click to edit").
  - Name cell: full task name + `" — {edit}"`.
  - Assignee / Group / other text cells: `"<Column label>: <full value>"`.
  - Date cells (start/due/last-update): `"<Column label>: <value>"`.
  - Status dot already has a `title` (the health label) — leave it.
  Column labels reuse existing i18n keys (`taskName`, `assignee`, `dueDate`, …).
  New i18n key: `clickToEdit` (EN/DE).
- Sortable column headers get a `title` hint via a new i18n key `sortBy` with a
  `{0}` slot, e.g. "Sort by {0}".

---

## Phase 2 — Directory: sortable + filterable

**File:** `resource-directory.tsx`.

- Add local state: `filter: string`, `sortKey`, `sortDir: "asc" | "desc"`.
- **Filter box** above the table; case-insensitive substring match across
  display name, title, department, business phone, email, company.
- **Sortable headers:** every column is clickable to sort; clicking the active
  column toggles direction. Columns:
  - Name → `resourceDisplayName(r)`
  - Discipline → resolved discipline name via `roles`/`disciplines`
  - Grade → resolved grade name
  - Title / Department / Phone / Email → the raw field (blank sorts last)
  - Birthday → normalized month-day key (so MM-DD and YYYY-MM-DD sort together)
- Sorting/filtering is applied to a derived array; the inline discipline/grade
  selects stay editable and call `onAssignRole` unchanged.
- Per-cell `title` hints mirror Phase 1 (column label + value).
- New i18n key: `directorySearchPlaceholder` (EN/DE). Reuse `sortBy`.

---

## Phase 3 — Birthday picker (calendar + optional year)

**Files:** `resource-edit-modal.tsx`, `sanitize.ts`
(`sanitizeResource`/birthday), `birthdays.ts`, `storage.ts` (serialization, if
format-specific), `resource-directory.tsx` (display), `i18n.ts` /
`i18n.de.ts`. `Resource.birthday` stays typed `string` (doc only).

### Storage format
- `Resource.birthday` accepts **`"MM-DD"`** (year unknown) *or*
  **`"YYYY-MM-DD"`** (year known). Both are valid; existing `MM-DD` data is
  unchanged. Stored value is still a plain string — no type change, no schema
  bump.
- A shared helper `birthdayMonthDay(b)` returns the `MM-DD` slice from either
  format (used by reminders, sort, and display); `birthdayHasYear(b)` is true
  for the 10-char form. Both live in `birthdays.ts` (where `getUpcomingBirthdays`
  already is); `sanitize.ts` and `resource-directory.tsx` import them from there.

### Editor UI
- Replace the two Month/Day `<select>`s with:
  - A native **`<input type="date">`** bound to a full `YYYY-MM-DD` working
    value. When the stored birthday is `MM-DD`, the input is anchored to a fixed
    leap year (`2000`) so Feb 29 is selectable; that anchor year is cosmetic.
  - A checkbox **"Exact year unknown"** (`resourceBirthdayYearUnknown`).
    - Checked → on save, strip to `MM-DD`.
    - Unchecked → save the full `YYYY-MM-DD`.
  - Clearing the date input → `birthday = undefined`.
- New i18n key: `resourceBirthdayYearUnknown` (EN/DE). The old
  `resourceBirthdayMonth` / `resourceBirthdayDay` keys become unused → remove.

### Reminders & display
- `getUpcomingBirthdays` uses `birthdayMonthDay()` so both formats trigger
  correctly (year-wrap logic unchanged).
- `sanitizeResource` validates either format; anything else → `undefined`.
- Storage serialization round-trips the string as-is (verify CSV/MD/JSON have
  no MM-DD-specific assumptions).
- Directory shows the full date when a year is present, otherwise `MM-DD`.

---

## Phase 4 — Manage Roles: delete + reorder

**Files:** `roles-modal.tsx`, `use-resource-planner.ts`,
`resource-foundation.ts`.

### Delete discipline / grade
- Each item in the discipline and grade `RefList` gets a delete (×) button.
- On delete the planner:
  1. Removes the discipline/grade from its array.
  2. For every `Role` whose `disciplineId` (or `gradeId`) equals the deleted id,
     sets that dimension to the **n/a sentinel `0`** and sets
     `internalRate = externalRate = 0`.
  3. Resources keep their `roleId`; the role now reads "n/a" for that dimension.
- New handlers: `onDeleteDiscipline(id)`, `onDeleteGrade(id)`.
- A `window.confirm` warns before deleting a discipline/grade that is in use,
  noting that affected roles reset to n/a with zero rates.
- **Sentinel rendering:** `roleLabel(role, disciplines, grades)` and the
  roles-modal / directory displays render dimension id `0` (or any unresolved
  id) as the localized **"n/a"** (`naLabel`, new i18n key). `findRoleByCombo`
  treats `0` as a normal id so an all-n/a role can still be matched if needed.

### Reorder via drag
- Each `RefList` item is `draggable`; `onDragStart`/`onDragOver`/`onDrop`
  compute a new order (mirrors the Gantt row-reorder pattern already in
  `gantt.tsx`).
- New handlers: `onReorderDisciplines(orderedIds: number[])`,
  `onReorderGrades(orderedIds: number[])` — the planner reorders the stored
  arrays to match. Array order already drives every dropdown and the storage
  serialization, so persistence is automatic; no new field, no schema bump.
- A drag-handle / grip affordance per row; `title` describes the action
  (`reorderHint`, new i18n key).

---

## Data flow & persistence summary

- Disciplines, grades, roles, and resources live in `WorkspaceContext` and the
  active storage backend (IndexedDB v5 / file). All four phases mutate those
  in-memory arrays through `use-resource-planner.ts` handlers; the existing
  save path persists them — **no schema-version change**.
- Birthday widening and the n/a sentinel are forward/backward compatible:
  - Old `MM-DD` birthdays still parse and display.
  - A role with a real discipline/grade is untouched; only roles pointing at a
    deleted dimension carry sentinel `0` + zero rates.

## Testing

- `sanitize.test.ts` — `sanitizeResource` accepts `MM-DD` and `YYYY-MM-DD`,
  rejects malformed; `birthdayMonthDay` / `birthdayHasYear` helpers.
- `birthdays.test.ts` — `getUpcomingBirthdays` triggers for both formats
  (incl. year-wrap and Feb 29).
- `use-resource-planner.test.tsx` — delete discipline/grade cascades roles to
  n/a + zero rates; reorder reorders the array; existing role/resource handlers
  unaffected.
- `resource-foundation.test.ts` — `roleLabel` renders sentinel `0` as "n/a".
- Component tests: directory sort + filter (`resource-directory`), click-to-edit
  on ID/name (`task-row`/`tasks-section`), and the corrected tooltips (cell
  `title` present, container resize `title` gone).

## Out of scope / risks

- Native `<input type="date">` localization follows the browser locale; we don't
  override its display format.
- Drag reorder uses HTML5 DnD (consistent with Gantt); no touch-drag polish
  beyond what the browser provides.
