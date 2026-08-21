# Chat Thread Persistence — Design

**Status:** Approved for planning
**Sub-project 1 of 2** (from the "per-project Claude chat-memory / action-history" brainstorm). Sub-project 2 — surfacing past actions/decisions back to the AI as retrievable context — is a separate, later slice that depends on this one existing. Not designed here.

## Problem

The AI chat panel keeps its conversation in an in-memory `Map<projectId, ChatConversation>` (`workspace-tab-context.tsx`), seeded into `chat-panel.tsx` on mount. It survives view-navigation remounts but is lost on page reload, browser close, or device switch. There is also no way to have more than one conversation per project — starting a new topic means losing or overwriting the current one.

This slice makes chat durable and multi-threaded, **Turso-only** (per-project storage mode already added for the project picker). File-mode keeps today's behavior unchanged.

## Non-goals

- Feeding past chat/action history back to the AI as context (sub-project 2).
- Cross-device live sync / conflict resolution beyond last-write-wins.
- Persisting attachment bytes (see below).
- Any change to file-mode chat behavior.
- Search across threads.

## Data model

New global Turso table, following the `committee_report_versions` precedent exactly (a manually project-scoped table kept OUT of `TABLE_NAMES` so the workspace save's per-table DELETE never touches it — it holds no `Workspace` field and needs no CSV/MD/JSON codec):

```sql
CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  name TEXT,
  created_at TEXT,
  updated_at TEXT,
  history_json TEXT,
  display_json TEXT
)
```

```ts
export interface ChatThread {
  id: string;
  projectId: string;       // "default" in non-portfolio Turso mode, matching chat-panel's existing projectId default
  name: string;
  createdAt: string;
  updatedAt: string;
  history: ApiMessage[];    // stripped of attachment bytes before persisting — see below
  display: DisplayItem[];
}
```

`history_json`/`display_json` are `JSON.stringify`d columns (same JSON-in-a-cell convention as `note-log.ts`'s `encodeNoteLog`/`decodeNoteLog`).

**New files**, mirroring `committee-report-versions-schema.ts` / `committee-report-versions-store.ts`:
- `chat-threads-schema.ts` — DDL, `threadsSelect(projectId)`, `insertOrUpdateThreadStatements(thread)`, `deleteThreadStatements(id)`, `pruneThreadsStatements(projectId, keep)`, `rowsToThreads(res)`.
- `chat-threads-store.ts` — `loadThreads(config, projectId)`, `saveThread(config, thread)` (upsert + prune in one pipeline), `deleteThread(config, id)`.

`CHAT_THREAD_CAP = 50` per project (oldest by `updatedAt` pruned on save beyond cap) — higher than the report-versions cap (25) since threads are casual/frequent rather than formal snapshots.

## Attachment handling

Chat messages can carry `AttachmentBlock` content (base64 images/documents, up to `MAX_ATTACHMENT_BYTES` = 20MB each). Persisting them would mean rewriting every prior attachment on every turn's save (the same write-amplification problem that ruled out a single meta-blob, but inside a thread across turns).

**Decision: strip attachment bytes before persisting.** A small `stripAttachmentsForPersistence(history: ApiMessage[]): ApiMessage[]` pure helper replaces each `AttachmentBlock` in stored history with a `TextBlock` placeholder (e.g. `[attachment: report.pdf]`). Attachments work normally for the live session and remain visible until the panel is navigated away/reloaded; reopening a thread later shows the placeholder text, not the original file. This bounds storage growth and keeps the write cost roughly proportional to text length only.

## Persistence trigger

- **Load:** chat panel mount (Turso mode only) → `loadThreads(config, projectId)` → sidebar renders, auto-select most-recently-updated thread, or empty state if none.
- **Save:** after each completed turn (assistant reply finishes — success, error, or user-cancelled) → `saveThread` with the full (attachment-stripped) history/display and a bumped `updatedAt`. No debounce needed: turns are already serialized by the existing `busy` send-lock, so at most one save per turn.
- **New thread:** "New chat" creates a blank in-memory thread (no row yet, `id` pre-minted client-side like other entity creates). On the first turn's completed save, the row is inserted with `name` auto-derived from the first user message's text (first ~60 chars, plain slice — thread names are cosmetic labels, not rich HTML, so this doesn't need `capHtmlText`'s surrogate-pair care). Renaming afterward is a plain update; it never re-derives.
- **Switch thread:** swap in-memory `history`/`display` state to the target thread's already-fetched copy (no second round-trip) — same render-time reconcile pattern `chat-panel.tsx` already uses for project switches (guarded by a `seenThreadId` state, not an effect).
- **Delete:** per-thread delete button, single-item confirm (`useConfirm`) — not the heavier `TypeToConfirmDialog` (reserved for bulk "clear all" elsewhere in the app). Deleting the active thread falls back to the next-most-recently-updated thread, or the empty state if none remain.
- **Two tabs/devices on the same thread:** last-write-wins by `updatedAt`, same accepted simplification as workspace saves elsewhere. No merge UI.
- **Project switch while panel stays mounted** (Turso portfolio mode, multiple projects): re-fetch that project's thread list and reset to its most-recently-updated thread (or empty state) — same `seenProjectId` render-time reconcile `chat-panel.tsx` already does today, just now also re-fetching from Turso instead of reading the in-memory map.

## UI

Chat panel splits into two columns **only when `portfolioMode === "turso"`**; file-mode chat is byte-identical to today (no sidebar, no thread state).

- Left: thread sidebar — `role="list"`, each row a button with a row-unique accessible name (`${threadName} – ${t(lang,"chatThreadOpen")}` pattern, matching this app's existing per-row-control convention), truncated name + `title` for the full string, inline rename (pencil `IconButton`) + inline delete (trash `IconButton`), active row marked by both the standard row-highlight AND a non-colour marker (same rule as `ToggleButton`'s pressed marker — active state can't be colour-only, WCAG 1.4.1). "New chat" button (`Button`, primary) above the list.
- Right: existing transcript + input, unchanged.
- Zero threads: `EmptyState` primitive, "Start a new chat" prompt + the same "New chat" action.
- Save failure: non-blocking `Banner` ("Couldn't save this chat" + retry), same posture as the existing `AiHttpError`/`classifyAiError` handling already in `chat-panel.tsx`. The live transcript is never cleared or blocked by a save failure.
- Read failure on mount: degrade to empty thread list + "New chat" only, don't crash the panel.

All from shared primitives (`Modal`/`Button`/`IconButton`/`EmptyState`/`Banner`) — no hand-rolled list/row chrome.

## Concurrency guard

Extend the existing `projectIdRef` mid-send guard (already present in `chat-panel.tsx` to stop a stale send's trailing write from landing on the wrong project) to also carry `threadId`, so a stale in-flight reply can't get saved onto a thread the user has since switched away from.

## Accessibility note (read this before shipping)

"AI Assistant" **is** in the axe `A11Y_VIEWS` list, but the e2e seed runs in file mode, and the sidebar only renders in Turso mode — so the axe gate will keep scanning the *unchanged* file-mode chat panel and will never see the new sidebar at all. This is the same Turso-gated blind spot as Calendar/Snapshots (documented in AGENTS.md). The unit tests below (row-unique names with ≥2 threads seeded) are the **only** coverage for this surface, plus a manual eye-verify against a real Turso project before ship. This must be stated explicitly in the implementation plan and in AGENTS.md when this ships — not left implicit.

## i18n keys needed (exact strings decided at implementation time)

`chatThreadNew`, `chatThreadRename`, `chatThreadDelete`, `chatThreadDeleteConfirm`, `chatThreadEmptyTitle`, `chatThreadEmptyBody`, `chatThreadSaveFailed`, `chatThreadSaveRetry`, `chatThreadUntitled` (fallback name before first message resolves a name), `chatThreadOpen` (accessible-name suffix for the row button).

## Testing

- Unit: `chat-threads-schema.ts` DDL shape (single flat table, no tenant/single-tenant split needed — this precedent, like `committee_report_versions`, always carries a plain `project_id TEXT` column and is scoped by whatever value the caller passes).
- Unit: `chat-threads-store.ts` — save/load/delete, and the cap-eviction path specifically (mirrors `committee-report-versions-store.test.ts`'s prune coverage).
- Unit: `stripAttachmentsForPersistence` — attachment blocks become text placeholders, non-attachment content untouched.
- Unit: `chat-panel.tsx` sidebar — thread switch reconciles history/display correctly (render-time reconcile, not an effect); new-thread-then-first-message triggers insert with auto-derived name; rename doesn't re-derive; deleting the active thread falls back correctly; row-unique accessible names with ≥2 threads seeded.
- Unit: file-mode chat panel is unchanged (guards the axe-blind-spot argument this design leans on).
- A guard test enforcing `chat_threads` stays OUT of `TABLE_NAMES` (same convention as the committee/comm-template version tables).
- No e2e/axe addition for the sidebar itself — documented reason above, not a silent gap.

## Out of scope (explicitly deferred)

- Sub-project 2: AI recall of past actions/decisions as context.
- Attachment persistence.
- Cross-thread search.
- Any multi-device conflict resolution beyond last-write-wins.
