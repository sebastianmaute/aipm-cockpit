# Blocker Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace a task's single free-text `blockers` field with a dated blocker log, opened from a counting badge in Open Points and edited in a floating window like the note log.

**Architecture:** A new `Task.blockerLog` holds the entries; `Task.blockers` survives as a string DERIVED from the open entries, written only through `withBlockerLog`, so every current reader is untouched. Text writers (AI, bulk edit, Clear-blocker, templates, legacy imports) go through `setBlockersText`. The note log's window chrome is extracted into `FloatingLogWindow` and shared by `NotesWindow` and the new `BlockersWindow`.

**Tech Stack:** Next.js / React 19, TypeScript, vitest + Testing Library, the repo's CSV/Markdown/Turso/JSON/IndexedDB codecs.

**Spec:** `docs/superpowers/specs/2026-10-01-blocker-log-design.md`

## Global Constraints

- Start from `main` AFTER `fix/notes-dashboard-milestone-guides` has merged (it adds `FLOATING_LAYER_ATTR` in `modal.tsx` and `NOTES_WINDOW_Z` + the `<body>` portal in `notes-window.tsx`).
- NO local gates: no `tsc`, `eslint`, `npm run` gate scripts, full vitest sweeps or e2e, in any task or subagent brief. CI is the first check. The red/green steps run ONE named test file as a probe; never two vitest processes at once.
- `src/**` is CRLF in the working tree: never `sed -i` it. `i18n.de.ts` is edited only by a node UTF-8 write whose anchors use `\r\n` (AGENTS.md "Hard constraints → i18n").
- Commits: conventional prefix, cite §N only if a register entry exists, NO `Claude-Session:` / `Co-Authored-By` trailers, never `--amend`.
- Blocker entry text is PLAIN TEXT, trimmed, capped at `TEXTAREA_MAX` (`sanitize.ts`); list length capped at `MAX_NOTE_ENTRIES` (`note-log-policy.ts`): import both, never restate the numbers.
- `blockers` is written ONLY through `withBlockerLog` (directly or via `setBlockersText` / `migrateBlockers`). A grep for `blockers:` in a write position outside `blocker-log.ts` is a defect unless it is a reader or the derived value.
- Undo: none. Activity: `task.updated` with the task id per window action, as `use-notes-window.ts` does.
- Palette: tier colour on the badge's DOT only, never tinted text.

## Review Focus

1. Two entries added in quick succession (or one from the window while the AI writes the same task): ids must not collide and neither write may be lost. Covered by `nextBlockerId` = max id + 1 over the STORED log and functional `setTasks(prev => …)` (Task 5 tests).
2. A legacy multi-line `blockers` text migrates to ONE entry carrying the whole text, and an editor save of that unchanged text adds nothing (Task 1 `setBlockersText` same-text case, Task 2 migration test).
3. Whitespace-only input: Add stays disabled, and an edit to blank is refused (the entry keeps its text) rather than creating an empty open blocker that marks the task blocked (Task 5).
4. A task whose log holds only resolved entries must read as NOT blocked everywhere: health, the blocked next-action, the insight (Task 3 reader tests).
5. An existing Turso database without the column must still save: the new column reaches `turso-migrate.ts` through `CSV_COLUMNS` (Task 2 test against the migrate PRAGMA-diff helper).

---

### Task 1: Pure blocker-log module

**Files:**
- Modify: `src/app/types.ts` (add `BlockerEntry`, `Task.blockerLog?`)
- Create: `src/app/blocker-log.ts`
- Test: `src/app/blocker-log.test.ts`

**Interfaces:**
- Produces:
  - `type BlockerEntry = { id: number; text: string; createdAt: string; authorResourceId?: number; authorName?: string; editedAt?: string; resolvedAt?: string }`
  - `blockersText(log: readonly BlockerEntry[] | undefined): string`: open entries, ascending `createdAt` (ties by `id`), joined `"\n"`
  - `openBlockerCount(log: readonly BlockerEntry[] | undefined): number`
  - `withBlockerLog(task: Task, log: BlockerEntry[]): Task`: new object with both fields
  - `nextBlockerId(log: readonly BlockerEntry[] | undefined): number`: max id + 1, 1 when empty
  - `type BlockerActor = { resourceId?: number; name?: string }`
  - `addBlocker(task, text, actor, now): Task` · `editBlocker(task, id, text, now): Task` · `resolveBlocker(task, id, now): Task` · `reopenBlocker(task, id): Task` · `deleteBlocker(task, id): Task`: each returns via `withBlockerLog`; `addBlocker`/`editBlocker` with blank trimmed text return the task BY REFERENCE (no-op)
  - `setBlockersText(task: Task, text: string, actor: BlockerActor, now: string): Task`
  - `migrateBlockers(task: Task): Task`: returns the SAME reference when nothing changes
  - `sanitizeBlockerLog(raw: unknown): BlockerEntry[] | undefined`: `undefined` for non-array or empty result

