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
- **Conflict policy:** apply the journal automatically only if the loaded project still matches the state the journal was based on. Otherwise keep the backend's version, keep the journal, and show a notice with **Restore anyway** and **Discard**. Nothing is overwritten silently in either direction. (Amended: see Amendment A1 and A2.)

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

A `backend.save` whose `.then` confirms a state with `savedAt ≥` the journal's `savedAt` (same tab) removes the key and rolls `baseFingerprint` forward (see Amendment R1). A `pageshow` after a bfcache restore does not clear it; the next confirmed save does.

### Restore (on load)

The restore runs after `await backend.load()` succeeds and before `applyWorkspaceFromLoad`.

- **No journal:** nothing changes.
- **Journal present, and `fingerprintWorkspace(loaded) === journal.baseFingerprint`:** the app applies the journal's workspace instead of the loaded one. The save that follows is NOT suppressed, so the normal save path writes it back through the destructive guard and the other guards. A toast says "Restored unsaved changes from your last session." The journal clears on the confirmed save. (Amended: see Amendment A1, R3 and R10.)
- **Journal present, fingerprint mismatch:** the app applies the loaded workspace as today and keeps the journal (amended, see Amendment A1). A notice (i18n EN/DE) says the unsaved changes from the last session could not be restored because the project changed elsewhere, with two choices:
  - **Restore anyway:** apply the journal, then save. (Amended: see Amendment A2.)
  - **Discard:** remove the key. (Amended: see Amendment A2.)
- **Load failed, empty-load refusal, truncated or decode-paused load:** nothing is applied and the journal is left untouched, to be retried on a later load.
- **The project id does not match:** the journal is ignored, but not deleted. It belongs to another project.

### Multi-tab

Two tabs of the same project write the same key, and the last close wins. The base-fingerprint check protects the other tab's newer save, because that save changes the base. A journal written by a tab whose base is no longer the stored state shows the notice. (See Amendment R9.)

### Out of scope

- An Electron close hook. localStorage durability on desktop stays owed under §629, which is narrowed to the desktop check once this lands.
- `keepalive` for network writes.
- Save serialisation (§627).
- CSV and Markdown decode recording (§630).

## Verification

- **Unit tests:**
  - the journal module: write, read, cap, quota error, key without a credential, and clear;
  - the fingerprint round-trip for each backend kind;
  - the storage hook, for each write path, each clear, and each restore branch: match, mismatch with Restore anyway, mismatch with Discard, paused, failed load, other project, and a popout. (Amended: see Amendment V.)
- **Mutants:** removing the pagehide write, removing the clear, applying on a mismatch, and deleting the journal on a paused load must each go red.
- **Playwright, Chromium, default backend:** the `test.fail()` reload cases in `e2e/pagehide-draft-persist.spec.ts` now pass, and their `test.fail` markers are removed. Added:
  - a blur-then-immediate-reload case;
  - a mismatch case, where the stored state is changed between the journal write and the reload, and the notice appears. (Amended: see Amendment V.)
- **Unchanged:** the §622 and §185 behaviour. A tab switch commits no draft.

## Amendment 2026-09-27 (implementation rulings)

Added in the §629 fix round on `fix/defect-batch-8`. The text above is kept as written; each sentence this section changes carries a pointer here. Each item states what the code does now, read from `src/app/use-unload-journal.ts` (the hook) and `src/app/use-storage-backend.ts` (the load effect).

