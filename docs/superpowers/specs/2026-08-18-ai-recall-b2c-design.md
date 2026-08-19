# AI Recall B2c — chat-thread search + ambient thread pointer

**Status:** designed 2026-08-18, not started. Third and last slice of the "recall" arc
(B2a 0.241.0, B2b 0.244.0).

**Goal:** the assistant can search this project's past conversations, and knows unprompted
that they exist.

---

## What changed from B2a's plan for this slice

B2a scoped B2c as "chat-thread search + cross-thread continuity" and deferred it to last on
one stated ground: it *"is the only piece that needs the model to write something durable,
which brings a new write path, an invalidation rule and a cost-per-summary decision with it."*

**Two measurements taken while designing this slice removed all three.** Both reverse a
recorded B2a decision, so they are stated here rather than applied quietly.

### 1. The ambient half needs no model call — `deriveThreadName` already exists

`chat-threads.ts` exports `deriveThreadName(display)`, which derives a thread's name from its
first user message with code-point-safe truncation. Titles and dates are therefore already in
memory, free. The ambient pointer this slice ships is built from `deriveThreadName` plus
`ChatThread.updatedAt` and costs **zero billed calls and zero durable writes**.

Model-written per-thread summaries are consequently **out of scope**. They were the only
consumer of the write path, the staleness rule and the cost-per-summary decision.

### 2. Chats cannot ride `HistoryResult.events`, so the `source` discriminator dies with it

B2a recorded: *"A `source` discriminator on `events` — one source, so YAGNI. B2c adds it."*
That presumed chats would widen `search_history`. They cannot.

`RenderedActivity` (in `activity-prompt.ts`) is `{ at, summary, actor? }` — one event, one
line, one timestamp. A chat hit is a thread containing N messages, and **`DisplayItem` carries
no timestamp**; only the thread has `createdAt` / `updatedAt`. Verify:

```bash
git grep -nA10 "^export type DisplayItem" -- src/app/chat-api.ts
```

Widening would force either a fabricated `at` — the thread's `updatedAt` stamped on every
message, a lie in the exact field the model uses to date things — or an optional `at`, which
breaks the contract for activity results too. So: a **separate `search_chats` tool**, and the
`source` discriminator is dropped as YAGNI. It only ever existed to disambiguate a merged
array that no longer exists.

---

## What B2a's carried-forward notes got right

Re-verified against the tree at `6c9ee098`, all still hold:

- `CHAT_THREAD_CAP` is 50 (`chat-threads-schema.ts`).
- `loadThreads` (`chat-threads-store.ts`) returns full `history` + `display` for every thread
  in one pipeline, fetched once on mount and gated on `tursoMode`.
- Search is therefore an **in-memory filter**: no new SQL, no second Turso round-trip.
- Searched text is the **stored** history, already attachment-stripped by
  `stripAttachmentsForPersistence`.
- The **active thread is skipped** — it is already verbatim in the model's context.

---

## Architecture

Four pieces plus a toggle, in dependency order.

### 1. Engine — `chat-search.ts` (new, pure, i18n-free, clock-free)

```ts
export const DEFAULT_CHAT_LIMIT = 20;
export const MAX_CHAT_LIMIT = 50;

export interface ChatQuery {
  query?: string;
  /** Inclusive lower bound, `YYYY-MM-DD`. */
  since?: string;
  /** Inclusive upper bound, `YYYY-MM-DD`. */
  until?: string;
  limit?: number;
}

export interface ChatHitMessage {
  role: "user" | "assistant";
  text: string;
}

export interface ChatHit {
  threadId: string;
  /** `deriveThreadName`, or "" when the thread holds no user message yet. */
  title: string;
  /** Rewritten into the project zone's offset-bearing form, exactly as
   *  `searchHistory` rewrites `at` — see that engine's comment for why a UTC
   *  clock beside a local-day filter is a half-fix. */
  updatedAt: string;
  /** Matched messages only, in thread order. */
  messages: readonly ChatHitMessage[];
  /** Matched in this thread but withheld by the cap. */
  moreMessages: number;
}

export type ChatCoverage = "turso" | "unavailable";

export interface ChatSearchResult {
  hits: ChatHit[];
  /** "More matched than you are seeing" — NOT "a cap was applied". Same
   *  contract as `HistoryResult.truncated`: a cap that happened to cut
   *  nothing reports false. */
  truncated: boolean;
  coverage: ChatCoverage;
}

export function searchChats(
  threads: readonly ChatThread[],
  activeThreadId: string | null,
  q: ChatQuery,
  tz: string,
  available: boolean,
): ChatSearchResult;
```

