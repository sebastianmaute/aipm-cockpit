# SP-B — Kanban Board + Jira Gating + Edit-Modal Buttons — Design

**Date:** 2026-06-19
**Status:** Approved (design); spec pending user review
**Target release:** v0.108.0 "Banks"

> Second slice of the 6-part roadmap (see [[task-status-kanban-roadmap]]). Depends on
> SP-A (v0.107.0 "LeGuin") which landed `Task.status`, `task-status.ts`
> (`applyStatusChange`, `isTaskFinished`, `statusSortIndex`), `task-status-ui.ts`
> (`statusLabelKey`, `statusBadgeClass`), and the per-row `onStatusChange` handler.

## Goal

Add a switchable Kanban **board** view to the tasks pane: one column per status, draggable
cards (mouse) with a keyboard-accessible per-card status select, a compact card summary.
Jira-synced tasks are read-only and placed at their nearest Jira-equivalent column.
Wire **Send inquiry / Push to Jira / Delete** buttons into the task editor.

## Non-goals (SP-B)

- SP-C (AI weight suggestions), SP-D (project from file/URL), SP-E (steering committee),
  SP-F (guided tour + demo) — later slices.
- No new persisted `Workspace` field (the board is a view over existing `Task.status`).
- WIP limits, swimlanes, card reordering within a column — not requested (YAGNI).

## Decisions (locked during brainstorming)

1. **Move UX:** native HTML5 drag (mouse) + a per-card status `<select>` (keyboard/a11y path,
   row-unique label). No drag-and-drop library (none in repo; native DnD is the existing pattern).
2. **Jira gating:** sync maps Jira `statusCategory.key` → `status` (`new`→To Do,
   `indeterminate`→In Progress, `done`→Done) via `applyStatusChange`. Synced tasks
   (`!!task.jiraKey`) are read-only (no drag, disabled select) in the board AND in the SP-A
   table inline dropdown. Next sync re-maps → Jira changes reflect everywhere. No new field.
3. **Card content:** compact essentials (title, assignee, due date, priority, health dot,
   Jira badge if synced, RAID/Change badges, status select).
4. **Filters:** board uses the same filtered task set as the table (search/assignee/group/label
   apply); hide-finished is ignored in board mode; all 6 columns always render. View mode
   persists per-device (`tasksViewMode`, default `"table"`).

## Architecture

### View toggle
- New per-device setting `tasksViewMode: "table" | "board"` (default `"table"`) on `Settings`
  (flat field, like `hideFinishedTasks`), sanitized (`=== "board" ? "board" : "table"`),
  written via `setSettings` (the `writeSettings` writer — never raw `setItem`).
- A Table/Board segmented toggle in the tasks header bar (beside the column-config gear and
  hide-finished toggle). Each segment is a labeled button (`aria-pressed`).
- `tasks-section.tsx` branches: `tasksViewMode === "board"` renders `<TaskKanban>`; else the
  existing table. The header bar (filters, toggles, add-task) stays above both.

### Board + columns + drag
- **`task-kanban.ts`** (NEW, pure, i18n-free): `groupByStatus(tasks): Record<TaskStatus, Task[]>`
  (one bucket per `TASK_STATUSES` entry, preserving input order within a bucket).
- **`task-kanban.tsx`** (NEW): renders the 6 columns in `TASK_STATUSES` order. Column header =
  `t(lang, statusLabelKey(s))` + a count. Columns scroll horizontally; each column body scrolls
  vertically (`min-h-0 overflow-auto pr-2`). A column is a drop target:
  `onDragOver={e => e.preventDefault()}`, `onDrop` reads the dragged task id and calls
  `onStatusChange(id, columnStatus)` (SP-A handler → `applyStatusChange`). Empty columns still
  render (drop targets). Drag-over visual uses an AIPM token highlight.
- **`task-kanban-card.tsx`** (NEW): a card showing title, assignee, due date (overdue emphasis
  reusing the table's date treatment), priority badge, health (RAG) dot (reuse `computeTaskHealth`
  + existing dot), a Jira-key badge when `jiraKey`, RAID/Change link badges when present (reuse the
  same lookups `task-row.tsx` uses), and a per-card status `<select>` (options from `TASK_STATUSES`
  via `statusLabelKey`, styled via `statusBadgeClass`, `onChange` → `onStatusChange`). The card is
  `draggable` unless synced. Clicking the card body (not the select) opens the editor (`onEdit`).
- **Pure/colors:** card visuals use only sanctioned AIPM tokens (reuse `statusBadgeClass` and the
  priority/health classes already in `task-row.tsx`). No off-palette / shadow / gradient.

### Jira gating
- **`jiraCategoryToStatus(key: string): TaskStatus`** (NEW pure fn in `jira-status-map.ts` —
  keep `task-status.ts` free of Jira concepts; i18n-free): `"new"`→`"To Do"`, `"indeterminate"`→
  `"In Progress"`, `"done"`→`"Done"`, anything else→`"To Do"`.
