# Pending-edits outbox — design (§626)

Register §626, GitHub #442. Owner decisions 2026-09-29: write a spec first; replay a draft only if the
stored value is unchanged; seal the speech-to-text key on every change.

## Problem

Three editors keep what the user typed in memory and commit it asynchronously, so a window close,
reload or navigation before the commit lands loses it:

| Editor | Draft lives in | Commit | Durable write |
|---|---|---|---|
| Chat thread rename (`chat-thread-list.tsx`) | `draftName` state | blur / Enter → `renameThread` (`use-chat-threads.ts`) | `saveThread` → Turso, via `runPersist` |
| Template name (`settings-sections/comm-templates-section.tsx`) | the uncontrolled `<Input>`'s DOM value | blur / Enter → `useCommTemplates.rename` | `upsertTemplate` → Turso |
| Template body (same file) | `bodyDraft` state | blur of the editor group → `useCommTemplates.saveBody` | `upsertTemplate` → Turso |
| Speech-to-text key (`settings-sections/dictation-section.tsx`) | `settings.dictation.sttApiKey` | blur → `saveSecretValue` (`use-secrets.ts`) | WebCrypto seal → `localStorage["aipm-cockpit:secrets"]` |

Chat threads and templates exist only in Turso mode. `useCommitOnPageHide` (§622) cannot help: it
can only START an async commit on `pagehide`. The unload journal (§629) is workspace-shaped and must
never carry a credential.

Two windows are lost today, not one: a draft never committed (no blur before the close), and a commit
that started at blur but had not landed when the page went away.

## Goals and non-goals

- Goal: a rename or template draft typed before a close is applied on the next start, unless the
  stored value changed in the meantime.
- Goal: the speech-to-text key is sealed as it is typed, so a close after typing keeps it.
- Non-goal: guaranteeing the network write during unload (`keepalive`/`sendBeacon`). The Turso
  pipeline needs an auth header and a response to know the write landed; a beacon gives neither.
- Non-goal: other editors. §625 classifies every other editor as synchronous.

## Design

### 1. `src/app/pending-edits.ts` — the outbox (pure module)

A pending edit is:

```ts
type PendingEdit = {
  v: 1;
  kind: "chat-thread-name" | "template-name" | "template-body";
  id: string;          // thread id or template id
  base: string;        // the stored value the draft started from
  value: string;       // the draft
  savedAt: number;     // epoch ms
};
```

- **Scope.** One `localStorage` key per scope: `aipm-cockpit:pending-edits:<scope>`, holding an array
  of `PendingEdit`. The scope is a hash of the Turso `httpUrl` (FNV-1a 53, the unload journal's
  function, exported for this) plus `:<projectId>` for chat threads or `:templates` for templates.
  Neither the URL nor the token appears in the key or the record.
- **In-memory registry.** `trackPendingEdit(scope, edit)` and `settlePendingEdit(scope, kind, id)`
  keep the live set in memory. Nothing touches `localStorage` while the page is alive.
- **Flush.** One `pagehide` listener, installed by the module on first use, writes each scope's live
  set synchronously (one `setItem` per scope). Same never-throw rule as `unload-journal.ts`: every
  storage call is inside try/catch, failures are logged with `logDiag`, never thrown.
- **Read and clear.** `takePendingEdits(scope, now)` returns the stored edits younger than 30 days
  (the journal's `UNLOAD_JOURNAL_MAX_AGE_MS`) and removes the key. Records that fail to parse are
  dropped and logged. The factory reset already clears every `aipm-cockpit:` key.
- **Size.** A record over `UNLOAD_JOURNAL_MAX_CHARS` is not written and is logged.

### 2. When an edit is tracked and settled

An edit is live from the first keystroke that makes the draft differ from `base` until its durable
write resolves:

- Draft differs from base → `trackPendingEdit` (updated on each change).
- Draft cancelled (Escape), or equal to base again → `settlePendingEdit`.
- Commit starts (blur/Enter) → the edit stays tracked, with the committed value.
- The Turso write resolves → `settlePendingEdit`. A rejected write leaves it tracked; the existing
  retry paths (`runPersist`) keep working as today.

So a close covers both windows: the open draft, and the commit that started but had not landed.

The template name input stays uncontrolled; its `onChange` tracks the edit, so no DOM read happens
during `pagehide`.

### 3. Replay on the next start

- **Chat threads:** in `useChatThreads`, after `loadThreads` settles for `projectId` (the success
  branch, where `setLoadedProjectId(projectId)` runs).
- **Templates:** in `useCommTemplates`, after the initial `load()` succeeds.

For each edit taken from the scope:

1. The target is missing → drop, log `storage.pendingEditDropped` with `reason: "missing"`.
2. The stored value is not `base` → drop, log with `reason: "changed"` (owner decision: never
   overwrite a later edit).
3. Otherwise apply through the normal path (`renameThread`, `rename`, `saveBody`), tracked like any
   commit. A failed write stays tracked, so the next close stores it again.

Logs carry `kind` and `id` only, never the value.

### 4. Speech-to-text key: seal on every change

`handleSttKeyChange` calls `saveSecretValue("sttApiKey", v, "device")` on every non-empty change,
and blur keeps doing the same. `beginSealedWrite` (§609) already makes the newest call win over an
older seal still in flight. The plaintext is never written to the outbox or anywhere else.

Residual: a close within the few milliseconds between the last change and its seal landing (device
key read from IndexedDB, AES-GCM encrypt) loses that last change. It is recorded in the register, not
claimed closed.

## Error handling

- Storage unavailable or full: the flush logs and continues; the page teardown is never interrupted.
- Corrupt record: dropped and logged at read.
- Replay write fails: normal error path of that editor (silent-failure report for templates, retry
  map for chat threads); the edit stays tracked.

## Testing

- `pending-edits.test.ts`: track/settle/flush/take; the 30-day expiry; the key contains no URL or
  token; storage throwing on `setItem`/`getItem` never throws out of the module; oversize record
  skipped; corrupt record dropped.
- Chat rename: a draft plus `pagehide` writes the edit; a commit whose save has not resolved plus
  `pagehide` writes it; a resolved save settles it; the next mount replays it when the stored name
  equals `base`, drops it when it does not, and drops it when the thread is gone.
- Templates: the same three cases for name and body.
- Key: every change calls `saveSecretValue`; an older seal finishing after a newer one does not win.
- Mutation checks on the tracking, the flush, the base comparison and the replay, then review.
- Honest limit: jsdom proves the flush happens inside `pagehide`, not that a real browser keeps the
  write across a close; `localStorage.setItem` is synchronous, which is why it is the mechanism.

## Register

- §626 closes for chat rename and template name/body.
- The key's millisecond window is recorded as a known residual in §626's closing status.
- New register numbers from §647.