Decisions, each with its reason:

- **Searches `display`, filtered to `kind === "user" | "assistant"`** — not `history`. Both are
  persisted, but `history` carries raw tool-use blocks the model does not need to re-read, and
  `DisplayItem`'s union already separates the two roles from `notice` and `tool`.
- **Skips `activeThreadId`.** Returning the live thread would spend context re-stating what is
  already verbatim in the request.
- **Day bounds via the existing `dayInZone`**, not a new comparison — the same decision
  `searchHistory` makes. A thread whose `updatedAt` has no parseable day is **excluded**.
- **`limit` caps MESSAGES, not threads.** A thread cap would let one chatty thread hide every
  other match. There is no thread-level cap at all — every thread holding a match appears, and
  the message budget is what runs out. `truncated` is true exactly when some matched message
  was withheld, which is also the condition under which some `moreMessages` is non-zero.
- **`resolveLimit` is REUSED, not re-derived.** It is module-private in `history-search.ts`
  today; this slice exports it. It carries a documented trap — the floor happens *before* the
  non-positive test, so a model-supplied `0.5` cannot yield `{ hits: [], truncated: true }`,
  the one output combination that actively misleads the caller. A second hand-written copy is
  one slip from re-introducing exactly that.

### 2. Ambient pointer

`getSnapshot()` gains:

```ts
/** Bounded pointer at past conversations — a count and up to three titles.
 *  ★★★ NOT the threads. `get_app_state` returns the snapshot VERBATIM, which
 *  is why `getChatThreads()` is a separate method, exactly as
 *  `getActivityLog()` is. This is safe there for the same reason
 *  `activitySummary` is: bounded and small. */
chatPointer?: ChatPointer;
```

`ChatPointer` is `{ count: number; recent: readonly { title: string; at: string }[] }` — top 3
by `updatedAt` descending, active thread excluded, `at` rendered in the project zone.

Rendered into `volatileText` in `chat-api.ts` beside `activityBlock`, by a renderer alongside
`buildActivityRecapBlock`. It **must** sit in the volatile suffix: thread state changes every
turn, and in the cached prefix it would invalidate the prompt cache on every message — the
same reasoning the activity recap already carries.

### 3. Transport — `chat-threads-registry.ts` (new)

A plain module store keyed by `projectId`:

```ts
export interface PublishedThreads {
  threads: readonly ChatThread[];
  activeThreadId: string | null;
  available: boolean;
}
export function publishChatThreads(projectId: string, value: PublishedThreads): void;
export function readChatThreads(projectId: string): PublishedThreads;
export function clearChatThreads(): void;
```

`readChatThreads` on an unknown project returns an empty list with `available: false`.
`clearChatThreads` is the test reset.

**No `useSyncExternalStore`, no listener set, no snapshot cache, no equality function.** The
precedent this copies — `project-appearance-prefs.ts`, consumed by the dispatcher today via
`useViewDigest` — needs all four because components *render* from it. Nothing renders from
chat search: `getSnapshot()` reads at send time. Adding reactivity here would be machinery
with no consumer.

**The publish lives in `use-chat-threads.ts`, not `chat-panel.tsx`.** The hook already owns
`threads`, `activeThreadId`, `projectId` and `tursoMode`, and it has 337 lines of headroom
against the 800 cap. Publishing from the panel instead would cost lines on a file sitting at
exactly its baseline. See "Size budget".

### 4. Tool — `search_chats`

A new entry in `TOOL_DEFS`, an executor case in `runTool`, and two `ToolDispatcher` methods:
`getChatThreads(): PublishedThreads` and `isChatSearchEnabled(): boolean`.

