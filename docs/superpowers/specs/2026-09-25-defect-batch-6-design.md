# Defect batch 6 — design

**Date:** 2026-09-25
**Branch:** `fix/defect-batch-6` (worktree `C:/Projects/aipm-wt-a`)
**Issues:** #359 (§574) · #360 (§575) · #328 (§538) · #243 (§337, token half) · #297 (§468) · #308 (§486)

## Intent

Close six open, user-facing defects in one PR. Every one was re-verified against `origin/main`
at `84ec39674` on 2026-09-25 by a read-only verdict pass before scoping; five are STILL-OPEN as
described, #243 is PARTIALLY-FIXED (the URL half shipped in `28b517b77`, the token half remains).

Success = each defect is gone, each fix is pinned by a test that is red on the unfixed code and
mutation-checked, the six register entries and GitHub issues are closed (or, for §337, rewritten
then closed), and `gate:local` passes.

## Constraints

- **Peer session `cockpit-main`** is folding Dependabot PRs #412–#416. Do NOT touch:
  `package*.json`, `desktop/package*.json`, `.github/*`, `src/app/icons.ts(+test)`,
  `error-boundary.tsx`, `recovery-banner.tsx`, `recovery-panel.tsx`, `vitest.config.ts`,
  `vitest.setup.ts`, `src/test/*`, `AGENTS.md`, `scripts/release-publish-lib*`,
  `desktop/src/updater*`.
- **CPU lock:** vitest / e2e / `gate:local` only while holding the `LOCK vitest` token agreed with
  `cockpit-main`. Code and tests may be written while the peer holds it.
- `APP_VERSION` is not bumped here (the peer may take 1.14.1).
- `src/app/*` files are CRLF; `i18n.de.ts` is edited by node utf8 write matching `\r\n`, never
  the Edit tool.

## Structure

One branch, one PR, **one commit per issue** (fix + test + register/issue update), so each can be
reverted independently. TDD per commit: failing test first, then fix, then a named mutant that
turns the test red.

---

## 1. #359 / §574 — "Load project from file" in Firefox/Safari

**Defect.** `pickOpenFileAny` (`fs-access.ts`) throws
`StorageNotReadyError("file-system-access-unsupported")`; `reportProjectError`
(`use-storage-backend.ts`) maps every hint except `"local-file-permission-needed"` to
`storageNotReady` ("Storage isn't configured yet — pick a file in Settings."), which blames
Settings for a browser limitation. The load-from-file CTAs never check support.

**Fix.**
- `reportProjectError`: `"file-system-access-unsupported"` → the existing `storageFsaUnsupported`
  key (already in EN + DE).
- The load-from-file CTAs (`task-manager.tsx` and `workspace-section.tsx` call sites) render
  **disabled** when `isFileSystemAccessSupported()` is false, with the same message as their
  description/tooltip. They stay visible so the capability is discoverable.

**Tests.** Unsupported browser → `storageFsaUnsupported` toast, not `storageNotReady`; CTA
disabled with the explanatory text. Mutant: drop the new branch → red.

## 2. #360 / §575 — chat history attachment budget

**Defect.** `MAX_STAGED_PAYLOAD_BYTES` (30 MB, `chat-attachments.ts`) caps only the current
message's staged files. `submitPrompt` (`chat-panel.tsx`) sends the full in-memory history, whose
earlier turns keep their attachment blocks, so a multi-attachment thread can exceed the Messages
API's 32 MB request limit.

**Fix.**
- New pure `fitHistoryToBudget(messages, maxBytes)` in `chat-attachments.ts`. It measures each
  attachment block's contribution to the serialized request; while the total exceeds
  `MAX_STAGED_PAYLOAD_BYTES`, it replaces the **oldest earlier-turn** attachment block with the
  existing `attachmentPlaceholder` text. The **current turn is never stripped.** Returns a new
  array; inputs are not mutated.
- `submitPrompt` applies it to the outgoing copy only (`const messages = …`). The stored
  `history` is untouched, so an under-budget thread sends byte-identical requests to today and the
  prompt-cache prefix is undisturbed.
- A current turn that alone exceeds the budget is already refused by the existing staging cap.

**Tests.** Under budget → identity (same bytes); over budget → oldest stripped first, stops as
soon as it fits; current turn never stripped; input history not mutated. Mutant: strip newest-first
→ red.

## 3. #328 / §538 — single-DB Turso persists project meta

**Defect.** In single-DB Turso mode `workspaceToStatements` emits no statement for `ws.project`
(the `dirtyWorkspaceTables` docstring says it is "DELIBERATELY excluded") and `loadSingleTenant`
never reads one; only tenant mode has a `projects` row. `setProject` changes memory only, lost on
reload. `handleUpdateCurrentProjectByMode` (`use-turso-projects.ts`) silently does nothing in
turso mode without a `tursoProjectId`.

**Fix.**
- Save: single-DB mode writes `ProjectMeta` as JSON under a new `project_meta` key in the `meta`
  table, beside the existing `project_status` row. Tenant mode is unchanged (it keeps its
  `projects` row). The statement builder receives the mode explicitly.
- Load: `loadSingleTenant` / `rowsToWorkspace` read `project_meta` back into `ws.project`. An
  unparseable row is reported via `reportUnreadableSlice("project_meta", err)` — the
  `project_status` pattern — and the load succeeds without it.
- `dirtyWorkspaceTables` treats a `project` change as dirtying `meta`, so a meta-only edit saves.
- `handleUpdateCurrentProjectByMode`: in single-DB turso mode, update the in-memory project so the
  normal save persists it, instead of the silent no-op.