- **`use-jira-sync` change:** where a synced issue's fields are applied to a task, derive
  `status = jiraCategoryToStatus(issue.fields.status.statusCategory.key)` and route the task
  through `applyStatusChange(task, status, today)` (this also keeps the completedDate invariant —
  `done`→completedDate set, others→cleared). This replaces SP-A's interim "seed To Do then migrate
  from completedDate" for the sync path. `jira-api.ts` already reads `statusCategory.key` (used for
  `isDone`) — expose it through the issue→fields mapping if not already available.
- **Read-only:** a helper `isJiraSynced(task) = !!task.jiraKey`. In `task-kanban-card.tsx` the
  card is not `draggable` and the select is `disabled` when synced (with a title/tooltip
  "Managed in Jira"). In `task-row.tsx` (SP-A inline dropdown) the select is likewise `disabled`
  when synced. `onStatusChange` guards defensively: if the target task has `jiraKey`, it no-ops
  (so a stray drop can't mutate a synced task).

### Edit-modal buttons
- Three actions on the task being edited, wired into BOTH editor surfaces (`TaskEditView` control
  bar and `TaskFormModal`):
  - **Send inquiry** → existing `onSendInquiry(task)`.
  - **Push to Jira** → existing push-to-Jira handler (from `use-task-row-handlers`/`use-jira-sync`);
    shown/enabled only when Jira is configured (`settings.jira` present) and the task is not
    already synced (`!task.jiraKey`).
  - **Delete** → existing `onDelete(id)` (keeps its current confirm).
- These act on the currently-edited task (`editingId`). Thread the handlers into the editor
  surfaces the same way other editor actions are wired. In popouts/read-only contexts, Push-to-Jira
  and Delete follow existing guards.

## Error handling

- Drop with an unknown/zero task id → no-op. Drop onto the same column the card is already in →
  no-op (status unchanged). Drag a synced card → prevented (`draggable=false`).
- `groupByStatus` is total: every task lands in exactly one bucket (its `status`); a task with an
  out-of-range status can't occur (SP-A migration guarantees a valid `TaskStatus`).
- Sync mapping defaults unknown `statusCategory` to `"To Do"` (never throws).
- Push-to-Jira / send-inquiry / delete reuse existing handlers' error handling + toasts.

## Testing (TDD)

Pure first:
- `groupByStatus` — 6 buckets, correct partition, order preserved, empty buckets present.
- `jiraCategoryToStatus` — the three categories + default.
Then:
- `use-jira-sync` mapping — a synced issue with `indeterminate` category → task `status` =
  "In Progress" (and `done` → "Done" + completedDate set) via `applyStatusChange`.
- `task-kanban.tsx` — renders 6 columns; a drop on a column calls `onStatusChange(id, status)`;
  a synced card is not draggable and its select is disabled; non-synced card select changes status.
- `task-kanban-card.tsx` — shows the compact fields; row-unique select label; Jira badge when synced.
- table inline dropdown now disabled for synced tasks (extend `task-row.test.tsx`).
- editor buttons — Send inquiry / Delete fire their handlers; Push-to-Jira hidden when already
  synced or Jira unconfigured (extend the editor test).
- `npx tsc --noEmit` (EN/DE parity) after editing tests. axe: board mode isn't auto-scanned (gate
  shows the default table view) — verify board a11y by eye (row-unique labels, keyboard select,
  contrast); confirm the table "Open Points" gate still passes.

## i18n / release

- New EN+DE keys: `tasksViewTable`, `tasksViewBoard` (toggle), `kanbanColumnEmpty` (optional empty
  hint), `jiraManagedTooltip` ("Managed in Jira"), and `versionHighlightKanban`. Reuse existing
  keys for Delete / Send inquiry / Push to Jira if present (grep before adding). DE via node UTF-8
  write (real umlauts; CRLF; delete temp script). Column headers reuse `statusLabelKey`.
- Bump `version.ts` (APP_VERSION 0.108.0, APP_MILESTONE "Banks"), append
  `versionHighlightKanban` to `APP_HIGHLIGHT_KEYS`, add `CHANGELOG.md` entry.

## File map

- `settings-types.ts` / `use-settings.ts` — `tasksViewMode` field + default + sanitize.
- `task-kanban.ts` (NEW pure) — `groupByStatus`.
- `jira-status-map.ts` (NEW pure) — `jiraCategoryToStatus`, `isJiraSynced`.
- `task-kanban.tsx` (NEW) — board + columns + drop targets.
- `task-kanban-card.tsx` (NEW) — card.
- `tasks-section.tsx` — view toggle + branch table/board; pass handlers/filtered tasks to board.
- `task-row.tsx` — disable inline status select for synced tasks.
- `use-task-row-handlers.ts` — `onStatusChange` guards synced; expose push-to-Jira if needed.
- `use-jira-sync.ts` + `jira-api.ts` — map statusCategory → status via `applyStatusChange`.
- `task-edit-view.tsx` + `task-form-modal.tsx` — Send inquiry / Push to Jira / Delete buttons.
- `i18n.ts` / `i18n.de.ts`, `version.ts`, `CHANGELOG.md`.