Advertisement and enforcement **both** read one predicate, `chatSearchEnabled(...)` in
`settings-types.ts`, mirroring `historySearchEnabled`. Two hand-spelled `=== false` checks are
a config slip away from advertising off while serving on — the state §162 recorded.

### 5. Toggle — `AiConfig.chatSearch`

`chatSearch?: boolean`, default ON by absence, beside `historySearch` and `activityRecap`.
Needs, in lockstep: the `AiConfig` field, the `chatSearchEnabled` predicate, a
`sanitizeAiConfig` line, an `ai-section.tsx` row, and EN + DE strings.

---

## The tool-list variant problem

`chat-api.ts` today holds **two frozen module-level variants** — `CACHED_TOOLS` and
`CACHED_TOOLS_NO_HISTORY` — with a comment stating the rule: *"TWO FROZEN MODULE-LEVEL
VARIANTS, never a filter at the call site"*, because the list ships on every request and
rebuilding it per call would destroy referential stability.

A second independent toggle makes that **four** combinations, and a third would make eight.

**Resolution: a lazily-populated memo keyed by the flag combination**, not four constants.
This preserves the invariant the comment actually defends — one array identity per settings
combination, stable for the whole conversation — while the "two frozen constants" *spelling*
does not survive a second toggle. `withCacheBreakpoint` runs per variant inside the memo,
which also preserves the existing rule that the breakpoint is **recomputed, never assumed**.
`toolsFor`'s own comment records why, from a measurement dated 2026-08-16 — do not restate its
index-and-count figures as current, and re-measure if the position matters to your change. The
durable part is the reason: a tool appended after the removed one would make a
does-not-move-the-marker assumption silently wrong, and a lost breakpoint is invisible except
as a bill.

`TOOL_NAMES` stays **derived from the arrays `toolsFor` returns**, never hand-listed — so
"what the model is told it has" and "what the request carries" cannot disagree.

---

## Size budget — the dominant constraint

Measured 2026-08-18. Reproduce a single file with:

```bash
node -e "console.log(require('fs').readFileSync(process.argv[1],'utf8').split('\n').length)" <file>
```

The gate counts `wc -l` **plus one**; budgeting from `wc -l` overstates headroom by exactly
one line and fails the commit.

| file | lines | limit | headroom | this slice |
|---|---|---|---|---|
| `task-manager.tsx` | 3020 | 3020 baselined | **0** | **untouched** |
| `workspace-section.tsx` | 1000 | 1000 baselined | **0** | **untouched** |
| `chat-panel.tsx` | 996 | 996 baselined | **0** | **untouched** |
| `use-chat-dispatcher.ts` | 798 | 800 | **2** | two bindings — needs extraction |
| `chat-tools.ts` | 766 | 800 | **34** | tool def + executor + 2 methods + snapshot field |
| `settings-types.ts` | 742 | 800 | 58 | field + predicate + sanitize line |
| `ai-section.tsx` | 545 | 800 | 255 | one toggle row |
| `chat-api.ts` | 383 | 800 | 417 | variant memo + pointer block |
| `use-chat-threads.ts` | 463 | 800 | 337 | publish effect |
| `activity-recap.ts` | 139 | 800 | 661 | pointer renderer |
| new files | — | 800 | — | engine, registry, executor |

**Three files sit at zero headroom and this slice touches none of them.** That is the reason
the transport is a module store rather than a ref threaded down the prop chain: the ref costs
roughly a dozen lines spread across all four capped files, and the store costs zero on three
of them.

**Two real pressure points:**

- `use-chat-dispatcher.ts` at **2 lines**. The executor body and the snapshot assembly go in a
  new module the dispatcher calls, following the `chat-task-patch.ts` extraction precedent.
- `chat-tools.ts` at **34 lines**. A tool definition plus an executor case plus two interface
  methods plus a snapshot field will exceed that *at this file's comment density*. Comment
  volume alone has failed this gate on this arc's earlier slices. Long reasoning goes in
  `open-followups.md` and is cited, not inlined. Re-baselining to admit the slice's own
  comments defeats the gate and is not an option.

---