- [ ] **Step 1: Write the failing tests** in `blocker-log.test.ts`, named and asserting exactly:
  - `blockersText joins open entries oldest first and skips resolved`: log `[{id:2,text:"B",createdAt:"2026-01-02T00:00:00Z"},{id:1,text:"A",createdAt:"2026-01-01T00:00:00Z"},{id:3,text:"C",createdAt:"2026-01-03T00:00:00Z",resolvedAt:"2026-01-04T00:00:00Z"}]` → `"A\nB"`; `undefined` → `""`.
  - `withBlockerLog sets the log and the derived text together`.
  - `setBlockersText leaves the task untouched for the same text`: task migrated from `blockers:"X\nY"` → `setBlockersText(t," X\nY ",…)` returns `t` by reference.
  - `setBlockersText with empty text resolves every open entry`: two open → both `resolvedAt === now`, `blockers === ""`.
  - `setBlockersText with new text resolves the open ones and adds one`: result has old entries resolved, one new open entry `{ text: "New", authorName: actor.name, createdAt: now }`, `blockers === "New"`.
  - `migrateBlockers turns legacy text into one open entry`: `{blockers:"Line1\nLine2", lastUpdateDate:"2026-03-04"}` → `blockerLog` length 1, `text === "Line1\nLine2"`, `createdAt` starts with `"2026-03-04"`, no author.
  - `migrateBlockers lets the log win and is idempotent`: a task with `blockerLog` and a stale `blockers:"old"` → `blockers` re-derived; `migrateBlockers(migrateBlockers(t))` deep-equals `migrateBlockers(t)`; a task with `blockers:""` and no log is returned BY REFERENCE.
  - `addBlocker ignores blank text` and `editBlocker refuses blank text` (both by reference).
  - `nextBlockerId never reuses an id after a delete`: log ids `[1,5]` → `6`.
  - `sanitizeBlockerLog drops malformed entries and caps`: drops non-objects, missing/NaN `id`, blank `text`, unparseable `createdAt`; trims and caps `text` at `TEXTAREA_MAX`; keeps the first of duplicate ids; caps length at `MAX_NOTE_ENTRIES`; drops an unparseable `resolvedAt`/`editedAt` field but keeps the entry.

