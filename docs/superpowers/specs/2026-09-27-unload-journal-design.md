# Unload journal — design (defect batch 8, persistence)

**Date:** 2026-09-27
**Branch:** `fix/defect-batch-8` (PR #444), worktree `C:/Projects/aipm-wt-c`. This amends the batch-8 design (`2026-09-27-defect-batch-8-design.md`).
**Register:** §629 (#446) becomes the fix. §622 and §625 persist only once this lands.

## Why

Playwright measured this in Chromium on the default IndexedDB backend. A draft committed on `pagehide` (§622 and §625) and saved at once (`pageHiding` in `debounced-save.ts`) is still lost on reload. A save scheduled by a blur shortly before a reload is lost too. Every backend's save is asynchronous before any write exists:

- **IndexedDB:** each `idbSet` first `await`s a new `indexedDB.open()` (`idb.ts`), then runs about 30 separate transactions.
- **File:** handle, then permission, then `createWritable`.
- **SharePoint and Turso:** a token or Web Lock, then `fetch` without `keepalive`.

The page goes away before any of it runs. A research pass found no existing snapshot, recovery or journal mechanism. The notes are in the controller's scratchpad as `unload-persistence-research.md`.

## Owner decisions (2026-09-27)

- **Mechanism:** a synchronous unload journal in `localStorage`, the same for every backend. It is not a per-backend synchronous write, and there is no Electron close hook in this PR.
- **Conflict policy:** apply the journal automatically only if the loaded project still matches the state the journal was based on. Otherwise keep the backend's version, keep the journal, and show a notice with **Restore anyway** and **Discard**. Nothing is overwritten silently in either direction.

## Design

### Record

- **Key:** `aipm-cockpit:unload-journal:<projectKey>`.
- **`projectKey`:**
  - Turso: the Turso project id.
  - File, SharePoint and IndexedDB: the registry's current project id, or `browser` when there is none.
  - It must never contain a credential. `storageTargetKey` holds the Turso token, so it is not used.
- **Value:** JSON `{ v: 1, projectKey, tabId, savedAt, baseFingerprint, workspace }`.
  - `workspace` is `workspaceToJson` of the unconfirmed outgoing workspace.
  - `baseFingerprint` identifies the last CONFIRMED state: the loaded state, rolled forward on every confirmed save.
- **Size cap:** a serialised record over `UNLOAD_JOURNAL_MAX_CHARS` (1,500,000) is not written. Instead the app logs a diagnostic (`workspace.unloadJournalSkipped`, with the size). A storage quota error is logged the same way. Neither ever throws into the unload.

### Fingerprint

`fingerprintWorkspace(ws)` is a fast non-cryptographic hash (for example FNV-1a 53-bit) over a canonical serialisation. The recovery compares a fingerprint taken of a workspace BEFORE saving with one taken of what the backend returns on the next LOAD. So the canonical form must be round-trip stable for every backend: `fingerprint(saved) === fingerprint(load(after that save))`.

Task 1 must prove this for each backend kind, using the sample workspaces and the backend test fakes. If a backend is not round-trip stable and cannot be made so by canonicalising (sorting, dropping load-derived fields), that backend treats every journal as a mismatch, which shows the notice. The implementer records that in the spec as a correction, and must not weaken the comparison.

### Write (synchronous, never throws)

The journal is written:

1. Whenever `doSave` (`use-storage-backend.ts`) runs while the page is hiding (`pageHiding`) or while `document.visibilityState === "hidden"`. This covers the commit-flush path and the pending-debounce flush, and it only runs past the save guards.
2. In a `pagehide` listener owned by the storage hook, when a save is still UNCONFIRMED (fired, and no `.then` yet). A ref tracks the latest unconfirmed outgoing workspace.

The last write wins by `savedAt`. There is no ordering dependency between (1) and (2): whichever runs last holds the newest state.

It is never written:

- by a popout;
- when saves are not allowed (the `savesAllowed` gate, or the paused or incomplete-load gate);
- for an empty workspace refusal.

### Clear

A `backend.save` whose `.then` confirms a state with `savedAt ≥` the journal's `savedAt` (same tab) removes the key and rolls `baseFingerprint` forward. A `pageshow` after a bfcache restore does not clear it; the next confirmed save does.

### Restore (on load)

The restore runs after `await backend.load()` succeeds and before `applyWorkspaceFromLoad`.

- **No journal:** nothing changes.
- **Journal present, and `fingerprintWorkspace(loaded) === journal.baseFingerprint`:** the app applies the journal's workspace instead of the loaded one. The save that follows is NOT suppressed, so the normal save path writes it back through the destructive guard and the other guards. A toast says "Restored unsaved changes from your last session." The journal clears on the confirmed save.
- **Journal present, fingerprint mismatch:** the app applies the loaded workspace as today and keeps the journal. A notice (i18n EN/DE) says the unsaved changes from the last session could not be restored because the project changed elsewhere, with two choices:
  - **Restore anyway:** apply the journal, then save.
  - **Discard:** remove the key.
- **Load failed, empty-load refusal, truncated or decode-paused load:** nothing is applied and the journal is left untouched, to be retried on a later load.
- **The project id does not match:** the journal is ignored, but not deleted. It belongs to another project.

### Multi-tab

Two tabs of the same project write the same key, and the last close wins. The base-fingerprint check protects the other tab's newer save, because that save changes the base. A journal written by a tab whose base is no longer the stored state shows the notice.

### Out of scope

- An Electron close hook. localStorage durability on desktop stays owed under §629, which is narrowed to the desktop check once this lands.
- `keepalive` for network writes.
- Save serialisation (§627).
- CSV and Markdown decode recording (§630).

## Verification

- **Unit tests:**
  - the journal module: write, read, cap, quota error, key without a credential, and clear;
  - the fingerprint round-trip for each backend kind;
  - the storage hook, for each write path, each clear, and each restore branch: match, mismatch with Restore anyway, mismatch with Discard, paused, failed load, other project, and a popout.
- **Mutants:** removing the pagehide write, removing the clear, applying on a mismatch, and deleting the journal on a paused load must each go red.
- **Playwright, Chromium, default backend:** the `test.fail()` reload cases in `e2e/pagehide-draft-persist.spec.ts` now pass, and their `test.fail` markers are removed. Added:
  - a blur-then-immediate-reload case;
  - a mismatch case, where the stored state is changed between the journal write and the reload, and the notice appears.
- **Unchanged:** the §622 and §185 behaviour. A tab switch commits no draft.