## Landmines — written in, not discovered

**`coverage` derives from `tursoMode`, never `threads.length`.** B2a recorded this and it is
the sharpest failure mode in the slice: "Turso with no chats yet" and "file mode, cannot look"
both present as an empty array. Collapsing them makes the model tell every file-mode user
*"I searched your past conversations and found nothing"* — confidently, and permanently.

**The store must be cleared EXPLICITLY when `tursoMode` goes false.** `panel-chat` is one of
only two tabpanels `workspace-section` mounts unconditionally (with `panel-raid`) — it is
`hidden`-toggled, has no `key`, and never remounts on navigation. For those two panels the
danger runs opposite to the usual remount-swallow: nothing will ever clear stale state for
you. This is the exact shape of the retained-thread-id bug that silently killed every send
after a Turso→file switch. Verify the panel set rather than trusting this paragraph:

```bash
grep -n -B4 "hidden={activeTab" src/app/workspace-section.tsx
```

**`sanitizeAiConfig` must carry `chatSearch` in its return literal.** The field is optional, so
omitting it is a typecheck-clean silent drop **on read**: `writeSettings` persists the user's
`false` correctly and the next load throws it away, reverting the toggle to ON. That is §165,
found in this arc's own review round. The function already carries a comment stating that
every default-ON-by-absence flag must appear there.

**Only the round-trip assertion is load-bearing.** A dropped key and a default read
*identically* — both yield `undefined`, both mean ON — so a test asserting "absent ⇒ ON" is
green against the broken code. That is precisely why `actionSuggestions` went unpinned for its
entire life. The test must write `false`, sanitize, and assert `false` survives.

**One predicate for advertisement and enforcement.** §162, in the direction where only the
advertisement existed.

**`args` guard on the executor.** §164: `renderActivityEntry` lacked the guard the panel had,
and it runs inside the AI tool loop. Coerce a bad positional element in place — never filter
it, because `args` is spread against `{0}`/`{1}` and dropping one shifts every later
placeholder, turning a crash into silently wrong text.

**DE strings need a node utf8 write.** `i18n.de.ts` is CRLF and the Edit tool corrupts umlauts
and curls double quotes — including in umlaut-free strings. An anchor spelled `\n` silently
no-ops; match `\r\n`. Re-verify the bytes afterwards.

---

## Testing

- **Engine** (`chat-search.test.ts`) — pure, no DOM. Day-bound inclusivity at both ends;
  an unparseable `updatedAt` excluded; the active thread absent from results; `truncated`
  false when the cap cut nothing and true when it cut something; `moreMessages` counting
  withheld matches; a `limit` of `0.5` returning the default rather than zero-with-truncated.
- **Coverage** — `available: false` yields `coverage: "unavailable"` with zero hits, and
  `available: true` with an empty thread list yields `coverage: "turso"`. **These two must be
  separate assertions.** One test covering "empty result" cannot tell them apart, which is the
  whole defect.
- **Registry** — publish/read round-trip per `projectId`; an unknown project returns
  `available: false`; `clearChatThreads` resets. Wired as a global test reset, since module
  state survives `vi.clearAllMocks()`.
- **Toggle** — the round-trip assertion above, plus advertisement and enforcement both flipping
  from the one predicate.
- **Tool** — the executor refuses when the toggle is off; malformed `input` fields
  coerce-or-drop rather than throw; a non-string `query` drops rather than stringifies.

`test:shuffle` at the pinned seed is the gate that would catch registry state leaking between
test files. Run it before pushing — it is the only local reproduction of `unit-tests-shuffled`.

---

## Non-goals

- Model-written thread summaries, and with them the durable write path, the staleness rule
  and the cost-per-summary decision. See "What changed" above.
- A `source` discriminator on `HistoryResult.events`.
- Widening `search_history` to cover chats.
- Attachment content in results.
- Any ranking or relevance scoring. `searchChats` returns matches in thread order, threads in
  `updatedAt` order.
- Cross-project search. The registry is keyed by `projectId` and reads one key.
- Making chat search work in file mode. Threads are Turso-only by construction; `coverage`
  exists to say so honestly.