- [ ] **Step 2: Run** `npx vitest run src/app/blocker-log.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `types.ts` additions and `blocker-log.ts`. i18n-free, no React, no DOM. `migrateBlockers` uses `lastUpdateDate` + `"T00:00:00.000Z"` when it is a valid `YYYY-MM-DD`, else `new Date().toISOString()`.

- [ ] **Step 4: Run** the same command. Expected: PASS.

- [ ] **Step 5: Commit** `feat: add the pure blocker-log module`.

### Task 2: Load migration and the six write paths

**Files:**
- Modify: `src/app/task-status.ts` (`migrateTask` calls `migrateBlockers`)
- Modify: `src/app/csv-codecs-core.ts` (`CSV_COLUMNS` gains `"blockerLog"` after `"noteLog"`; `fieldToString` encodes it as `JSON.stringify(log)` or `""`)
- Modify: `src/app/csv-codecs-decode.ts` (`buildTaskFromObj` decodes `obj.blockerLog` through `sanitizeBlockerLog(JSON.parse(...))`, guarded by try/catch → `undefined`)
- Modify: `src/app/markdown-columns.ts` (task columns gain `{ key: "blockerLog", label: "BlockerLog" }` after NoteLog)
- Modify: `src/app/markdown-codecs-decode.ts` (`norm === "blockerlog"` → `"blockerLog"`, decoded like the CSV path) and `src/app/markdown-codecs-core.ts` if the task table codec needs the key listed (follow `noteLog`)
- Modify: the JSON / IndexedDB task load path. `migrateTask`'s docstring claims it "Runs on all six load paths"; a repo grep found callers only in the CSV and Markdown decoders and `templates.ts`. VERIFY whether `jsonToWorkspace` and the IndexedDB load reach `migrateTask`; where they do not, apply `sanitizeBlockerLog` + `migrateBlockers` at the point those paths build tasks, and correct the docstring in the same commit.
- Modify: `sample-workspace-small.json` (one existing task gains a `blockerLog` with one open and one resolved entry, and its `blockers` set to the open entry's text)
- Regenerate: `src/app/__fixtures__/golden-workspace.{csv,md}` via `npx vite-node scripts/regen-golden-fixtures.ts` (the sanctioned case: the master's content changed and a column was added)
- Test: `src/app/entity-persistence-registry.test.ts`, `src/app/golden-workspace.test.ts` (fixtures only), and the Turso migrate test file that covers `turso-migrate.ts`

**Interfaces:**
- Consumes: Task 1 `migrateBlockers`, `sanitizeBlockerLog`, `withBlockerLog`.
- Produces: every load returns tasks whose `blockers === blockersText(blockerLog)`.

- [ ] **Step 1: Write the failing tests:**
  - In `entity-persistence-registry.test.ts`, `blockerLog round-trips through CSV, Markdown, JSON, Turso single, Turso tenant and IndexedDB`: one task with a two-entry log (one resolved) survives each of the six paths deep-equal, and `blockers` equals the open entry's text after each. Count the six in the test name's assertions; where the file has no harness for a path, add the narrowest one that executes that path's real encoder/decoder.
  - `a legacy text-only task loads with one open entry on every path`: `blockers:"Waiting on vendor"`, no log → after each decode, `blockerLog.length === 1`.
  - Turso: `turso-migrate adds the blockerLog column to an existing task table`: the PRAGMA-diff helper, given a column list without `blockerLog`, emits an `ALTER TABLE … ADD COLUMN blockerLog`.

- [ ] **Step 2: Run** `npx vitest run src/app/entity-persistence-registry.test.ts`. Expected: FAIL on the new cases.

- [ ] **Step 3: Implement** the codec, decoder and migration edits listed above. Then update `sample-workspace-small.json` and run the regen script; check its output reports a non-empty task count.

- [ ] **Step 4: Run** `npx vitest run src/app/entity-persistence-registry.test.ts`, then separately `npx vitest run src/app/golden-workspace.test.ts`. Expected: PASS both.

- [ ] **Step 5: Commit** `feat: persist the blocker log on all six storage paths`.

### Task 3: Text writers, stored-row carry, readers

**Files:**
- Modify: `src/app/chat-task-patch.ts` (the `patch.blockers` branch writes via `setBlockersText` against the STORED task, actor = the AI actor used for activity, `now` = the patch time)
- Modify: `src/app/bulk-operations-helpers.ts` / `src/app/use-bulk-operations.ts` (bulk `blockers` via `setBlockersText` per task)
- Modify: `src/app/use-action-center-handlers.ts` (Clear-blocker: `setBlockersText(task, "", actor, now)` in place of `blockers: ""`)
- Modify: `src/app/templates.ts`, `src/app/templates-builtin.ts` (template tasks with blocker text pass through `migrateBlockers`)
- Modify: `src/app/use-task-submit.ts` (drop `blockers` from the submit payload; carry `blockerLog` and `blockers` from the STORED row, the way the existing `noteLog` comment at the payload describes)
- Modify: `src/app/use-inline-cell-edit.ts`, `src/app/task-inline-patch.ts` (remove the `blockers` inline field; the cell becomes the badge in Task 6)
- Modify: `src/app/chat-tool-defs.ts` (`blockers` description: `"Replaces the task's open blockers with this text (the previous open ones are marked resolved). An empty string resolves them all."`)
- Audit, then test each that rebuilds a task: `use-jira-sync.ts`, `ai-project-proposal.ts`, `use-chat-dispatcher.ts`, `use-gantt-handlers.ts`, `use-calendar-integrations.ts`, `use-task-row-handlers.ts`, `use-tasks-dedup.tsx`, `use-storage-file-ops.ts`, `resource-email-propagation-commit.ts`, `knowledge-panel.tsx`, `ai-entity-token.ts`, `use-resource-planner.ts` (from `grep -l "setTasks(" src/app --include=*.ts --include=*.tsx`, re-run it first; the set may have changed). A writer that spreads the stored task (`{...t, x}`) carries the log for free and needs no change; record that verdict per file in the commit body.
- Test: `src/app/chat-task-patch.test.ts`, `src/app/use-bulk-operations.test.tsx` (or the helpers test), `src/app/use-action-center-handlers.test.tsx`, `src/app/use-task-submit.test.tsx`, `src/app/health.test.ts`, `src/app/next-actions/providers/task-attention.test.ts`, `src/app/insights/detect.test.ts`

**Interfaces:**
- Consumes: Task 1 `setBlockersText`, `migrateBlockers`, `BlockerActor`.

- [ ] **Step 1: Write the failing tests**, each with a SEEDED two-entry log so a dropped field fails:
  - `AI update_task blockers replaces the open blockers and keeps the history`
  - `AI update_task without blockers leaves the log untouched`
  - `bulk blockers edit resolves the open entries on every selected task`
  - `Clear-blocker resolves every open entry and keeps them as history`
  - `editor save keeps a log written by the window after the editor opened`: open the editor, add an entry to the stored row, save → entry present
  - Reader tests, `a resolved-only log is not blocked`, in `health.test.ts`, `task-attention.test.ts` and `detect.test.ts`
  - One test per audited writer that DOES rebuild a task from parts

- [ ] **Step 2: Run** each new test file singly. Expected: FAIL on the new cases.

- [ ] **Step 3: Implement** the edits above.

- [ ] **Step 4: Run** each file singly. Expected: PASS.

- [ ] **Step 5: Commit** `feat: route every blockers write through the blocker log`.

### Task 4: Extract FloatingLogWindow

**Files:**
- Create: `src/app/floating-log-window.tsx`
- Modify: `src/app/notes-window.tsx` (renders `FloatingLogWindow`, no behaviour change)
- Test: `src/app/notes-window.test.tsx` (must pass unchanged), `src/app/floating-log-window.test.tsx`

**Interfaces:**
- Produces: `FloatingLogWindow(props: { open: boolean; onClose: () => void; title: string; storageKeyPrefix: string; helpConceptId: HelpConceptId; lang: Lang; children: ReactNode })`. It owns `useResizable`, `useDraggableWindow`, `usePanelInitialFocus`, `useClaimsWhenFocusWithin` + `useDismissable({kind:"layer"})`, the title bar (HelpIconButton, ResetSizeButton, Close), the `<body>` portal, `NOTES_WINDOW_Z` and `FLOATING_LAYER_ATTR`. The storage keys are `${storageKeyPrefix}-pos` and `${storageKeyPrefix}-size`; `NotesWindow` passes `"aipm-cockpit:notes-window"` so its saved keys are unchanged.

- [ ] **Step 1: Write the failing test** `floating-log-window.test.tsx`: `portals to body with the layer marker and the notes z-index`, `Escape closes only while focus is inside`, `uses the given storage keys`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** by moving code out of `notes-window.tsx`; move the long comments with the code they describe.
- [ ] **Step 4: Run** `floating-log-window.test.tsx`, then `notes-window.test.tsx`. Expected: PASS both, the second unmodified. Then the copy-instead-of-move check (a test run cannot see a duplicate that agrees with the original): `git grep -n "useDraggableWindow(\|useClaimsWhenFocusWithin(" -- src/app/notes-window.tsx` prints nothing.
- [ ] **Step 5: Commit** `refactor: extract the floating log window chrome`.

### Task 5: Blocker window and its hook

**Files:**
- Create: `src/app/blocker-log-panel.tsx`, `src/app/blockers-window.tsx`, `src/app/use-blockers-window.ts`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (node UTF-8 write), `src/app/help-content.ts` (`MODAL_HELP.blockersWindow`, pointing at the Blockers help concept)
- Test: `src/app/blocker-log-panel.test.tsx`, `src/app/use-blockers-window.test.tsx`

**Interfaces:**
- Consumes: Task 1 mutators; Task 4 `FloatingLogWindow`.
- Produces: `useBlockersWindow(deps: { tasks: readonly Task[]; setTasks: Dispatch<SetStateAction<readonly Task[]>>; selfResourceId?: number; resources: readonly Resource[]; lang: Lang; logActivity: (kind: ActivityKind, ...args: (string|number)[]) => void }): { openTaskBlockers: (id: number) => void; blockersWindowProps: BlockersWindowProps }`; `BlockersWindow(props: BlockersWindowProps)`.
- i18n keys (EN / DE):
  - `blockerLogTitle` "Blockers" / "Blocker"
  - `blockerLogAdd` "Add blocker" / "Blocker hinzufügen"
  - `blockerLogPlaceholder` "What is blocking this task?" / "Was blockiert diese Aufgabe?"
  - `blockerLogOpen` "Open" / "Offen"
  - `blockerLogResolvedHeading` "Resolved ({0})" / "Gelöst ({0})"
  - `blockerLogResolve` "Resolve" / "Lösen"
  - `blockerLogReopen` "Reopen" / "Wieder öffnen"
  - `blockerLogEmpty` "No blockers recorded." / "Keine Blocker erfasst."
  - `blockerLogDeleteConfirm` "Delete this blocker?" / "Diesen Blocker löschen?"
  - `blockerBadgeLabel` "Blockers – {0} ({1} open)" / "Blocker – {0} ({1} offen)"
  - Reuse the existing `edit`, `delete`, `save`, `cancel` keys; grep before adding any.

- [ ] **Step 1: Write the failing tests:**
  - Panel: `adds an entry and clears the box`, `Add is disabled for blank text`, `edit to blank keeps the old text`, `resolve moves an entry under Resolved`, `Resolved is collapsed by default and lists the count`, `reopen moves it back`, `delete asks first`, `per-entry controls have row-unique names`.
  - Hook: `two quick adds get distinct ids and both land`: call add twice in one `act` → two entries, ids 1 and 2; `a write targets the stored row`: mutate the task in state between open and add → the add lands on the mutated row; `each action logs task.updated with the task id`.
- [ ] **Step 2: Run** each file singly. Expected: FAIL.
- [ ] **Step 3: Implement.** Every write is `setTasks(prev => prev.map(t => t.id === id ? mutator(t, …) : t))`. Author is the self resource: name from `resources`, falling back to no author, mirroring `use-notes-window.ts`.
- [ ] **Step 4: Run** each file singly. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add the blocker log window`.

