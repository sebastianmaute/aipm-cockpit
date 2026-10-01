# Blocker log — design

Date: 2026-10-01. Status: approved in conversation, section by section; this document is the
written form for review.

## Goal

A task's blockers stop being one free-text field. They become a dated list of entries, opened from a
badge with a counter in the Open Points table and edited in a floating window, the same way the note
log works. Resolved blockers are kept as history.

## Decisions taken

| Question | Decision |
|---|---|
| What the badge counts | OPEN blocker entries |
| Relation to the existing `blockers` text | Kept, but DERIVED from the log (open entries joined). Every current reader stays unchanged. |
| A resolved blocker | Kept as history: stamped with a date, shown greyed under "Resolved", can be reopened. Delete stays for mistakes. |
| Entry body | Plain text, not rich HTML |
| New AI tools | None. `update_task.blockers` keeps working through the text-write rule below. |
| Undo | None, matching the note log |

## Dependency

The blocker window reuses the layering added on branch `fix/notes-dashboard-milestone-guides`
(`FLOATING_LAYER_ATTR` in `modal.tsx`, `NOTES_WINDOW_Z` and the `<body>` portal in
`notes-window.tsx`). Implementation starts from `main` AFTER that branch merges.

## 1. Data and storage

### Type

```ts
// types.ts
export type BlockerEntry = {
  id: number;
  text: string;            // plain text, trimmed, capped at TEXTAREA_MAX
  createdAt: string;       // ISO timestamp
  authorResourceId?: number;
  authorName?: string;
  editedAt?: string;       // ISO; absent until edited
  resolvedAt?: string;     // ISO; absent = OPEN, present = RESOLVED
};

// on Task
blockerLog?: BlockerEntry[];
```

`blockerLog` is optional, so every existing workspace loads unchanged.

### The derived text

New i18n-free module `src/app/blocker-log.ts`:

- `blockersText(log: readonly BlockerEntry[] | undefined): string`: the OPEN entries' text, oldest
  `createdAt` first, joined with `"\n"`. `""` when none are open.
- `withBlockerLog(task: Task, log: BlockerEntry[]): Task`: returns a new task with BOTH
  `blockerLog` and `blockers = blockersText(log)` set. **This is the only way a log write may land.**
  The pair cannot drift, by construction.
- `openBlockerCount(log): number`.

Health/RAG (`health.ts`), insights (`insights/detect.ts`), the blocked next-action
(`next-actions/providers/task-attention.ts`), Timelog guards, global search, exports, the Gantt
tooltip and the AI context keep reading `task.blockers` unchanged.

### Migrating existing data

`migrateBlockers(task: Task): Task`, applied wherever a task is loaded (both load funnels):

- `blockerLog` present → the log wins; `blockers` is re-derived through `withBlockerLog`.
- `blockerLog` absent and `blockers.trim() !== ""` → one OPEN entry
  `{ id: 1, text: blockers.trim(), createdAt: <lastUpdateDate as ISO, else now> }`, no author.
- Neither → unchanged.

Pure and idempotent: migrating twice equals migrating once.

### Persistence: all six write paths

A new `blockerLog` column, stored as JSON in the cell like `noteLog`:

- CSV and both Turso layouts: add to `TASK_CSV_COLUMNS` with encoder and decoder in
  `csv-codecs-core.ts`.
- Markdown: add to the task markdown columns and table codec.
- JSON and IndexedDB: carried with the task object.
- Existing Turso databases gain the column through `turso-migrate.ts` (PRAGMA diff → `ALTER ADD
  COLUMN`).
- Golden fixtures (`__fixtures__/golden-*`) are regenerated: a real new column, not a masked format
  change. `sample-workspace-small.json` gains one task with an open and a resolved entry so the
  fixtures cover it.

### Sanitising

