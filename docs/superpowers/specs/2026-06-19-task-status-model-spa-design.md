# SP-A — Task Status Model + Table UX — Design

**Date:** 2026-06-19
**Status:** Approved (design); spec pending user review
**Target release:** v0.107.0 "LeGuin"

> Part of a 6-slice roadmap decomposed from a larger request (task status, Kanban,
> AI weight suggestions, project-from-file/URL, steering committee, guided tour).
> SP-A is foundational — SP-B (Kanban) depends on the status enum landed here.

## Goal

Add a first-class workflow status to tasks (To Do / In Progress / On Hold / In Review /
Cancelled / Done), make `status` the field that drives "is this task done", surface it
in the task table (badge column + inline dropdown + form picker), and add a
hide-finished toggle. Show/hide columns already exists — the new column folds into it.

## Non-goals (SP-A)

- Kanban board, drag-between-statuses, per-card summary — **SP-B**.
- Jira status mapping, read-only gate for synced tasks, "reflect after next sync" — **SP-B**.
- Edit-modal buttons (send inquiry / push to Jira / delete) — **SP-B**.
- AI weight suggestions, project-from-file/URL, steering committee, guided tour — later SPs.

## Decisions (locked during brainstorming)

1. **`status` drives logic** (source of truth). `completedDate` is kept and auto-managed.
2. **Finished = Done + Cancelled** — hidden by hide-finished, excluded from overdue and
   next-actions. Cancelled excluded from completion-% metrics (it wasn't completed).
3. **View prefs are per-device `Settings`** (localStorage), not persisted Workspace fields.
4. **Show/hide columns is already built** (`use-column-manager.ts`) — register the new
   column in the existing chooser.
5. **Status editable via form picker AND inline table dropdown.**
6. **All Jira-status logic deferred to SP-B** — in SP-A `status` is a plain local field,
   editable for all tasks.

## Architecture

### Status type

```ts
// types.ts
export type TaskStatus =
  | "To Do" | "In Progress" | "On Hold" | "In Review" | "Cancelled" | "Done";
export const TASK_STATUSES: TaskStatus[] = [
  "To Do", "In Progress", "On Hold", "In Review", "Cancelled", "Done",
];
export const DEFAULT_TASK_STATUS: TaskStatus = "To Do";
```

`Task` gains `status: TaskStatus` (required field; sanitizer defaults missing/invalid to
`"To Do"`, except where migration applies — see below).

### The completedDate invariant (key architectural decision)

Rather than rewrite ~30 files that key on `completedDate`, maintain the invariant:

> **`status === "Done"` ⟺ `completedDate` is a non-empty date.**

- `applyStatusChange(task, newStatus, today)` (pure helper):
  - → `"Done"`: set `completedDate = today` (if not already set).
  - off `"Done"` (to any other status): clear `completedDate = ""`.
  - `"Cancelled"` and the other open statuses leave `completedDate = ""`.
- Existing overdue / Gantt / EVM / dashboard / reports / snapshot / resource-workload
  logic that reads `completedDate` continues to work unchanged — "Done" still means
  `completedDate` set.
- **New rule:** `Cancelled` is terminal but not completed. Add one pure predicate
  `isTaskFinished(task) = task.status === "Done" || task.status === "Cancelled"` and
  audit only the **active surfaces** to also exclude Cancelled:
  - overdue flagging (`due-dates.ts` / `health.ts`),
  - next-actions inclusion (`next-actions/` input builder),
  - any "open tasks" count used for active work.
  Completion-% / EVM keep counting `Done` only (via `completedDate`), so Cancelled is
  naturally excluded there with no change.

This honors "status drives logic" — the user sets `status`; `completedDate` is its
auto-managed mirror — while bounding the change surface.

### Migration (on load / sanitize)

Legacy tasks have no `status`. Derive: `completedDate` non-empty → `"Done"`, else `"To Do"`.
Implemented in `sanitizeTask` so it covers every backend's read path uniformly.

## Persistence — six write paths + codecs

`status` is a persisted Workspace field. Wire it into all six:

1. JSON (workspace serializer) — included automatically via the object.
2. CSV — add to `TASK_CSV_COLUMNS` (this also drives Turso single + tenant DDL/insert).
3. Markdown — add to the task markdown codec (read + write).
4. Turso single — covered by `TASK_CSV_COLUMNS` derivation; `turso-migrate.ts` self-heals
   the `ALTER ADD COLUMN` for existing DBs.
5. Turso tenant — same derivation.
6. IndexedDB / BrowserBackend KV — covered by the JSON object shape.

Then:
- **Regenerate `__fixtures__/golden-*`** via serializers (legit new-column format change).
- Append the `status` column to curated `sample-workspace-small.md` and
  `sample-workspace-small.csv` (edit `.md` by exact full-line replace; edit `.csv` via the
  app codec round-trip — never naive-split). Regenerate `-big`/`-huge` + `.sqlite3` via
  `scripts/generate-sample-workspace.ts`.
- `sanitizeTask` enum-validates + migrates as above.

## Table UX

- **Status column.** New column key **`taskStatus`** (distinct from existing `"status"`
  RAG-dot key). Renders a status badge using sanctioned AIPM palette tokens only (no
  off-palette colors/shadows; verify by eye + palette-sweep). Sortable by `TASK_STATUSES`
  order (new `sortKey: "taskStatus"`).
- **Column chooser.** Add `taskStatus` to `ALL_TASK_COLS`, `CONFIGURABLE_COLS`
  (`labelKey: "colTaskStatus"`), and `DEFAULT_COL_WIDTHS` in `use-column-manager.ts` /
  `tasks-section.tsx`. Default visible.
- **Inline dropdown.** A `<select>` (or popover) in the status cell to change status
  without opening the editor. Calls `applyStatusChange` then `setTasks`. Needs a
  **row-unique accessible name** (`${t(lang,"status")} – ${task.taskName}`) — N identical
  "Status" labels is a WCAG 2.4.6 fail the axe gate can mask with one seeded row.
- **Task form picker.** Status `<select>` in `TaskFormModal` and the modern `TaskEditView`
  control surface (both editor surfaces). New tasks default to `"To Do"`.
- **Hide-finished toggle.** A per-device `Settings` flag (e.g. `view.hideFinishedTasks`,
  default OFF), surfaced as a labeled toggle in the table header bar. When on, filters out
  `isTaskFinished` tasks from the table (applied alongside existing filters/sort, not a
  Workspace field). Persisted via the existing settings writer (NEVER raw setItem).

## i18n / release

- New EN + DE keys: 6 status labels (`statusToDo`, `statusInProgress`, `statusOnHold`,
  `statusInReview`, `statusCancelled`, `statusDone`), `colTaskStatus`,
  `hideFinishedTasks`, plus a `versionHighlightTaskStatus` highlight key.
- DE strings written via node UTF-8 write (real umlauts; Edit corrupts them; file is CRLF).
- `t(lang,…)` interpolation is 0-based; tests use `lang="en-US"`; assert DE via
  `loadI18n("de")` in `beforeAll`.
- Bump `src/app/version.ts` (APP_VERSION 0.107.0, APP_MILESTONE "LeGuin"), append the new
  highlight key to `APP_HIGHLIGHT_KEYS`, add a `CHANGELOG.md` entry.

## Error handling

- Sanitizer never throws on bad status — defaults to `"To Do"` (or migration result).
- Inline dropdown / form picker only ever set a valid `TaskStatus` (closed `<select>`).
- `applyStatusChange` is pure and total (handles every status); no date parsing that can
  throw (uses the same `today` ISO slice convention already used in the codebase).

## Testing (TDD)

Pure helpers first:
- `isTaskFinished` — Done & Cancelled true; the four open statuses false.
- `applyStatusChange` — →Done stamps today; off-Done clears; Cancelled leaves empty;
  immutable (returns new object).
- migration — completedDate set → Done; empty → To Do.

Then:
- Codec round-trip (CSV + MD) preserves status; golden fixtures regenerated and stable.
- `sanitizeTask` migration + enum-default tests.
- Component: inline dropdown changes status + has row-unique aria-label; form picker
  defaults To Do and round-trips; hide-finished toggle filters Done+Cancelled.
- `npx tsc --noEmit` (i18n EN/DE parity) after editing any test.
- Axe gate for the new inline control (`npx playwright test e2e/a11y.spec.ts -g "Open Points"`
  — verify the tasks view if it's in `A11Y_VIEWS`; otherwise verify by eye).

## File map

- `types.ts` — `TaskStatus`, `TASK_STATUSES`, `DEFAULT_TASK_STATUS`, `Task.status`.
- `task-status.ts` (new, pure, i18n-free) — `isTaskFinished`, `applyStatusChange`,
  `migrateStatus`, status-order helper for sorting.
- `sanitize.ts` — validate + migrate status in `sanitizeTask`.
- `csv-codecs.ts` (`TASK_CSV_COLUMNS`), `markdown-codecs.ts` — read/write status.
- `use-column-manager.ts` / `tasks-section.tsx` — column registration, badge cell,
  inline dropdown, sort, hide-finished toggle.
- `task-form-context.tsx` / `TaskFormModal` / `TaskEditView` — status picker, default.
- `settings-types.ts` — `hideFinishedTasks` view pref + sanitizer.
- `due-dates.ts` / `health.ts` / `next-actions/` input builder — exclude Cancelled from
  active surfaces.
- `i18n.ts` / `i18n.de.ts`, `version.ts`, `CHANGELOG.md`,
  `sample-workspace-small.{md,csv}`, generated samples + `__fixtures__/golden-*`.