**Tests.** Round trip through the real statements on `node:sqlite` (the
`turso-schema.execute.test.ts` harness); tenant-mode statements unchanged; unreadable
`project_meta` reported and skipped; meta-only edit marks `meta` dirty. Mutant: skip the load
read → red.

## 4. #243 / §337 — rejected deployment auth token

**Defect (remaining half).** A non-empty `NEXT_PUBLIC_TURSO_AUTH_TOKEN` hides the Settings token
field (`envTursoTokenSet`) and always wins in `getTursoConfig`; `TursoBackend.isReady()` is
`config !== null`, so a wrong token reads as ready. A wrong token is undetectable locally — only
the server's 401/403 reveals it.

**Fix.**
- A Turso 401/403 response is classified as a new storage status **token rejected**, with a
  message "Deployment token rejected — check `NEXT_PUBLIC_TURSO_AUTH_TOKEN`" (EN + DE).
- On that rejection a per-device flag is recorded (settings-scoped, NOT workspace data, NOT a
  secret). While it is set, the Settings token field is shown even though an env token exists,
  and `getTursoConfig` prefers a non-empty Settings token over the env token — the same
  precedence shape the URL half adopted. The Settings token is sealed through the existing
  `tursoAuthToken` secret path.
- `docs/open-followups.md` §337 is rewritten to record the URL half as shipped in `28b517b77`.

**Tests.** `getTursoConfig` precedence before/after a recorded rejection; field visibility;
401 → token-rejected status. Mutant: ignore the flag in precedence → red.

## 5. #297 / §468 — desktop PDF export → save-as dialog

**Defect.** `export.ts` and `document-download.ts` open `window.open("", "_blank")` and inject a
script that calls `window.print()`, which Electron refuses; the shell has no main-process print or
PDF route, so the tab renders and no dialog appears.

**Fix (decided: save-as, no visible tab).**
- No preload bridge is introduced (none exists). In the desktop shell (`isDesktopShellUserAgent`),
  the renderer opens `window.open("", "aipm-pdf-export")` and omits the auto-print script.
- New pure `decidePdfExport(frameName)` in `desktop/src/lib/` (unit-tested, beside
  `window-open-policy.ts`) recognises the frame name.
- `main.ts`: the window-open handler creates that window hidden; after it finishes loading, the
  main process calls `webContents.printToPDF()`, shows `dialog.showSaveDialog` (default name
  derived from the page title + `.pdf`), writes the file, closes the window. Cancel closes the
  window and writes nothing. Errors are logged via the existing exit/log reporting and the window
  is closed.
- Browser path unchanged: `_blank` + auto-print outside the desktop shell.

**Tests.** `decidePdfExport` unit tests; renderer picks the frame name + omits auto-print only in
the desktop UA. `main.ts` is outside the root typecheck, so the glue is verified by the MANUAL
desktop-package build and an eye-check of the save flow (recorded in the PR).

## 6. #308 / §486 — Outlook sync opt-out

**Defect.** `prune` (`use-entity-calendar-pull.ts`, and the milestone twin) only clears
`outlookEventId`; `planEntityReconcile` / `planCalendarReconcile` create every unlinked item, so
auto-push re-creates the event the user just pruned. No field records the user's intent.

**Data.** New optional `calendarOptOut?: boolean` on the six calendar-capable entities: `Task`,
`RaidItem`, `Milestone`, `CommitteeMeeting`, `ChangeItem`, `Absence`. Absent/`false` = syncs as
today.

**Six write paths.**
- CSV + Turso single + Turso tenant: one column per entity in its `*_CSV_COLUMNS`
  (`csv-codecs-core.ts`) with its field-to-string / build-from-object pair. Existing Turso DBs
  self-heal via `turso-migrate.ts` (`ALTER ADD COLUMN`).
- Markdown: `*_MD_COLUMNS` + table codec (`markdown-codecs-core.ts`).
- `sanitize.ts`: keep a boolean, drop anything else.
- JSON + IndexedDB: carried as part of the object; each gets its own round-trip test regardless.
- Regenerate `__fixtures__/golden-*` (legitimate new-column format change); add one opted-out
  item to `sample-workspace-small.json`, then regenerate `-big` / `-huge`.

**Behaviour.**
- Prune sets `calendarOptOut: true` alongside clearing `outlookEventId`.
- Both planners and every push hook's pushable list skip `calendarOptOut` items — never created,
  never updated.
- A **"Sync to Outlook"** checkbox in each of the six edit modals, default checked, shown only when
  calendar sync is configured. Re-checking clears the opt-out → the next push re-creates the event.
  Unchecking a linked item clears the link and stops updates; the Outlook event is never deleted
  by the app (same semantics as prune). EN + DE strings; the accessible name is row-unique
  ("Sync to Outlook – ‹title›") and the control is a real labelled checkbox.
- A malformed stored value is dropped by sanitize and the item syncs as before — the safe
  direction, since opting out is the deliberate user choice.

**Tests.** Prune sets the flag; both planners skip opted-out items for create AND update;
re-check returns the item to the create list; per-backend round trip with `calendarOptOut: true`;
modal checkbox label + toggle. Mutant: drop the planner filter → red.

---

## Out of scope

- Deleting Outlook events on opt-out.
- The rest of the defect register.
- `APP_VERSION` / `CHANGELOG.md` (release-time, owner's call).

## Verification before PR

`npx tsc --noEmit`, `npx eslint --max-warnings=0 src`, `npm run test:shuffle`, `npm run size:check`,
`npm run dup:check`, `npm run docs:claims:check`, `npm run followups:index:check`, and
`npm run gate:local` (under the lock); axe for the six edit modals' views
(`--workers=1`); manual desktop package for #297.
