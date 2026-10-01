# Two windows on one storage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A save that would overwrite another writer's newer data pauses with a banner (Reload / Overwrite / Download my version) instead, windows on one storage mirror all 29 workspace parts, and a local-file window keeps its own file handle (§4, §645).

**Architecture:** Each backend gains a revision (SharePoint eTag, file `lastModified`, a browser `kv` counter, a Turso `meta` row) checked inside its own `save()`; a stale save throws `SaveConflictError`, which `useStorageBackend` turns into a `"conflict"` save pause. Tab sync (`broadcast-sync.ts`) mirrors the 12 remaining parts and carries a revision message so mirroring windows adopt each other's revision.

**Tech Stack:** Next.js / React 19, TypeScript, vitest + fake-indexeddb + node:sqlite, Playwright, Web Locks API, Microsoft Graph (SharePoint), libSQL Hrana (Turso).

**Spec:** `docs/superpowers/specs/2026-09-29-two-tab-conflict-design.md`

## Global Constraints

- Owner decisions are binding: detect and pause; no automatic merge; three banner actions (Reload, Overwrite, Download my version); edits keep being journalled while paused.
- `SaveConflictError` writes NOTHING: the check runs before the first write of the save.
- A backend with no stored revision treats it as 0 and stamps 1 on its first save.
- A Turso message and a sync message never carry the auth token.
- i18n: EN (`i18n.ts`) and DE (`i18n.de.ts`) key sets identical; DE via node utf8 write with `\r\n` anchors, never the Edit tool; keys `storageSavePausedConflict`, `storageConflictReload`, `storageConflictOverwrite`, `storageConflictDownload`, `storageConflictReloadConfirm`, `storageConflictOverwriteConfirm`, `storageConflictNotSavedOnSwitch`.
- Banner copy (EN, exact): headline "This project was changed in another tab or on another device. Your changes since then are not saved yet."; Reload confirm "Reload the saved version and discard your unsaved changes?"; Overwrite confirm "Save your version over the other one? Its changes since you opened the project will be lost."
- `src/**` files are CRLF in the working tree; never `sed -i`; check with `git ls-files --eol`.
- Every task: `npx tsc --noEmit` exit 0, `npx eslint --max-warnings=0 <touched files>` exit 0, its vitest files green; one vitest process at a time (coordinate the lock with the other session).
- Commits cite §N only; no attribution trailer; never `--amend`.
- **Order:** Task 10 (Turso) starts only after the other session's `fix/persistence-backlog` (§637 conditional batch) has merged to `main`; rebase first.

## Review Focus

