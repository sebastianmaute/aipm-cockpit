# Unload journal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the window closes, reloads or navigates, the latest unconfirmed workspace survives on every backend. It is written synchronously to localStorage at pagehide and restored on the next load when its base still matches.

**Architecture:**
- A pure module, `src/app/unload-journal.ts`, handles the record: key, serialisation, fingerprint, size cap, read, write and clear.
- A small hook module, `src/app/use-unload-journal.ts`, owns the write and clear wiring:
  - the latest-unconfirmed ref;
  - the pagehide listener;
  - "write if the page is hiding", called from `doSave`;
  - "confirm", called from `doSave`'s `.then`.
- `use-storage-backend.ts` gains only thin calls, because it is at 1395 of a 1600-line limit:
  - a restore step in the load effect, between `await backend.load()` and `applyWorkspaceFromLoad`;
  - the journal calls in `doSave`.
- A mismatch shows a notice with **Restore anyway** and **Discard**.

**Tech Stack:** Next.js / React 19, TypeScript, vitest + RTL (jsdom), Playwright (Chromium).

**Spec:** `docs/superpowers/specs/2026-09-27-unload-journal-design.md` (binding; read it first).

## Global Constraints

- Worktree `C:/Projects/aipm-wt-c`, branch `fix/defect-batch-8` (PR #444).
- Commits cite `§629` (and `§622`/`§625` where a closure changes). They carry no `Claude-Session:` trailer, no attribution and no `Closes #`.
- Commit with `git commit --only <paths> -F <msgfile>`. Never `--amend`, `git stash`, `git reset` or `git checkout --`. Never push.
- `src/app/*` and `e2e/*` files are CRLF (check with `git ls-files --eol`); `docs/**` files are LF. Never `sed -i`.
- `i18n.de.ts` is changed only by a node utf8 script with real umlauts. EN and DE keys must stay in parity.
- Tests and Playwright run only while `C:/Projects/aipm-wt-c/.superpowers/VITEST-GRANTED` exists.
  - If it is absent, wait with `until [ -f … ]; do sleep 30; done` (cap 30 min).
  - Run in the foreground, one process at a time.
  - vitest: `--maxWorkers=2`. Playwright: `--workers=1`.
  - Assert the `Test Files N passed` count each time.
- Static checks per task:
  - `npx tsc --noEmit` must report 0 errors in total;
  - `npx eslint --max-warnings=0 <touched files>`;
  - `npm run size:check` must exit 0. `use-storage-backend.ts` must stay under the limit, so new logic goes in the new modules.
- Credential rule: a journal key or record never contains a credential. Do not use `storageTargetKey`, which holds the Turso token.
- Owner rules:
  - A tab switch (`visibilitychange`) commits no draft (§185). Journaling a save that is already scheduled while hidden is allowed.
  - Conflict policy: apply only when the base matches. On a mismatch, keep the journal and show a notice with **Restore anyway** / **Discard**. Never overwrite silently.
- Any quantifier written in a comment or in the register must be one you counted in the code.

## Review Focus

1. **A journal is never applied over a newer backend state.** That covers a mismatch, and another tab's or device's save. Tasks 1 and 3 pin it.
2. **A paused, failed, refused or truncated load neither applies nor deletes the journal.** Task 3 pins it.
3. **The journal is cleared only by a confirmed save of an equal or newer state.** A rejected save leaves it. Task 2 pins it.
4. **Writing the journal can never throw into the unload.** That covers a quota error and an oversized workspace. Task 1 pins it.
5. **A popout never writes or restores.** Tasks 2 and 3 pin it.

---

### Task 1: `unload-journal.ts`: record, fingerprint, cap (pure)

**Files:** Create `src/app/unload-journal.ts` and `src/app/unload-journal.test.ts`.

**Interfaces (Produces):**

```ts
export const UNLOAD_JOURNAL_MAX_CHARS = 1_500_000;
export const UNLOAD_JOURNAL_PREFIX = "aipm-cockpit:unload-journal:";
export type UnloadJournal = { v: 1; projectKey: string; tabId: string; savedAt: number; baseFingerprint: string; workspace: string };
export function fingerprintWorkspace(ws: Workspace): string;          // canonical, round-trip stable (see Step 3)
export function writeUnloadJournal(rec: Omit<UnloadJournal, "v">): boolean; // never throws; false = skipped (cap/quota), logs diag
export function readUnloadJournal(projectKey: string): UnloadJournal | null; // null on absent/corrupt/other v (corrupt → diag, key removed)
export function clearUnloadJournal(projectKey: string, ifSavedAtAtMost?: number): void; // removes only if stored savedAt <= arg (when given)
```

- [ ] **Step 1: Write the failing tests.**
  - The record round-trips.
  - A key with a credential is impossible: the API takes a `projectKey`, and a test asserts the stored key is exactly `prefix + projectKey`.
  - Over the cap, the write returns false, writes nothing and logs `workspace.unloadJournalSkipped`.
  - A `localStorage.setItem` that throws (`QuotaExceededError`) makes the write return false and logs a diagnostic; it does not throw.
  - A corrupt value reads as null, removes the key and logs a diagnostic.
  - `clearUnloadJournal` with `ifSavedAtAtMost` keeps a newer record.
  - `fingerprintWorkspace` is deterministic and changes when any slice changes. Parametrise over every `Workspace` key, deriving the key list from `emptyWorkspace()` so that a new slice is covered automatically.
- [ ] **Step 2: Implement.**
  - The fingerprint is FNV-1a over a canonical string. Start from `workspaceToJson(ws)`.
  - If Step 3 shows a backend is not round-trip stable, canonicalise instead: re-encode through `jsonToWorkspace(workspaceToJson(ws))`, sort keys, and drop load-derived fields. Record exactly what is canonicalised, and why, in a code comment.
  - Import the diagnostics logger the way the neighbouring modules do (`logDiag`).
- [ ] **Step 3: Prove round-trip stability for each backend kind (spec, Fingerprint section).**
  - For each of IndexedDB (`browser-backend.test.ts` fakes), local JSON file (`local-file-backend.test.ts` fakes), SharePoint JSON and Turso (the `node:sqlite` fakes the Turso tests use), save a sample workspace (`sample-workspace-small.json`, plus one with documents).
  - Load it back and assert `fingerprintWorkspace(saved) === fingerprintWorkspace(loaded)`.
  - If a backend cannot be made stable, do NOT weaken the check. Record it as a spec correction (append a dated note to the spec's Fingerprint section) and export `const JOURNAL_FINGERPRINT_UNSTABLE_KINDS`, so that Task 3 treats that backend kind as always-mismatch.
- [ ] **Step 4: Mutation check.**
  - M1: the fingerprint ignores one slice (for example it drops `documents`). Expected red.
  - M2: the cap check is removed. Expected red.
  - M3: the try/catch around `setItem` is removed. Expected red.
  - Revert each and prove it with `git diff --stat`.
- [ ] **Step 5: Commit** `fix: §629 unload journal record and round-trip-stable fingerprint`.

### Task 2: write and clear, `use-unload-journal.ts` plus thin calls in `doSave`

**Files:** Create `src/app/use-unload-journal.ts` and `src/app/use-unload-journal.test.tsx`. Modify `src/app/use-storage-backend.ts` (`doSave` around `:850-870`, plus one hook call).

**Interfaces:**
- **Consumes:** Task 1.
- **Produces:** `useUnloadJournal({ projectKey, enabled, isPopout }) → { noteSaveStarted(outgoing: Workspace): number /* seq or savedAt */, noteSaveConfirmed(savedAt: number, confirmed: Workspace): void, baseFingerprint(): string, setBase(ws: Workspace): void }`.

**projectKey resolution:**
- Turso: `tursoProjectId`, which the hook already holds (`:88`).
- File, SharePoint and IndexedDB: the projects registry's `currentProjectId`, found through the existing registry reader the storage hook uses. Otherwise `browser`.
- No value may contain a credential. Put the resolution in `unload-journal.ts` as a pure `journalProjectKey(storageKind, tursoProjectId, currentProjectId)`, and give it a unit test.

- [ ] **Step 1: Write the failing tests.** Use a fake backend with a controllable save promise, following the patterns in `use-storage-backend.load-gate.test.tsx`.
  - (a) An edit, then `pagehide` while a save is scheduled: the journal holds the edited workspace.
  - (b) A save fired and still unconfirmed, then `pagehide`: the journal holds that outgoing workspace.
  - (c) The save confirms: the journal is cleared and the base is rolled forward.
  - (d) The save rejects: the journal stays.
  - (e) A popout: no journal, ever.
  - (f) Saves not allowed (paused or refused): no journal.
  - (g) A plain tab switch with no save pending: no journal.
- [ ] **Step 2: Implement.**
  - `doSave` calls `noteSaveStarted(outgoing)` just before `backend.save`. That call writes the journal synchronously if `isPageHiding()` or `document.visibilityState === "hidden"`, and always records `latestUnconfirmed`.
  - In `.then`, call `noteSaveConfirmed`.
  - The hook's own `pagehide` listener writes `latestUnconfirmed`, if any.
  - Export `isPageHiding()` from `debounced-save.ts`: a read-only getter of the existing flag, with no behaviour change.
  - The base is set from the loaded workspace in Task 3. In this task, `setBase` is called where `applyWorkspaceFromLoad` runs.
- [ ] **Step 3: Mutation check.**
  - M1: remove the pagehide write. Expected red: (b).
  - M2: remove the confirm clear. Expected red: (c).
  - M3: clear on reject. Expected red: (d).
  - M4: drop the popout guard. Expected red: (e).
- [ ] **Step 4: Commit** `fix: §629 write the unload journal at pagehide and clear it on a confirmed save`.

### Task 3: restore on load, plus the mismatch notice

**Files:** Modify `src/app/use-storage-backend.ts` (the load effect, `:613-639`: a thin call only), `src/app/use-unload-journal.ts`, `src/app/i18n.ts` and `src/app/i18n.de.ts` (via a node script). The notice goes in an existing banner or notice surface: find the pattern used by the decode-failure "Saving paused" banner (`notifications.tsx`, `use-load-truncation.ts`) and reuse it, without inventing a new UI system. Test in `src/app/use-unload-journal.test.tsx` and/or `use-storage-backend.load-gate.test.tsx`.

**Behaviour:** as in the spec's Restore section.
- **Match:** apply the journal's workspace instead of the loaded one, and do NOT set `suppressNextSaveRef`. Toast `unloadJournalRestored`.
- **Mismatch** (or a backend kind in `JOURNAL_FINGERPRINT_UNSTABLE_KINDS`): apply the loaded workspace as today, keep the journal, and show a notice (`unloadJournalConflict`) with two actions:
  - `unloadJournalRestoreAnyway`: apply the journal, then save through the normal path;
  - `unloadJournalDiscard`: clear the journal.
- **Failed load, empty-load refusal, or a truncated or decode-paused load:** no restore and no clear.
- **A journal for another `projectKey`:** ignored.

**i18n copy:**
- EN:
  - "Restored unsaved changes from your last session."
  - "Unsaved changes from your last session could not be restored automatically because this project was changed elsewhere since."
  - "Restore anyway"
  - "Discard"
- DE:
  - "Nicht gespeicherte Änderungen aus der letzten Sitzung wurden wiederhergestellt."
  - "Nicht gespeicherte Änderungen aus der letzten Sitzung konnten nicht automatisch wiederhergestellt werden, weil dieses Projekt inzwischen anderswo geändert wurde."
  - "Trotzdem wiederherstellen"
  - "Verwerfen"

- [ ] **Step 1: Write the failing tests** for each branch above, plus the popout case (never restores) and Restore-anyway / Discard. A test on the save that follows a restore must show that the restored workspace is actually saved, that is, not suppressed.
- [ ] **Step 2: Implement.** Keep `use-storage-backend.ts` changes to thin calls, and run `npm run size:check`.
- [ ] **Step 3: Mutation check.**
  - M1: apply on a mismatch. Expected red.
  - M2: clear on a paused load. Expected red.
  - M3: suppress the save that follows a restore. Expected red.
  - M4: restore in a popout. Expected red.
- [ ] **Step 4: Commit** `fix: §629 restore the unload journal on load, with a conflict notice`.

### Task 4: Playwright proof, register and closures

**Files:** Modify `e2e/pagehide-draft-persist.spec.ts` and `docs/open-followups.md`.

- [ ] **Step 1:** Remove `test.fail` from the reload cases (heading, task-name cell). They must pass in Chromium on the default backend. Add:
  - a blur-then-immediate-reload case;
  - a mismatch case: write a journal, change the stored project through the app's own storage in the page, reload, and expect the conflict notice. Clicking Discard clears it.
- [ ] **Step 2: Negative control.** Disable the restore call, run the spec, and confirm the reload cases go red. Restore it and prove it with `git diff --stat`.
- [ ] **Step 3: Register.**
  - **§622 and §625:** state that the draft is now persisted across a close or reload via the unload journal, measured in Chromium on the default backend by the named spec.
  - **§629:**
    - This Status line carries the fix and the Playwright evidence.
    - It narrows what stays owed: the packaged desktop close, and real-browser runs of the file, SharePoint and Turso backends.
    - Since the journal is backend-agnostic, keep §629 open only for those checks, retitled if the issue title is updated too. Do not edit GitHub; report the new title for the controller.
  - **§627:** note that the journal now carries the latest unconfirmed state across the race on a reload, while the in-session race remains.
  - Rebuild the index, then run `--check` and all register gates; each must exit 0.
- [ ] **Step 4:** Run the full set of touched test files, plus `use-commit-on-page-hide.test.tsx`, `debounced-save.test.ts` and `use-storage-backend*.test.tsx`. Then run tsc, eslint, `dup:check` and `size:check`.
- [ ] **Step 5: Commit**
  - `test: §629 Playwright proves drafts survive a reload via the unload journal`
  - `docs: §622 §625 §627 §629 record the unload journal`