1. **A1: a journal that already landed is cleared silently.** On a load that passed every gate, `restoreOnLoad` first compares the journal's CONTENT with the loaded workspace. When `fingerprintWorkspace(journal workspace) === fingerprintWorkspace(loaded)`, the journal's save landed and only its `.then` never ran. The journal is removed (unguarded), nothing is applied, and there is no notice and no toast. This check comes BEFORE the base branches, so it also replaces the base-match branch (and its toast) whenever the content is equal. It keeps the owner rule "nothing is overwritten silently": the journal holds nothing that is not already stored, so nothing is lost.
2. **A2: Restore anyway and Discard act only on the record the notice describes.** When the conflict is raised, the hook keeps that record IN MEMORY: the record itself (its `tabId` and `savedAt` identify it) and its decoded workspace. Restore anyway applies that in-memory copy, whatever the key holds by then (this tab's own later write may have replaced it, and that write's confirmation may have cleared it), re-tags it per R3 and saves it through the normal path. If there is no copy for the target in scope, it shows an error toast rather than doing nothing. Discard re-reads the key and removes it only while the stored record still has the notice's `tabId` and `savedAt`; either way it drops the in-memory copy and the notice.
3. **R1: a confirmed save clears only its own tab's record.** A save's confirmation removes the key only when the stored record has this page load's `tabId` and a `savedAt` no greater than the confirmed save's (`clearUnloadJournal` with a guard). A record another page load or another tab wrote is never cleared by a confirmation.
4. **R3: an applied journal is re-tagged to this page load.** When a journal is applied (the base-match branch, or Restore anyway), it is re-written under the current tab's `tabId` with its `savedAt` kept, so the confirmation of the save-back, a later `savedAt` from this tab, clears it.
5. **R7: a project op holds the base with no key.** A switch, create or open op applies its workspace before the storage config flips to the target, so the hook holds that workspace as a keyless base (`holdBase`) and drops the live base. The load effect adopts it under the target's key when the flip lands (`adoptHeldBase`). An op that fails between its apply and its flip leaves a journal with base `""`, which no fingerprint equals, so it degrades to the notice (or, if its content equals what loads, to the silent clear of A1), never to an automatic apply.
6. **R9: an ignored notice's stored record can be overwritten by this session's next journal write.** There is one key per project and the last write wins, so this session's next journal write (a save started while the page is hidden, or one still unconfirmed at `pagehide`) replaces the record the notice describes, and that save's confirmation clears it. With A2 the in-memory copy survives that, so Restore anyway still applies it while the notice shows. The copy is dropped by Restore anyway, by Discard, when this tab closes or reloads the page, and when this tab's load effect calls `restoreOnLoad` again. That happens on a later load that is not cancelled, has not failed, was not refused as empty and is not incomplete, for example a project switch. The in-app "Reload project" does not call `restoreOnLoad`, so it keeps the copy. What is lost is a notice not answered before the tab closes or loads a project again in that way, and only when the stored record no longer holds the draft by then. A controller ruling, derived from the multi-tab rule above ("the last close wins"); confirmed by the owner on 2026-09-27. The in-memory half is unit-tested; the close half is never machine-verified.
7. **R10: the restore's save-back faces the destructive guard, rebaselined to what the backend returned.** On the base-match branch the load effect syncs the guard's baselines to the counts of the LOADED workspace (`syncBaselinesToLoaded`) before the journal's workspace is applied, so a journal that is a mass deletion relative to the stored project is refused, not written.

**V. Verification as built** (replaces the lists in "Verification" where they differ):

- **Unit tests:**
  - `src/app/unload-journal.test.ts`: the key (no credential), write and read, the cap, the quota error, clear with and without its guard, the fingerprint, and the fingerprint round trip for the browser (IndexedDB), SharePoint JSON and Turso kinds. The local-file round trip is in `src/app/local-file-backend.test.ts`.
  - `src/app/use-unload-journal.test.tsx`: the write paths, the clear on confirmation, R1, the base roll-forward, the popout, and the held op base (R7).
  - `src/app/use-unload-journal.restore.test.tsx`: the restore branches: match (with R3 and R10), mismatch, mismatch with Restore anyway, mismatch with Discard, already landed (A1, both with a mismatched and a matching base), Discard once the key holds a different record and Restore anyway once this tab has overwritten or cleared the key (A2), Restore anyway with no conflict in scope (the error toast), each incomplete-load cause, a failed load, an empty-load refusal, another project's journal, a popout, and R7's degrade to the notice.
- **Playwright, Chromium, default backend** (`e2e/pagehide-draft-persist.spec.ts`, 10 cases, no `test.fail`): for a document heading and a task-name inline cell, "page stays", reload and tab close; a task-cell tab close whose own IndexedDB write landed (A1); a blur-then-immediate-reload with the clock paused before the blur; and the mismatch case once per action (Discard, Restore anyway).
