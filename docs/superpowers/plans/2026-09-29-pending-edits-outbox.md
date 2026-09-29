# Pending-edits outbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A chat-thread rename or communication-template draft typed before a window close is applied on the next start (unless the stored value changed meanwhile), and the speech-to-text key is sealed as it is typed.

**Architecture:** A pure module `pending-edits.ts` keeps live edits in memory and writes them to `localStorage` synchronously on `pagehide`. `useChatThreads` and `useCommTemplates` track an edit from the first differing keystroke until its Turso write resolves, and replay stored edits after their first successful load when the stored value still equals the edit's `base`. The dictation section seals the key on every change.

**Tech Stack:** TypeScript, React 19, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-09-29-pending-edits-outbox-design.md`

## Global Constraints

- `src/app`, `src/test` and `e2e` files are CRLF; docs are LF. Edit CRLF files through a node script that normalises line endings, never `sed -i`.
- Never put a credential or the Turso URL in a `localStorage` key or record; the scope uses the FNV-1a 53 hash of `httpUrl`.
- Storage key prefix: `aipm-cockpit:pending-edits:`. Scope suffix: `<hash(httpUrl)>:<projectId>` for chat threads, `<hash(httpUrl)>:templates` for templates.
- Expiry: `UNLOAD_JOURNAL_MAX_AGE_MS` (30 days). Size cap: `UNLOAD_JOURNAL_MAX_CHARS`.
- Nothing in `pending-edits.ts` may throw; storage calls are in try/catch and log through `logDiag`.
- Log event: `storage.pendingEditDropped` with `{ kind, id, reason }`, `reason` ∈ `"missing" | "changed" | "corrupt" | "expired"`; never the value. Write/flush failures: `storage.pendingEditsWriteFailed`.
- Vitest runs follow the LOCK protocol with cockpit-main, `--maxWorkers=2`, one process at a time.
- Commits cite §626; no attribution trailer; `git commit --only <paths> -F <msgfile>`.

## Review Focus

- A thread renamed, then deleted in another tab before the next start: replay must drop it (`"missing"`) and not recreate the thread. → Task 2 test.
- Two tabs each closing with a draft for the same template: the first replay applies; the second sees `base` ≠ stored and drops (`"changed"`). → Task 3 test.
- `localStorage.setItem` throwing (quota full, private mode) during `pagehide`: no exception escapes the listener. → Task 1 test.
- A project switch while a rename draft is open: the edit stays under the scope it was tracked in and is replayed only in that project. → Task 2 test.
- Next start without Turso (file mode): stored edits are not replayed and not cleared; they stay until expiry. → Task 2 test.

---

### Task 1: `pending-edits.ts` outbox

**Files:**
- Create: `src/app/pending-edits.ts`
- Modify: `src/app/unload-journal.ts` (export the existing `fnv1a53` as `hashForStorageKey`)
- Test: `src/app/pending-edits.test.ts`

**Interfaces:**
- Produces:
  - `type PendingEditKind = "chat-thread-name" | "template-name" | "template-body"`
  - `type PendingEdit = { v: 1; kind: PendingEditKind; id: string; base: string; value: string; savedAt: number }`
  - `PENDING_EDITS_PREFIX = "aipm-cockpit:pending-edits:"`
  - `pendingEditScope(httpUrl: string, part: string): string` — `${hashForStorageKey(httpUrl)}:${part}`
  - `trackPendingEdit(scope: string, edit: Omit<PendingEdit, "v" | "savedAt">): void` — replaces any live edit with the same `kind`+`id`; installs the module's single `pagehide` listener on first call
  - `settlePendingEdit(scope: string, kind: PendingEditKind, id: string): void`
  - `flushPendingEdits(now: number): void` — writes every scope's live set (an empty set removes the key); exported for tests, called by the listener
  - `takePendingEdits(scope: string, now: number): PendingEdit[]` — reads, removes the key, drops (and logs) corrupt and expired records
  - `resetPendingEditsForTests(): void`

- [ ] **Step 1: Write the failing tests** in `pending-edits.test.ts`:
  - `"a tracked edit is written on pagehide and taken back"`: track `{kind:"template-name", id:"t1", base:"A", value:"B"}` in scope `pendingEditScope("https://db.example.com", "templates")`, `window.dispatchEvent(new Event("pagehide"))`, then `takePendingEdits(scope, now)` returns one edit with `value: "B"`, and a second `take` returns `[]`.
  - `"a settled edit is not written"`.
  - `"re-tracking the same kind and id keeps only the latest value"`.
  - `"the storage key and record contain neither the URL nor a token"`: after flush, every `localStorage` key starting with `PENDING_EDITS_PREFIX` and its value do not contain `"db.example.com"` or `"secret-token"` (track with `pendingEditScope("https://db.example.com?authToken=secret-token", …)`).
  - `"an edit older than 30 days is dropped"`: stored `savedAt = now - UNLOAD_JOURNAL_MAX_AGE_MS - 1` → `[]` and `logDiag` called with `"storage.pendingEditDropped"` and `reason: "expired"`.
  - `"a corrupt record is dropped and logged"`: raw `"{not json"` under the key → `[]`, reason `"corrupt"`.
  - `"setItem throwing during pagehide does not escape"`: `vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); })`; dispatching `pagehide` does not throw; `logDiag` called with `"storage.pendingEditsWriteFailed"`.
  - `"a record over UNLOAD_JOURNAL_MAX_CHARS is not written"`.
- [ ] **Step 2: Run** `npx vitest run src/app/pending-edits.test.ts --maxWorkers=2` — FAIL (module missing).
- [ ] **Step 3: Implement** the interfaces above. Live edits: `Map<scope, Map<"kind:id", PendingEdit>>`. Mock `./diagnostics` in the test the way `unload-journal.test.ts` does.
- [ ] **Step 4: Run** the test — PASS; also `src/app/unload-journal.test.ts` still passes.
- [ ] **Step 5: Commit** `feat: add the pending-edits outbox (§626)`.

### Task 2: Chat thread rename

**Files:**
- Modify: `src/app/use-chat-threads.ts` (`renameThread`, load success branch; new `trackRenameDraft`, `cancelRenameDraft`)
- Modify: `src/app/chat-thread-list.tsx` (props `onRenameDraft?(id, value)`, `onRenameCancel?(id)`; call from the input's `onChange` and `cancelRename`)
- Modify: `src/app/chat-panel.tsx` (wire the two props next to `onRename` at the `ChatThreadList` render)
- Test: `src/app/use-chat-threads.test.tsx`, `src/app/chat-thread-list.test.tsx`

**Interfaces:**
- Consumes: Task 1's `pendingEditScope`, `trackPendingEdit`, `settlePendingEdit`, `takePendingEdits`.
- Produces on `useChatThreads`'s result: `trackRenameDraft(id: string, value: string): void`, `cancelRenameDraft(id: string): void`.
- Scope: `pendingEditScope(tursoConfig.httpUrl, projectId)`, computed at track time (so a project switch keeps the edit in its own scope). `base` = the thread's `name` at track time. A draft whose trimmed value equals `base` settles instead of tracking.
- `renameThread` tracks the committed value, and settles when its `saveThread` resolves (inside the existing `runPersist` success path); a rejection leaves it tracked.
- Replay: in the load effect's success branch, after `setLoadedProjectId(projectId)`, take the scope's edits and for each `chat-thread-name` edit: thread absent → drop `"missing"`; `thread.name !== base` → drop `"changed"`; else `renameThread(id, value)`. Only when `tursoMode` is true.

- [ ] **Step 1: Write the failing tests**
  - `chat-thread-list.test.tsx`: `"typing in the rename input reports the draft"` (`onRenameDraft` called with `("t1", "New")`); `"Escape reports the cancel"` (`onRenameCancel("t1")`).
  - `use-chat-threads.test.tsx` (existing Turso fetch mocking):
    - `"an open rename draft is written on pagehide"`: `trackRenameDraft("t1", "Renamed")`, dispatch `pagehide`, `takePendingEdits(scope, Date.now())` has `{kind:"chat-thread-name", id:"t1", base:"<old name>", value:"Renamed"}`.
    - `"a rename whose save has not resolved is written on pagehide"`: hold `saveThread`'s fetch pending, call `renameThread`, dispatch `pagehide` → the edit is stored.
    - `"a resolved rename is settled"`: after the save resolves, `pagehide` stores nothing.
    - `"the next load replays an edit whose base still matches"`: seed the scope with an edit (base = loaded name), mount → a `saveThread` pipeline carries the new name; the scope is empty afterwards.
    - `"an edit whose thread name changed meanwhile is dropped"`: base ≠ loaded name → no save; `logDiag` `"storage.pendingEditDropped"` with `reason: "changed"`.
    - `"an edit for a deleted thread is dropped, not recreated"`: reason `"missing"`, no save.
    - `"an edit tracked in project A is replayed only in project A"`.
    - `"without Turso nothing is replayed or cleared"`: `tursoMode: false` → the stored edit is still there.
- [ ] **Step 2: Run** both test files — the new tests FAIL.
- [ ] **Step 3: Implement** as specified in Interfaces.
- [ ] **Step 4: Run** both files plus `src/app/chat-panel*.test.tsx` — PASS.
- [ ] **Step 5: Commit** `fix: keep a chat thread rename typed before a close (§626)`.

### Task 3: Communication templates (name and body)

**Files:**
- Modify: `src/app/use-comm-templates.ts` (`upsertField`, initial load; new `trackDraft`, `cancelDraft`)
- Modify: `src/app/settings-sections/comm-templates-section.tsx` (name `<Input>` `onChange` → `trackDraft(id, "name", value)`; body `onChange` also calls `trackDraft(id, "body", value)`)
- Modify: `src/app/settings-view.tsx` (pass `commTemplates.trackDraft` through, next to `onRename`/`onSaveBody`)
- Test: `src/app/use-comm-templates.test.tsx`, `src/app/settings-sections/comm-templates-section.test.tsx`

**Interfaces:**
- Consumes: Task 1.
- Produces on `useCommTemplates`'s result: `trackDraft(id: string, field: "name" | "body", value: string): void`.
- Scope: `pendingEditScope(config.httpUrl, "templates")`. Kind: `"template-name"` / `"template-body"`. `base` = the template's current `name` / `body`. A value equal to `base` settles.
- `upsertField` settles the field's edit after `storeUpsert` resolves; a rejection leaves it tracked.
- Replay: after the initial load succeeds (and `active`), for each edit: template absent → `"missing"`; current field ≠ `base` → `"changed"`; else `upsertField(id, { [field]: value })`.

- [ ] **Step 1: Write the failing tests**
  - Section: `"typing a template name reports the draft"` and `"editing the body reports the draft"` (`trackDraft` spy called with the id, field and value).
  - Hook: `"an open name draft is written on pagehide"`, `"an open body draft is written on pagehide"`, `"a saved field is settled"`, `"the next load replays a name edit whose base matches"`, `"a body edit whose base no longer matches is dropped as changed"`, `"an edit for a deleted template is dropped as missing"`, `"two stored edits for one template from two tabs: the first applies, the second is dropped as changed"`.
- [ ] **Step 2: Run** both files — new tests FAIL.
- [ ] **Step 3: Implement** as specified in Interfaces.
- [ ] **Step 4: Run** both files plus `src/app/settings-view*.test.tsx` — PASS.
- [ ] **Step 5: Commit** `fix: keep a template name or body typed before a close (§626)`.

### Task 4: Speech-to-text key sealed on every change

**Files:**
- Modify: `src/app/settings-sections/dictation-section.tsx` (`handleSttKeyChange`)
- Test: `src/app/settings-sections/dictation-section.test.tsx`, `src/app/use-secrets.test.ts`

**Interfaces:**
- `handleSttKeyChange(value)`: when `value.trim() !== ""`, also `void saveSecretValue("sttApiKey", value.trim(), "device")`. The emptying branch and `handleSttKeyBlur` stay as they are.

- [ ] **Step 1: Write the failing tests**
  - Section: `"each non-empty change seals the key"` (typing `"ab"` → `saveSecretValue` called with `"a"` then `"ab"`); `"emptying the field removes the seal and does not seal"`.
  - `use-secrets.test.ts`: `"an older seal that finishes after a newer one does not overwrite it"` (two `saveSecretValue` calls, the first held until the second finished → the stored sealed value decrypts to the second). Skip this test if an existing test already pins §609 ordering; name that test in the task report instead.
- [ ] **Step 2: Run** — the section test FAILS.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both files — PASS.
- [ ] **Step 5: Commit** `fix: seal the speech-to-text key as it is typed (§626)`.

### Task 5: Docs and register

**Files:**
- Modify: `src/app/use-commit-on-page-hide.ts` header (the §626 sentence now points to `pending-edits.ts`)
- Modify: `docs/AGENTS/storage.md` (a short "Pending edits" bullet under the unload journal: what it stores, scope rule, replay rule)
- Modify: `docs/open-followups.md` §626 → `— CLOSED <date>`, status names the mechanism, the tests, the mutation results, the key's millisecond residual, and that jsdom cannot prove a real browser keeps the `setItem` across a close; remove its `**Work item:**` line; run `node scripts/rebuild-followup-index.mjs`.

- [ ] **Step 1: Edit** the three files.
- [ ] **Step 2: Run** `npm run -s docs:claims:check`, `docs:symbols:check`, `src:symbols:check`, `followups:index:check`, `followups:status:check`, `followups:workitems:check`, `size:check`, `dup:check`, `rownames:check`, plus `npx tsc --noEmit -p .` and `npx eslint --max-warnings=0` on every changed file — all exit 0.
- [ ] **Step 3: Mutation checks** (node script, each mutant must turn a test red): pagehide listener not installed; settle not called on save success; `base` comparison removed from either replay; replay runs without `tursoMode`/`active`; key sealed only on blur.
- [ ] **Step 4: Commit** `docs: close §626 with the pending-edits outbox`.

---

## Added 2026-09-29 (owner-approved designs in chat): §604 and §603

These two tasks ride the same branch. They do not depend on Tasks 1–5.

### Task 6: Chat thread writes stay in the Turso database they started in (§604, #385)

**Files:**
- Modify: `src/app/use-chat-threads.ts`
- Test: `src/app/use-chat-threads.test.tsx` (or a new `use-chat-threads.target.test.tsx` if the file is near the size limit)
- Modify: `docs/open-followups.md` §604 (close), `src/app/chat-panel.tsx` comment near `switchedAway` that points to §604

**Interfaces:**
- The busy-persist effect records the `tursoConfig` of the render where `busy` turns TRUE (a `turnConfigRef`, set on the rising edge next to `prevBusyRef`) and saves with that config on the falling edge, never the live one.
- `renameThread` uses the config of its click render (already so) — pin it explicitly in the closure passed to `runPersist`.
- `requestDeleteThread` captures `tursoConfig` into a local BEFORE its confirm `await` and passes that local to `deleteThreadRow`.
- A `targetEpochRef` increments in an effect on `[tursoConfig]`. `retryLoad` captures it with `issuedAtEpoch` and drops its settle when it moved, logging `storage.chatThreadsStaleTargetDropped` (no URL, no token in the log).

- [ ] **Step 1: Failing tests:** `"a send whose Turso config changes mid-turn persists to the database it started in"` (config A → start send → rerender with config B → finish → the saveThread fetch goes to A's URL, none to B's); `"a delete confirmed after a config change deletes in the database the dialog was opened in"`; `"a load retry issued before a config change is dropped when it settles"` (logDiag called with `storage.chatThreadsStaleTargetDropped`, threads unchanged).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** as in Interfaces; update the §604 comments in `use-chat-threads.ts` and `chat-panel.tsx`.
- [ ] **Step 4: Run** the chat-thread and chat-panel test files — PASS; mutation: persist uses live config; delete reads config after the await; retry epoch check removed — all killed.
- [ ] **Step 5:** close §604 in the register (remove its Work item line, rebuild the index), commit `fix: keep chat thread writes in the Turso database they started in (§604)`.

### Task 7: The picked-file write skips a backend replaced while it queued (§603, #384)

**Files:**
- Modify: `src/app/use-load-truncation.ts` (`guardedWrite`)
- Modify: `src/app/use-storage-file-ops.ts` (`onPickStorageFile` overwrite branch; the other `guardedWrite` call site keeps today's behaviour unless it has a current-backend check to pass)
- Test: `src/app/use-storage-backend.superseded-gate.test.tsx` (it already hangs `first.save`)
- Modify: `docs/open-followups.md` §603 (close, with the residual)

**Interfaces:**
- `guardedWrite(backend, ws, isCurrent?: () => boolean): Promise<boolean>` — when `isCurrent` is given, the thunk passed to `enqueueSave` checks it right before `backend.save(ws)`; if false it does not call `save`, logs `storage.supersededLoadDropped` with `{ writer: "onPickStorageFile", stage: "write-queued" }`, and `guardedWrite` resolves false. Existing callers without `isCurrent` are unchanged.
- `onPickStorageFile` passes `deps.isBackendCurrent`; a false result takes the existing superseded exit (no `allowSavesToActiveBackend`).

- [ ] **Step 1: Failing test:** `"a picked-file write queued behind an autosave never reaches a backend replaced while it waited"` — an autosave hangs on `first`, pick the file (write queues), rebuild the backend, release the autosave → `first.save` was never called with the picked workspace, the gate stays closed, logDiag has `stage: "write-queued"`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the superseded-gate, pick-overwrite and load-truncation test files — PASS; mutation: the in-thunk check removed; `isCurrent` not passed — both killed.
- [ ] **Step 5:** close §603 in the register: the queued window is closed; a save already RUNNING when the rebuild lands cannot be aborted (no backend can abort an in-flight write), a one-write window, recorded as the residual. Commit `fix: skip a picked-file write whose backend was replaced while it queued (§603)`.