Entries are plain text, so the validator is DOM-free and lives with the other task sanitisers:
`sanitizeBlockerLog(raw: unknown): BlockerEntry[] | undefined`. It drops non-objects, entries
without a numeric `id` or a non-empty `text`, and invalid timestamps. It trims and caps `text` at
`TEXTAREA_MAX`, and drops duplicate ids, keeping the first. It caps the list at the note log's own bound,
`MAX_NOTE_ENTRIES` (`note-log-policy.ts`, 500 today; import it, don't restate the number). This deliberately avoids the note log's DOMPurify constraint and the
`withStoredNoteLog` re-attach workarounds.

## 2. UI

### Open Points table

The blockers cell's inline textarea is replaced by a badge button, styled like the note-log badge.

- Open blockers: shows the count; the red tier colour rides the badge's DOT, never its text
  (contrast rule in AGENTS.md).
- None open: muted badge, no number.
- Accessible name, unique per row: `Blockers – #<id> <taskName> (<n> open)`, built with the row-token
  helpers.
- Column id, position, default width and the hide/show setting are unchanged.
- Jira-synced tasks are NOT read-only for blockers: blockers are local-only and never pushed
  (`jira-api.ts`).

### Blocker window

- A floating, draggable, resizable window with its own stored position and size, portaled to
  `<body>` at the note log's z-index (above the entity editors, below confirm dialogs), carrying
  `FLOATING_LAYER_ATTR` so an editor's Tab trap leaves its focus alone. Escape closes it only while
  focus is inside it (`useClaimsWhenFocusWithin`), and focus moves into it on open
  (`usePanelInitialFocus`).
- The window chrome (title bar, drag, resize, reset size, help, close, portal, layering, Escape) is
  extracted from `notes-window.tsx` into a shared `FloatingLogWindow`. `NotesWindow` and the new
  `BlockersWindow` both render it, so the two cannot drift and `dup:check` sees no clone.
- Body, top to bottom:
  1. A plain-text box with an **Add** button (disabled while the box is blank).
  2. **Open**: each entry shows its text, author and date, with **Edit**, **Resolve** and
     **Delete**. Delete asks through the shared confirm dialog.
  3. **Resolved (N)**: collapsed by default. Each entry shows its text and resolved date, with
     **Reopen** and **Delete**.
  4. An empty state when there are no entries at all.
- Every per-entry control has a row-unique accessible name.
- A `useBlockersWindow` hook owns the target task id and the handlers (task-only; the note log's
  three-register machinery is not needed). The task's own row is re-read on every write, through
  functional `setTasks(prev => …)`, so a concurrent write is never clobbered.

### Task editor

- The blockers textarea is replaced by a **Blockers (N)** button, beside the Notes button, that
  opens the blocker window for the task.
- For a task not saved yet, the button follows whatever the editor does for notes on a new task.
  Check that during implementation; if notes behave differently from "disabled with a hint", match
  notes and record it.

### Unchanged surfaces

- Bulk edit keeps its blockers text field. It writes through `setBlockersText` (§3), and its hint
  says it replaces the open blockers.
- Gantt tooltip, Kanban, exports and global search read the derived text.

### Strings

EN and DE (DE patched through a node UTF-8 write with `\r\n` anchors, per AGENTS.md): badge name,
window title, Add, Edit, Resolve, Reopen, Delete confirm, "Open", "Resolved ({0})", empty state, the
editor button, and the updated bulk-edit hint.

## 3. Writers, AI and activity

### Writing the text

`setBlockersText(task: Task, text: string, actor: { resourceId?: number; name?: string }, now: string): Task`:

- `text.trim()` equals the current derived text → task returned unchanged (an editor save or a
  re-run import adds nothing).
- `text.trim() === ""` → every open entry gets `resolvedAt = now`.
- Otherwise → every open entry is resolved, and one new open entry with the trimmed text is added.

It always returns through `withBlockerLog`. Callers:

- AI `update_task` (`chat-task-patch.ts`, where `sanitizeBlockers` runs today)
- bulk edit (`use-bulk-operations.ts` / `bulk-operations-helpers.ts`)
- Clear-blocker (`use-action-center-handlers.ts`): passes `""`
- CSV and Markdown imports that carry only the old text column, through `migrateBlockers`
- templates (`templates.ts`, `templates-builtin.ts`)

### Every rebuild path keeps the stored log

Any path that rebuilds a task from a patch must carry `blockerLog` over from the STORED row and must
never drop or overwrite it from a stale copy. The task editor's submit leaves `blockerLog` (and
`blockers`) out of its payload, as `use-task-submit.ts` does for `noteLog`. The plan enumerates every
task writer from a repo grep, and each gets a test that seeds a log and asserts it survives.
Starting set: AI update, bulk edit, inline cell edit (`use-inline-cell-edit.ts`,
`task-inline-patch.ts`), editor save, Jira sync (`use-jira-sync.ts` sets `blockers: ""` on import of
a new task only; verify it never touches an existing task's log), AI project proposal
(`ai-project-proposal.ts`).

### AI

- The AI keeps reading `blockers`.
- The `update_task` tool's `blockers` description changes to: setting it replaces the task's open
  blockers (they are marked resolved) with this text; an empty string resolves them all.
- No new tools.

### Activity log

Add, edit, resolve, reopen and delete each log `task.updated` with the task id, as the note log
does. The log stays storage-only; entry text never reaches an export through it.

### Docs

- A short "Blocker log" section in `docs/AGENTS/rich-text.md` beside the note log (writers, the
  derived-text rule, the stored-row carry), or a new `docs/AGENTS/` file if it passes ~60 lines.
- The Blockers help concept and `lib/app-feature-guide.md` describe the badge and window.

## 4. Testing

- **Pure (`blocker-log.test.ts`):** `blockersText` (open only, ordered, empty); `withBlockerLog`
  sets both fields; `setBlockersText` (same text → unchanged, empty → all resolved, new text →
  old resolved plus one new); `migrateBlockers` (text-only → one entry, log wins, idempotent);
  `sanitizeBlockerLog` (malformed dropped, caps, duplicate ids).
- **Persistence:** `blockerLog` round-trip across all six paths in
  `entity-persistence-registry.test.ts`, counted to six per slice; regenerated golden fixtures; a
  Turso migrate test for the new column.
- **Writers:** one test per rebuild path, with a seeded log, so a dropped field fails.
- **Readers:** health, the blocked next-action and the insight each read a resolved-only log as NOT
  blocked.
- **UI:** the badge's count, muted state and row-unique name; the window's add / edit / resolve /
  reopen / delete; Resolved collapsed by default; the editor button; the window's portal, z-index and
  layer marker (as for `NotesWindow`).
- **a11y:** Open Points is in `A11Y_VIEWS`, so the badge is axe-scanned in CI; the window is not
  (open only on click), so its names are pinned by unit tests.

## Out of scope

- AI tools to add or resolve single blockers.
- Blockers on RAID items or changes.
- Undo for blocker writes.
- Pushing blockers to Jira.