1. A window that saved and then receives a mirrored edit saves again: it must NOT pause (its own and its peers' revisions are adopted). Pinned in Task 6.
2. Overwrite after a conflict must not half-merge: browser storage must also DELETE rows only the other writer added. Pinned in Task 2.
3. A local file changed by another program (not another tab) between two saves: the next save pauses rather than overwriting. Pinned in Task 3.
4. A conflict during the pre-switch flush must not block the switch and must not lose the edits (journal keeps them). Pinned in Task 7.
5. The banner must stay after a dismiss/reopen and the sidebar must show "saving paused" while the conflict pause holds. Pinned in Task 8.

---

### Task 1: Revision contract and `SaveConflictError`

**Files:**
- Modify: `src/app/storage-error.ts`, `src/app/workspace.ts` (`StorageBackend`)
- Test: `src/app/storage-error.test.ts` (create if absent, else extend)

**Interfaces:**
- Produces: `class SaveConflictError extends Error { readonly kind: StorageKind }`; `isSaveConflict(err: unknown): err is SaveConflictError`.
- Produces on `StorageBackend` (all optional so fakes stay valid): `revision?(): string | null` (what this instance last loaded or wrote, `null` before any load); `adoptRevision?(rev: string): void`; `forceNextSave?(): void` (the next `save()` skips the compare and does a full rewrite, then clears itself).

- [ ] Step 1: tests `isSaveConflict` is true for `new SaveConflictError("browser")`, false for `new Error("x")`, `null`, `StorageNotReadyError`; the error's `name` is `"SaveConflictError"`.
- [ ] Step 2: run, expect FAIL (not exported).
- [ ] Step 3: implement both in `storage-error.ts`; add the three optional members to `StorageBackend` with one-line docs.
- [ ] Step 4: run, expect PASS; `npx tsc --noEmit` exit 0.
- [ ] Step 5: commit `feat: §4 SaveConflictError and the backend revision contract`.

### Task 2: Browser storage revision

**Files:**
- Modify: `src/app/browser-backend.ts`
- Test: `src/app/browser-backend.revision.test.ts` (create; fake-indexeddb as in `browser-backend.test.ts`)

**Interfaces:**
- Consumes: Task 1.
- Produces: `KV_REVISION_KEY = "revision"` in the `kv` store (integer); lock name `aipm-cockpit:save:browser`.

- [ ] Step 1: tests, each on two `BrowserBackend` instances over ONE fake IndexedDB:
  - `load` on an empty store gives `revision() === "0"`; first `save` stamps `"1"` and `revision()` returns `"1"`.
  - A saves, then B (loaded before A's save) saves → B rejects with `SaveConflictError` and B's data is NOT written (reload shows A's tasks).
  - B `adoptRevision(A.revision())` then saves → succeeds.
  - B `forceNextSave()` then saves → succeeds, and a task only A had added is gone after reload (full rewrite deletes it — Review Focus 2); a second normal save by B checks again.
  - With `navigator.locks` absent, save still compares (no lock) — same results.
- [ ] Step 2: run, expect FAIL.
- [ ] Step 3: implement: `load` reads `KV_REVISION_KEY` (missing → 0); `save` runs under `navigator.locks.request("aipm-cockpit:save:browser", …)` when available: read stored revision, compare with the instance's, throw before any write on mismatch, write, then store and adopt `stored + 1`. `forceNextSave` sets a flag that skips the compare and resets the per-store baselines to empty maps AND clears each id-keyed store before writing.
- [ ] Step 4: run this file and `browser-backend*.test.ts`, expect PASS.
- [ ] Step 5: commit `feat: §4 browser storage refuses a stale save`.

### Task 3: Local file revision and a handle per window (§645)

**Files:**
- Modify: `src/app/local-file-backend.ts`
- Test: `src/app/local-file-backend.revision.test.ts` (create; extend the `writableFakeHandle` pattern with `lastModified`)

**Interfaces:**
- Consumes: Task 1.
- Produces: private `boundHandle: FsHandle | null` on `LocalFileBackend`; revision = `String(file.lastModified)`; lock name `aipm-cockpit:save:<kind>`.

- [ ] Step 1: tests:
  - after `load`, `revision()` equals the fake file's `lastModified`; after `save`, it equals the NEW `lastModified`.
  - a foreign write between load and save (another program: bump the fake's content and `lastModified`) → save rejects with `SaveConflictError` and the file content is unchanged (Review Focus 3).
  - §645: instance A bound to file X; instance B calls `setHandle(Y)` (rewrites the shared slot); A's next save writes X, not Y.
  - a fresh instance with no bound handle still reads the slot (restores the last file on startup).
  - `forceNextSave()` writes despite a foreign change and adopts the new `lastModified`.
- [ ] Step 2: run, expect FAIL.
- [ ] Step 3: implement: `getHandle()` returns `boundHandle` when set, else reads the slot and binds it; `setHandle`, `pickFile`, `openFile` and `loadFrom(handle)` bind; `save` uses the bound handle; compare `getFile().lastModified` with the instance revision under the lock, write, then re-read and adopt.
- [ ] Step 4: run this file and `local-file-backend.test.ts`, `storage.test.ts`, `use-storage-file-ops*.test.tsx`, expect PASS.
- [ ] Step 5: commit `feat: §4 §645 local files refuse a stale save and keep their own handle`.

### Task 4: SharePoint eTag with `If-Match`

**Files:**
- Modify: `src/app/sharepoint-backend.ts`, `src/app/fetch-with-timeout.ts` (`FetchTextResult` gains `etag: string | null` from the `ETag` response header)
- Test: `src/app/sharepoint-backend.test.ts` (extend; stubbed `fetch`)

**Interfaces:**
- Consumes: Task 1.
- Produces: SharePoint revision = the driveItem eTag.

- [ ] Step 1: tests: load captures the response `ETag` as `revision()`; save sends `If-Match: <revision>`; a 412 response rejects with `SaveConflictError`; a 200/201 response adopts the body's `eTag`; `forceNextSave()` omits `If-Match` once; a load without an `ETag` header gives `revision() === null` and the save omits `If-Match` (degrades to today's behaviour).
- [ ] Step 2: run, expect FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: run, expect PASS.
- [ ] Step 5: commit `feat: §4 SharePoint saves send If-Match`.
- [ ] Step 6 (manual, owner or a session with tenant access): against a real SharePoint file, edit it elsewhere, then save from the app; expect the conflict. If Graph ignores `If-Match` on the content PUT, implement the spec's fallback (metadata GET of the eTag under a Web Lock, compare, then PUT) and record it in the register.

### Task 5: Mirror all 29 parts

**Files:**
- Modify: `src/app/use-storage-backend.ts`
- Test: `src/app/use-storage-backend.test.tsx` (extend the §644 "records every synced slice" test)

**Interfaces:**
- Consumes: `useBroadcastSync(kind, value, setter, syncContext)` and `mark()` in `applyWorkspaceFromLoad` (from #484).
- Produces: 12 new sync kinds, named after the fields: `plan`, `fxRates`, `status`, `fieldVisibility`, `features`, `steeringCommittee`, `timelogLinks`, `knowledgeItems`, `insights`, `settingsOverrides`, `calendarEvents`, `documentAssets`.

- [ ] Step 1: first confirm each of the 12 is a `Workspace` field set by `applyWorkspaceFromLoad` (grep the setters there); record any that is not in the task report and skip it.
- [ ] Step 2: measure `documentAssets` on the largest sample workspace (`JSON.stringify` length). Under 1,000,000 characters: mirror it like the others. Otherwise mirror only a marker `{ count, updatedAt }` under the kind `documentAssetsMarker`; a receiver does not apply it, so its next save meets the revision check and pauses instead of dropping the other window's images. Record the choice and the measured size in the task report.
- [ ] Step 3: tests: the existing §644 test's `slice(-17)` becomes the full count (29, or 28 plus the marker); every object-valued slice of a load and of a merge-mode reload is recorded; `calls.map(c => c[0])` contains each of the 12 kinds.
- [ ] Step 4: run, expect FAIL.
- [ ] Step 5: implement: 12 `useBroadcastSync` calls with `syncContext`; wrap each setter's value in `applyWorkspaceFromLoad` with `mark(...)` (`setPlan` only when `workspace.plan` is set, as today).
- [ ] Step 6: run `use-storage-backend.test.tsx`, `broadcast-sync.test.ts`, `use-unload-journal*.test.tsx`, expect PASS.
- [ ] Step 7: commit `feat: §4 mirror every workspace part between windows on one storage`.

### Task 6: The revision message

**Files:**
- Modify: `src/app/broadcast-sync.ts`, `src/app/use-storage-backend.ts`
- Test: `src/app/broadcast-sync.test.ts`, `src/app/use-storage-backend.test.tsx`

**Interfaces:**
- Consumes: Tasks 1–4 (`revision()`, `adoptRevision()`), `SyncContext`.
- Produces: `postRevision(sync: SyncContext, revision: string): void` and `useRevisionSync(sync: SyncContext, onRevision: (rev: string) => void): void` in `broadcast-sync.ts`; message `{ clientId, windowId, kind: "__revision", scope, revision }`.

- [ ] Step 1: hook tests: a main window with the same non-null scope and a committed epoch calls `onRevision`; another scope, a null scope, a moved epoch, and a pop-out all do not; a pop-out never posts.
- [ ] Step 2: integration test in `use-storage-backend.test.tsx` (Review Focus 1): after a confirmed save the hook posts `backend.revision()`; an incoming revision calls `backend.adoptRevision(rev)`.
- [ ] Step 3: run, expect FAIL.
- [ ] Step 4: implement; in `doSave`'s success path post the revision; wire `useRevisionSync` to `backend.adoptRevision?.(rev)`.
- [ ] Step 5: run, expect PASS.
- [ ] Step 6: commit `feat: §4 windows on one storage adopt each other's revision`.

### Task 7: The `"conflict"` pause and journalling while paused

**Files:**
- Modify: `src/app/use-storage-backend.ts`, `src/app/use-unload-journal.ts`, `src/app/use-load-truncation.ts` (only if the flush path lives there)
- Test: `src/app/use-storage-backend.conflict.test.tsx` (create, on the `use-storage-backend.*.test.tsx` harness), `src/app/use-unload-journal.test.tsx` (extend)

**Interfaces:**
- Consumes: Task 1.
- Produces: `savesPaused.reason` union gains `"conflict"`; `loadPause` may be `"conflict"`; the hook returns `conflictPause: boolean`.

- [ ] Step 1: tests:
  - a mocked `backend.save` rejecting with `SaveConflictError` sets the conflict pause, shuts the gate (the next edit calls no save) and toasts once.
  - while paused, a `pagehide` writes the journal with the LIVE workspace (the latest edit included), not the rejected outgoing one.
  - a conflict in the pre-switch flush: the switch still happens, the journal holds the outgoing workspace, and the toast `storageConflictNotSavedOnSwitch` shows (Review Focus 4).
- [ ] Step 2: run, expect FAIL.
- [ ] Step 3: implement: in `doSave`'s `.catch`, `isSaveConflict(err)` → `setSavesPaused({ backend, reason: "conflict" })` through the existing emit path; `useUnloadJournal` gains `followLive(ws)` used while the pause holds; the flush path catches the conflict and toasts.
- [ ] Step 4: run, expect PASS.
- [ ] Step 5: commit `feat: §4 a stale save pauses saving and keeps the edits journalled`.

### Task 8: The banner

**Files:**
- Modify: `src/app/notifications.tsx`, `src/app/task-manager.tsx`, `src/app/sidebar-footer.tsx` (if the indicator needs it), `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/notifications.test.tsx`, `src/app/task-manager.truncation-banner.test.tsx` (or a sibling)

**Interfaces:**
- Consumes: Task 7 (`conflictPause`), Task 9 handlers.
- Produces: `SavingPausedCause` gains `{ kind: "conflict" }`; `SavingPausedBanner` gains optional `onOverwrite?: () => void` and `onDownload?: () => void`; for `conflict`, `onSaveAnyway` is Reload.

- [ ] Step 1: tests: the conflict cause renders the exact EN headline; three buttons with unique accessible names; Reload and Overwrite each ask their exact confirm first and call their handler only on confirm; Download calls its handler without a confirm; dismiss then reopen shows it again; the sidebar indicator is on while `conflictPause` (Review Focus 5); DE strings load (`loadI18n("de")`).
- [ ] Step 2: run, expect FAIL.
- [ ] Step 3: implement; DE keys via node utf8 write.
- [ ] Step 4: run, expect PASS; `npx tsc --noEmit` exit 0 (key parity).
- [ ] Step 5: commit `feat: §4 the conflict banner with Reload, Overwrite and Download`.

### Task 9: Reload, Overwrite and Download handlers

**Files:**
- Modify: `src/app/use-storage-backend.ts`
- Test: `src/app/use-storage-backend.conflict.test.tsx`

**Interfaces:**
- Consumes: Tasks 1, 7; `reloadCurrentProject`; `downloadJson(filename, json)` from `download-json.ts`; `workspaceToJson`.
- Produces: `resolveConflictReload(): Promise<void>`, `resolveConflictOverwrite(): void`, `downloadConflictVersion(): void` on the hook's return.

- [ ] Step 1: tests: Reload clears the pause, applies the stored version and drops the unconfirmed journal copy; Overwrite calls `backend.forceNextSave()`, clears the pause, and the next save runs and adopts its revision; Download calls `downloadJson` with `workspaceToJson` of the live workspace and a name containing the project name and "conflict".
- [ ] Step 2: run, expect FAIL.
- [ ] Step 3: implement; wire into Task 8's banner in `task-manager.tsx`.
- [ ] Step 4: run, expect PASS.
- [ ] Step 5: commit `feat: §4 resolve a conflict by reloading, overwriting or downloading`.

### Task 10: Turso revision (after §637 has merged)

**Files:**
- Modify: `src/app/turso-backend.ts`, `src/app/turso-schema.ts`, `src/app/turso-tenant-schema.ts`
- Test: `src/app/turso-schema.execute.test.ts` (node:sqlite), `src/app/turso-backend.test.ts`

**Interfaces:**
- Consumes: Task 1; §637's conditional batch in `runTursoPipeline`.
- Produces: a `meta` row `key = "revision"` (tenant: with `project_id`); a guard statement placed right after `BEGIN` that fails when the stored revision differs from the expected one.

- [ ] Step 1: execute tests on `node:sqlite`, both layouts: no row → revision 0; a save stamps 1 and re-inserts the row even when `meta` is dirty; a guard with a stale expected revision makes the batch roll back with nothing written; a matching one lets it commit and bumps.
- [ ] Step 2: backend test: the guard's failure maps to `SaveConflictError`; `forceNextSave()` omits the guard and sets `baseline = null` (full rewrite).
- [ ] Step 3: run, expect FAIL.
- [ ] Step 4: implement the guard as an SQL statement that errors on mismatch (e.g. `SELECT CASE WHEN (SELECT value FROM meta WHERE key='revision') IS NOT ? THEN json_extract('x','$') ELSE 1 END` — any statement that raises an SQLite error on mismatch; prove it raises on `node:sqlite`).
- [ ] Step 5: run, expect PASS. Then run the live-database spec if credentials exist; if the forced error does not abort the batch there, fall back to SELECT-compare inside `withWriteLock` and record it.
- [ ] Step 6: commit `feat: §4 Turso saves check the revision inside the batch`.

### Task 11: Two-tab end-to-end

**Files:**
- Create: `e2e/two-tab-conflict.spec.ts` (pattern: `e2e/pagehide-draft-persist.spec.ts`, two pages in one context, browser storage)

- [ ] Step 1: spec: page A and page B open the seeded project; B edits a task (mirrored to A, no pause); then write the `kv` revision behind A's back via `page.evaluate` and edit in A → the banner appears; Reload restores the stored version; repeat and Overwrite → B's next load shows A's version.
- [ ] Step 2: run `npx playwright test e2e/two-tab-conflict.spec.ts --project=chromium`, expect PASS; run the axe gate on the view showing the banner with `--workers=1`.
- [ ] Step 3: commit `test: §4 two tabs on browser storage pause on a conflict`.

### Task 12: Docs and register

**Files:**
- Modify: `docs/open-followups.md`, `docs/AGENTS/storage.md`, `docs/AGENTS/ci.md` (only if touched), `CHANGELOG.md` (only on a release branch, not here)

- [ ] Step 1: close §4 (#86) and §645 (#485) with the executed tests and the known limits (SharePoint `If-Match` result from Task 4 Step 6; Turso path chosen in Task 10; browser storage stays one store); rebuild the index; add to §640 that `mirror-releases` ran successfully on GitLab on 2026-09-29 after §646.
- [ ] Step 2: `storage.md` gets a "Conflicts" subsection naming the revision per backend, the pause, and the three actions.
- [ ] Step 3: run `followups:index:check`, `followups:status:check`, `followups:workitems:check`, `docs:claims:check`, `docs:symbols:check`; all exit 0.
- [ ] Step 4: `npm run test:shuffle` exit 0; commit `docs: §4 §645 closed`.