### Task 6: Badge, editor button, mount, bulk hint, docs

**Files:**
- Create: `src/app/blockers-badge-button.tsx` (shaped like `notes-badge-button.tsx`; accessible name `blockerBadgeLabel` with the row token and open count; dot coloured `TIER_RAG.now.dot` when open > 0, muted with no number at 0)
- Modify: `src/app/task-row.tsx` (the `blockers` cell renders the badge; `onOpenBlockers` threads through the row props and `task-row-context` as `onOpenNotes` does)
- Modify: `src/app/tasks-section.tsx`, `src/app/task-manager.tsx` (call `useBlockersWindow`, mount `{!isPopout && <BlockersWindow …/>}` beside `NotesWindow`, thread `openTaskBlockers`)
- Modify: `src/app/task-form-fields.tsx` (replace the blockers `Field` textarea with a "Blockers (N)" button beside the Notes button; for a new task do exactly what the Notes control does there, and record what that is in the commit body)
- Modify: `src/app/task-form-context.tsx` (drop `blockers` from the form shape if nothing else reads it)
- Modify: `src/app/bulk-edit-modal.tsx` (hint text `bulkBlockersHint`: "Replaces the open blockers on each task; they are kept as resolved." / "Ersetzt die offenen Blocker jeder Aufgabe; sie bleiben als gelöst erhalten.")
- Modify: the Blockers help text: `git grep -n "Blockers" src/app/help-content.ts src/app/i18n.ts` finds the concept/hint keys (`taskHintBlockers` at least); reword them for the badge and window, EN and DE
- Modify: `docs/AGENTS/rich-text.md` ("Blocker log" subsection: the derived-text rule, `withBlockerLog` as the only writer, the stored-row carry, the writer list from Task 3), `lib/app-feature-guide.md` (Open Points section: the badge and window), then `node scripts/gen-operating-guide.mjs` to regenerate `operating-guide-builtin.generated.ts`
- Test: `src/app/blockers-badge-button.test.tsx`, `src/app/task-row.test.tsx`, `src/app/task-form-fields.test.tsx` (or the existing task-form test file)

**Interfaces:**
- Consumes: Task 5 `useBlockersWindow`, `BlockersWindow`.

- [ ] **Step 1: Write the failing tests:** `badge shows the open count and a red dot`, `badge with none open is muted and shows no number`, `badge name is row-unique and contains the visible text`, `task row blockers cell opens the blocker window for that task`, `editor Blockers button opens the window and shows the open count`, `editor no longer renders a blockers textarea`.
- [ ] **Step 2: Run** each file singly. Expected: FAIL.
- [ ] **Step 3: Implement** the edits above.
- [ ] **Step 4: Run** each file singly. Expected: PASS. Then `npx playwright test --list` only (no browsers), so the e2e seed still imports after the sample-data change.
- [ ] **Step 5: Commit** `feat: open blockers from a counting badge`.

---

## Notes for the executor

- After Task 6, eye-verify in the dev app: open a task's blockers from the table AND from inside the open task editor; both windows (notes and blockers) usable together with the editor.
- Open Points is in the axe `A11Y_VIEWS`; CI scans the badge. The window is never scanned (it opens on click), so its names rest on the Task 5 unit tests.
