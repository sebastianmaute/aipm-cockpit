# Two windows on one storage — design (§4 and §645)

**Date:** 2026-09-29
**Branch:** `docs/two-tab-conflict-spec` (this spec); implementation on its own branch after the plan.
**Register:** §4 (#86) "Two-tab last-writer clobber" and §645 (#485) "A project switch in one tab redirects every other tab's saves for browser storage and local files" become the fix.
**Builds on:** #484 (§642–§644): tab sync is scoped to the storage a window writes (`syncScopeKey`), pop-outs follow their opener, and a load is sent as `fromLoad`.

## Why

Two main windows that write the same storage each save their whole workspace (a delta, for browser storage and Turso), so the window that saves last wins. #484 mirrors 17 of the 29 workspace parts live between such windows. The other 12 are never exchanged, so a tab that never saw another tab's plan change writes over it: `plan`, `fxRates`, `status`, `fieldVisibility`, `features`, `steeringCommittee`, `timelogLinks`, `knowledgeItems`, `insights`, `settingsOverrides`, `calendarEvents`, `documentAssets`.

Mirroring cannot help when the other writer is not a mirroring window: another browser, another device, a window on a different project that shares the same store or handle slot (§645), or two edits within milliseconds. Today nothing detects that at all.

§645: browser storage is one IndexedDB store (`new BrowserBackend()` takes no project), and `LocalFileBackend` re-reads its handle from one slot per kind (`file-handle:<kind>`) on every `save()`. A project switch in one tab rewrites that slot, so another tab still showing its old project saves into the newly selected file.

## Owner decisions (2026-09-28 and 2026-09-29)

- **Conflict policy: detect and pause.** Each save checks whether another writer wrote the same storage since this window last loaded or saved it. If so, saving pauses with a banner. Nothing is overwritten silently. (Rejected: one editing tab with a take-over lock; warn-only.)
- **Section 1 (approved):** mirror all 29 parts, add a revision check per backend, broadcast the new revision after a save, and fold in §645.
- **Section 2 (approved):** a new pause reason `"conflict"`; the banner offers **Reload**, **Overwrite** and **Download my version**; edits keep being journalled while paused; no automatic merge.
- **Section 3 (approved):** the edge cases and tests below.

## Design

### 1. Mirror all 29 parts

`use-storage-backend.ts` adds one `useBroadcastSync` call for each of the 12 parts listed above, with the same `SyncContext` as the other 17. `applyWorkspaceFromLoad` passes each through `mark()` like the others, so a load of them is sent as `fromLoad` (§644).

Settings-like parts (`settingsOverrides`, `fieldVisibility`, `features`) are `Workspace` fields that `applyWorkspaceFromLoad` sets, so they are saved with the project; mirroring them is consistent with that. The plan confirms each of the 12 is a workspace field on every write path before adding its sync call.

The pop-out receives all 29, so its mix-after-switch limit recorded in §642 goes away.

`documentAssets` may be large if asset records carry image data. The plan measures a realistic payload first. If posting it on every change is too heavy, the fallback is to mirror a cheap change marker for that part only and treat a change there as a revision bump, which the revision check then catches; the plan records which it chose.

### 2. A revision per storage target

Each backend instance holds `baseRevision`: what it last loaded or wrote. `backend.save(ws)` runs the check inside the queued save (`enqueueSave`, §627), so autosave, the pre-switch flush, `guardedWrite` and the pagehide flush all get it. A stale write throws `SaveConflictError` (new, in `storage-error.ts`) and writes nothing.

| Storage | Revision | Check | Atomic against |
|---|---|---|---|
| SharePoint (`sp-json`, `sp-csv`) | the driveItem eTag | the upload PUT carries `If-Match: <baseRevision>`; HTTP 412 becomes `SaveConflictError`; the new eTag comes from the PUT response | every writer, any device (server-side) |
| Local file (`local-*`) | `File.lastModified` of the handle | under a Web Lock keyed by the handle's identity, re-read `getFile().lastModified` and compare; after the write, read it again and adopt it | windows in this browser; another program writing the file is caught on the next save |
| Browser storage | a `revision` integer in the `kv` store | under a Web Lock `aipm-cockpit:save:browser`, read, compare, write the data, then bump | windows in this browser (the store is per-browser anyway) |
| Turso (single and tenant) | a `revision` row in `meta` | inside the existing `withWriteLock`, SELECT the row, compare, then run the save batch, which re-inserts the row bumped (a dirty `meta` DELETEs it, so it is written on every save) | windows in this browser; two devices can still interleave between SELECT and batch until §637's conditional batch exists |

**Superseded (2026-10-01), browser storage.** The Web Lock named in that row is gone: the save is now one readwrite IndexedDB transaction over `kv` and every record store (read the revision, compare, write, bump, then an explicit `commit()`). See `docs/AGENTS/storage.md`, Conflicts.

**No revision yet** (data saved before this change): the first save treats the stored revision as 0, compares against a `baseRevision` of 0, and stamps 1. A backend whose load finds no revision sets `baseRevision = 0`.

**Turso after §637.** §637 (in progress in another session, 2026-09-29) turns a transactional pipeline into one Hrana `batch` whose steps run only while every earlier step succeeded, with a conditional ROLLBACK. Once it merges, the compare moves INTO the batch as its first statement after BEGIN: a statement that fails when the stored revision differs from `baseRevision` (for example a `SELECT` that forces an SQL error on mismatch), so every later step is skipped and the batch rolls back. That makes the Turso check atomic against every writer, other devices included, and removes the SELECT-then-batch window. The plan builds the Turso part on the merged §637 and keeps the `withWriteLock` compare only as the fallback if the forced-error statement proves unreliable on a live database.

**SharePoint `If-Match`** must be checked against a real tenant before this ships. If Graph ignores it on the content upload, the fallback is a metadata GET of the eTag under a Web Lock, compare, then PUT (atomic only within this browser), and the register says so.

### 3. The revision message

After a save confirms, the window posts a `revision` message on the sync channel with its scope and the new revision. A main window with the same non-null scope and no uncommitted project op (the same epoch rule as the slice messages, §642) adopts it as its `baseRevision`. That is safe because, with all 29 parts mirrored, it holds the same data the sender just saved. Pop-outs ignore it; they never save.

A window that has edits the sender has not received cannot exist in steady state (every edit is broadcast on commit), except inside the milliseconds window already recorded for §644. If such a race lets a stale save through, the next save by the other window hits the check.

### 4. The pause

`doSave`'s `.catch` maps `SaveConflictError` to `savesPaused = { backend, reason: "conflict" }`, which closes the save gate like `"load-failed"`. The first refused edit toasts once, as today.

- **Journalling while paused:** the gate being shut must not stop the §629 journal from holding the unsaved state. On a conflict, the rejected outgoing workspace stays unconfirmed (`noteSaveStarted` ran before the backend call), and while the pause lasts the journal's unconfirmed copy follows the live workspace, so closing the window keeps every edit and the next open offers **Restore anyway** / **Discard** as today.
- **Pre-switch flush and pagehide flush:** a conflict there writes nothing. The switch goes ahead; the unsaved state stays in the journal and a toast says it was not saved.

### 5. The banner

`SavingPausedBanner` (`notifications.tsx`) gains a `conflict` cause with the copy: "This project was changed in another tab or on another device. Your changes since then are not saved yet." The sidebar's saving indicator folds it in like the other causes. Its three actions:

1. **Reload** — confirm "Reload the saved version and discard your unsaved changes?"; then `reloadCurrentProject`, which re-reads the revision, drops the unconfirmed journal copy and reopens the gate.
2. **Overwrite** — confirm "Save your version over the other one? Its changes since you opened the project will be lost."; then a one-shot force: the next save skips the compare, does a full rewrite (Turso `baseline = null`; browser storage resets its per-store baselines and clears stores it rewrites), adopts the resulting revision and reopens the gate.
3. **Download my version** — saves this window's workspace as a JSON file first, reusing the existing workspace JSON export if its output is the full workspace; otherwise a direct `workspaceToJson` download.

i18n keys follow `storageSavePaused<Reason>`; EN and DE both.

### 6. §645: a handle per window

`LocalFileBackend` takes its handle once, when it is bound (load, pick or switch), and keeps it in memory. `save()` writes to that handle and never re-reads the slot. The slot keeps only one job: telling a freshly opened window which file to open. A switch in another tab rewrites the slot but cannot redirect this window's saves.

Browser storage stays one shared store; a store per project is a storage-format migration and out of scope. The revision check covers it: a window on another registry project that writes the store bumps the revision, and this window pauses instead of overwriting. The register records this as the remaining limit.

## Tests

Each written to fail first against today's code.

- **Backends:**
  - browser: two `BrowserBackend` instances on one fake IndexedDB; the second stale save throws, the first's bump is adopted after a revision message.
  - local files: the `local-file-backend.test.ts` fakes gain `lastModified`; a foreign write between load and save throws; the bound handle survives a slot rewrite (§645).
  - SharePoint: a stubbed `fetch` asserts the `If-Match` header and maps 412.
  - Turso: `node:sqlite` execute tests for the revision row in both layouts, and the lock mock for the compare.
- **Hook level:** the pause and gate; the toast once; journalling while paused; Reload, Overwrite (full rewrite, revision adopted) and Download; the revision message adopted only with the same scope and epoch; the 12 new sync slices and their load marking.
- **Banner:** `notifications.test.tsx` for the conflict copy and the three actions; the sidebar indicator.
- **End to end:** browser storage in two pages of one context (the `pagehide-draft-persist.spec.ts` pattern); a conflict forced by writing the store behind one page's back; the banner appears and Reload / Overwrite behave.
- **Mutation** on each rule; `npm run test:shuffle`; a cold review; an eye-check of the banner in light and dark themes, and the axe gate on the view that shows it.

## Out of scope

- Merging two versions automatically.
- A store per project for browser storage.
- Cross-device protection for Turso beyond the in-browser lock (needs §637).
- Detecting a foreign write to a local file between two saves before the next save runs (there is no file watcher).
