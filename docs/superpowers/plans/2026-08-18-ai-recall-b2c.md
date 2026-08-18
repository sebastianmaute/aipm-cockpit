# AI Recall B2c Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The assistant can search this project's past chat threads, and is told unprompted that they exist.

**Architecture:** A pure engine (`chat-search.ts`) filters threads already held in memory. A single-slot module registry carries them from `use-chat-threads.ts` (below the dispatcher in the tree) up to `use-chat-dispatcher.ts`'s `getSnapshot`/`runTool`. A new `search_chats` tool returns matched messages verbatim; an ambient pointer names recent thread titles in the prompt's volatile suffix. One default-ON setting gates both.

**Tech stack:** TypeScript, React 19, Next 16, vitest, Turso (libSQL).

**Spec:** `docs/superpowers/specs/2026-08-18-ai-recall-b2c-design.md`

---

## Prerequisites

Branch `feat/ai-recall-b2c` exists off `origin/main` (`6c9ee098`) carrying the spec commit. Work in a worktree:

```bash
git worktree add .worktrees/feat-ai-recall-b2c feat/ai-recall-b2c
cd .worktrees/feat-ai-recall-b2c
npm install
```

---

## File Structure

**New files** (all unbaselined, 800-line cap, plenty of room):

| File | Responsibility |
|---|---|
| `src/app/resolve-limit.ts` | The shared model-supplied-limit coercion, lifted out of `history-search.ts` |
| `src/app/chat-search.ts` | Pure engine: `searchChats` + `summarizeChatThreads`. i18n-free, clock-free, DOM-free |
| `src/app/chat-threads-registry.ts` | Single-slot transport from the chat panel to the dispatcher |
| `src/app/chat-recap.ts` | `buildChatPointerBlock` — the prompt sentence |
| `src/app/chat-search-tool.ts` | The `search_chats` executor body, kept out of `chat-tools.ts` |

**Modified files** — the size gate is the binding constraint. Headroom measured 2026-08-18:

| File | Headroom | Change |
|---|---|---|
| `src/app/history-search.ts` | 554 | Import `resolveLimit`, delete the private copy |
| `src/app/use-chat-threads.ts` | 337 | One publish effect |
| `src/app/settings-types.ts` | 58 | `chatSearch` field, `chatSearchEnabled`, sanitize line |
| `src/app/chat-api.ts` | 417 | Variant memo, pointer block, `AiConfig` threading |
| `src/app/chat-tool-defs.ts` | 105 | The `search_chats` schema |
| `src/app/chat-tools.ts` | 34 | Two interface methods, one snapshot field, a 3-line executor case |
| `src/app/use-chat-dispatcher.ts` | **2** | Two bindings — nothing else |
| `src/app/settings-sections/ai-section.tsx` | 255 | One toggle row |
| `src/app/i18n.ts` / `i18n.de.ts` | n/a | Two keys each |

**Untouched, and this is load-bearing:** `task-manager.tsx` (3020/3020), `workspace-section.tsx` (1000/1000), `chat-panel.tsx` (996/996) all sit at **zero** headroom. If a step seems to need a line in any of them, stop — the design is wrong, not the budget.

---

### Task 1: Extract the shared limit resolver

`chat-search.ts` must not re-derive `resolveLimit`. It carries a trap — the floor runs *before* the non-positive test, so a model-supplied `0.5` cannot produce `{ hits: [], truncated: true }`, the one output that claims rows were withheld while returning none.

**Files:**
- Create: `src/app/resolve-limit.ts`
- Create: `src/app/resolve-limit.test.ts`
- Modify: `src/app/history-search.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/resolve-limit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveLimit } from "./resolve-limit";

describe("resolveLimit", () => {
  it("returns the fallback for absent, non-numeric and non-finite input", () => {
    expect(resolveLimit(undefined, 50, 200)).toBe(50);
    expect(resolveLimit(Number.NaN, 50, 200)).toBe(50);
    expect(resolveLimit(Number.POSITIVE_INFINITY, 50, 200)).toBe(50);
  });

  it("floors a fractional limit", () => {
    expect(resolveLimit(2.9, 50, 200)).toBe(2);
  });

  it("returns the fallback when the floor lands on zero", () => {
    // The trap: testing `raw <= 0` BEFORE flooring lets 0.5 through as a cap of
    // zero, which yields no rows while asserting rows were withheld.
    expect(resolveLimit(0.5, 50, 200)).toBe(50);
  });

  it("returns the fallback for zero and negatives", () => {
    expect(resolveLimit(0, 50, 200)).toBe(50);
    expect(resolveLimit(-1, 50, 200)).toBe(50);
  });

  it("clamps down to the maximum", () => {
    expect(resolveLimit(5000, 50, 200)).toBe(200);
  });

  it("honours per-caller bounds", () => {
    expect(resolveLimit(undefined, 20, 50)).toBe(20);
    expect(resolveLimit(5000, 20, 50)).toBe(50);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/resolve-limit.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: FAIL — `Failed to resolve import "./resolve-limit"`.

- [ ] **Step 3: Create the module**

Create `src/app/resolve-limit.ts`:

```ts
/**
 * Coerce a model-supplied result cap.
 *
 * Absent / non-numeric / non-finite → `fallback`; anything above `max` is
 * clamped down to it. Fractional limits FLOOR, so `2.9` caps at 2.
 *
 * ★★★ THE FLOOR HAPPENS BEFORE THE NON-POSITIVE TEST, NOT AFTER, and the order
 * is the whole point. `raw` is model-supplied untrusted input, so `0.5` is
 * reachable — and testing `raw <= 0` first lets it through, after which the
 * floor yields a cap of ZERO. The result is an empty page that still reports
 * `truncated: true`: no rows, while asserting that rows were withheld. That is
 * the one output combination that actively misleads the caller, since
 * `truncated` is the field the model reads to decide whether it may claim a
 * complete answer.
 *
 * ★ Falling back to `fallback` rather than clamping up to 1: a limit that
 * floors to nothing is a nonsense request, and every other nonsense value here
 * (absent, NaN, -1, 0) already answers with the fallback. Returning a
 * single-item page instead would make `0.5` the only input whose garbage-ness
 * is silently reinterpreted as a real, very specific instruction.
 *
 * ★ `Infinity` therefore yields `fallback`, not `max` — it fails the finite
 * test before it can reach the clamp. Defensible (it is not a number the caller
 * meant) and pinned by a test so it cannot change silently.
 */
export function resolveLimit(
  raw: number | undefined,
  fallback: number,
  max: number,
): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  const whole = Math.floor(raw);
  if (whole <= 0) return fallback;
  return Math.min(whole, max);
}
```

- [ ] **Step 4: Run the test — it should pass**

```bash
npx vitest run src/app/resolve-limit.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Point `history-search.ts` at it**

In `src/app/history-search.ts`, delete the whole private `resolveLimit` function together with its docblock, and add to the imports:

```ts
import { resolveLimit } from "./resolve-limit";
```

Change its one call site inside `searchHistory` from:

```ts
  const limit = resolveLimit(q.limit);
```

to:

```ts
  const limit = resolveLimit(q.limit, DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT);
```

- [ ] **Step 6: Prove the existing suite still passes**

```bash
npx vitest run src/app/history-search.test.ts --reporter=dot; echo "EXIT=$?"
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: both PASS. If `tsc` reports errors in files you did not touch, delete `tsconfig.tsbuildinfo` and re-run — stale incremental state from another worktree produces confident phantom errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/resolve-limit.ts src/app/resolve-limit.test.ts src/app/history-search.ts
git commit -m "refactor(history): lift resolveLimit into its own module

chat-search will need the same coercion, and the floor-before-non-positive
ordering is a trap a second hand-written copy would re-introduce."
```

---

### Task 2: The search engine

**Files:**
- Create: `src/app/chat-search.ts`
- Create: `src/app/chat-search.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/chat-search.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { searchChats } from "./chat-search";
import type { ChatThread } from "./chat-threads";

const UTC = "UTC";

function thread(over: Partial<ChatThread> & { id: string }): ChatThread {
  return {
    id: over.id,
    projectId: "default",
    title: over.title ?? "",
    createdAt: over.createdAt ?? "2026-08-01T00:00:00.000Z",
    updatedAt: over.updatedAt ?? "2026-08-01T00:00:00.000Z",
    history: over.history ?? [],
    display: over.display ?? [],
  };
}

describe("searchChats", () => {
  it("reports coverage 'unavailable' with no hits when threads are unreachable", () => {
    const res = searchChats([thread({ id: "t1" })], null, {}, UTC, false);
    expect(res.coverage).toBe("unavailable");
    expect(res.hits).toEqual([]);
    expect(res.truncated).toBe(false);
  });

  it("reports coverage 'turso' when reachable but empty", () => {
    // ★★ SEPARATE from the assertion above on purpose. Both produce zero hits,
    //    and collapsing them into one "empty result" test is exactly the defect
    //    this pair exists to prevent: file mode would then be reported to the
    //    model as "searched, found nothing".
    const res = searchChats([], null, {}, UTC, true);
    expect(res.coverage).toBe("turso");
    expect(res.hits).toEqual([]);
  });

  it("skips the active thread", () => {
    const threads = [
      thread({ id: "active", display: [{ kind: "user", text: "vendor choice" }] }),
      thread({ id: "other", display: [{ kind: "user", text: "vendor choice" }] }),
    ];
    const res = searchChats(threads, "active", {}, UTC, true);
    expect(res.hits.map((h) => h.threadId)).toEqual(["other"]);
  });

  it("returns only user and assistant messages", () => {
    const threads = [
      thread({
        id: "t1",
        display: [
          { kind: "user", text: "hello" },
          { kind: "notice", text: "a notice" },
          { kind: "tool", name: "list_tasks", input: {}, result: "[]" },
          { kind: "assistant", text: "hi" },
        ],
      }),
    ];
    const res = searchChats(threads, null, {}, UTC, true);
    expect(res.hits[0].messages).toEqual([
      { role: "user", text: "hello" },
      { role: "assistant", text: "hi" },
    ]);
  });

  it("matches the query case-insensitively against message text", () => {
    const threads = [
      thread({ id: "t1", display: [{ kind: "user", text: "The VENDOR call" }] }),
      thread({ id: "t2", display: [{ kind: "user", text: "budget review" }] }),
    ];
    const res = searchChats(threads, null, { query: "vendor" }, UTC, true);
    expect(res.hits.map((h) => h.threadId)).toEqual(["t1"]);
  });

  it("applies since and until inclusively, in the project zone", () => {
    const threads = [
      thread({ id: "early", updatedAt: "2026-08-01T12:00:00.000Z", display: [{ kind: "user", text: "a" }] }),
      thread({ id: "mid", updatedAt: "2026-08-05T12:00:00.000Z", display: [{ kind: "user", text: "a" }] }),
      thread({ id: "late", updatedAt: "2026-08-09T12:00:00.000Z", display: [{ kind: "user", text: "a" }] }),
    ];
    const res = searchChats(threads, null, { since: "2026-08-05", until: "2026-08-09" }, UTC, true);
    expect(res.hits.map((h) => h.threadId).sort()).toEqual(["late", "mid"]);
  });

  it("excludes a thread whose updatedAt has no parseable day when a bound is set", () => {
    const threads = [
      thread({ id: "bad", updatedAt: "whenever", display: [{ kind: "user", text: "a" }] }),
    ];
    // A raw string compare would admit "whenever" to any since-range, because it
    // sorts above every "2026-…" date.
    expect(searchChats(threads, null, { since: "2026-01-01" }, UTC, true).hits).toEqual([]);
    // With no bound asked for, no day is computed and the thread is returned.
    expect(searchChats(threads, null, {}, UTC, true).hits).toHaveLength(1);
  });

  it("orders threads newest first by updatedAt", () => {
    const threads = [
      thread({ id: "old", updatedAt: "2026-08-01T00:00:00.000Z", display: [{ kind: "user", text: "a" }] }),
      thread({ id: "new", updatedAt: "2026-08-09T00:00:00.000Z", display: [{ kind: "user", text: "a" }] }),
    ];
    expect(searchChats(threads, null, {}, UTC, true).hits.map((h) => h.threadId))
      .toEqual(["new", "old"]);
  });

  it("reports truncated false when the cap cut nothing", () => {
    const threads = [thread({ id: "t1", display: [{ kind: "user", text: "a" }] })];
    const res = searchChats(threads, null, { limit: 10 }, UTC, true);
    expect(res.truncated).toBe(false);
    expect(res.hits[0].moreMessages).toBe(0);
  });

  it("caps MESSAGES across threads and counts the withheld ones", () => {
    const threads = [
      thread({
        id: "new",
        updatedAt: "2026-08-09T00:00:00.000Z",
        display: [
          { kind: "user", text: "a1" },
          { kind: "user", text: "a2" },
          { kind: "user", text: "a3" },
        ],
      }),
      thread({
        id: "old",
        updatedAt: "2026-08-01T00:00:00.000Z",
        display: [{ kind: "user", text: "b1" }],
      }),
    ];
    const res = searchChats(threads, null, { limit: 2 }, UTC, true);
    expect(res.truncated).toBe(true);
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0].threadId).toBe("new");
    expect(res.hits[0].messages).toHaveLength(2);
    expect(res.hits[0].moreMessages).toBe(1);
  });

  it("falls back to the default limit for a fractional cap that floors to zero", () => {
    const threads = [thread({ id: "t1", display: [{ kind: "user", text: "a" }] })];
    const res = searchChats(threads, null, { limit: 0.5 }, UTC, true);
    expect(res.hits).toHaveLength(1);
    expect(res.truncated).toBe(false);
  });

  it("derives the title from the first user message", () => {
    const threads = [
      thread({ id: "t1", display: [{ kind: "assistant", text: "hi" }, { kind: "user", text: "vendor choice" }] }),
    ];
    expect(searchChats(threads, null, {}, UTC, true).hits[0].title).toBe("vendor choice");
  });

  it("rewrites updatedAt into the project zone", () => {
    const threads = [
      thread({ id: "t1", updatedAt: "2026-08-05T12:00:00.000Z", display: [{ kind: "user", text: "a" }] }),
    ];
    const res = searchChats(threads, null, {}, "Europe/Berlin", true);
    expect(res.hits[0].updatedAt).toContain("+02:00");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/chat-search.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: FAIL — `Failed to resolve import "./chat-search"`.

- [ ] **Step 3: Write the engine**

Create `src/app/chat-search.ts`:

```ts
// Pure search over the project's stored chat threads.
//
// ★ i18n-free, clock-free and DOM-free by contract, exactly like
//   `history-search.ts`: `tz` is a parameter, no `Date.now()` is read, and
//   nothing here touches a document.
//
// ★★ Threads are Turso-only by construction, so `available` is a REQUIRED
//   argument rather than something inferred from `threads.length`. "Turso with
//   no chats yet" and "file mode, cannot look" both arrive as an empty array,
//   and collapsing them makes the model tell every file-mode user it searched
//   their past conversations and found nothing.
import { deriveThreadName, type ChatThread } from "./chat-threads";
import { resolveLimit } from "./resolve-limit";
import { isoInZone, makeDayInZone } from "./timezone";

export const DEFAULT_CHAT_LIMIT = 20;
export const MAX_CHAT_LIMIT = 50;

export interface ChatQuery {
  query?: string;
  /** Inclusive lower bound, `YYYY-MM-DD`, resolved in the project zone. */
  since?: string;
  /** Inclusive upper bound, `YYYY-MM-DD`, resolved in the project zone. */
  until?: string;
  /** Caps MESSAGES, not threads — see `searchChats`. */
  limit?: number;
}

export interface ChatHitMessage {
  role: "user" | "assistant";
  text: string;
}

export interface ChatHit {
  threadId: string;
  /** `threadTitle` — the user's own thread name when set, else the derived one
   *  (and "" when the thread holds no user message yet either). */
  title: string;
  /** Rewritten into the project zone's offset-bearing form. */
  updatedAt: string;
  messages: readonly ChatHitMessage[];
  /** Matched in this thread but withheld by the cap. */
  moreMessages: number;
}

export type ChatCoverage = "turso" | "unavailable";

export interface ChatSearchResult {
  hits: ChatHit[];
  /**
   * ★★ "More matched than you are seeing" — NOT "a cap was applied". Same
   * contract as `HistoryResult.truncated`: a cap that happened to cut nothing
   * reports false, because the model reads this field to decide whether it may
   * claim a complete answer.
   */
  truncated: boolean;
  coverage: ChatCoverage;
}

/** A thread's display title: the user's own name when they have set one, else
 *  the name derived from the first user message. `ChatThread.name` is "" until
 *  the first save AND is user-editable via `renameThread` — deriving
 *  unconditionally would cite a renamed thread under a title that appears
 *  nowhere in the sidebar. */
export function threadTitle(th: ChatThread): string {
  return th.name.trim() || deriveThreadName(th.display);
}

/**
 * Search stored threads, newest first.
 *
 * ★★ The cap counts MESSAGES, not threads. A thread cap would let one chatty
 *    thread hide every other match; there is no thread cap at all, so every
 *    thread holding a match is eligible and the message budget is what runs out.
 *
 * ★★ The active thread is skipped — it is already verbatim in the request, so
 *    returning it spends context restating what the model can see.
 *
 * ★ `display` is searched rather than `history`: both are persisted, but
 *   `history` carries raw tool-use blocks the model does not need to re-read.
 */
export function searchChats(
  threads: readonly ChatThread[],
  activeThreadId: string | null,
  q: ChatQuery,
  tz: string,
  available: boolean,
): ChatSearchResult {
  if (!available) return { hits: [], truncated: false, coverage: "unavailable" };

  const needle = q.query?.trim().toLowerCase();
  const bounded = !!(q.since || q.until);
  // ★ Built ONCE and only when a bound was asked for — a per-thread `dayInZone`
  //   rebuilds its Intl formatter every call, which is what made a bounded
  //   activity scan cost 160 ms where the hoisted form costs ~2 ms.
  const dayOf = bounded ? makeDayInZone(tz) : null;

  // ★★★ Sort on the RAW UTC stamp, before any zone rewrite. Lexicographic
  //   compare only tracks real time while every string shares one offset, and a
  //   DST transition breaks exactly that: Berlin renders 00:30Z as
  //   `02:30:00+02:00` and the LATER 01:30Z as `02:30:00+01:00`, which sorts the
  //   older one first.
  const ordered = threads
    .filter((th) => th.id !== activeThreadId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));

  const hits: ChatHit[] = [];
  let budget = resolveLimit(q.limit, DEFAULT_CHAT_LIMIT, MAX_CHAT_LIMIT);
  let truncated = false;

  for (const th of ordered) {
    if (dayOf) {
      // ★★ A thread whose stamp has NO parseable day cannot satisfy a bound and
      //   is dropped rather than compared as a raw string: "whenever" sorts
      //   above every "2026-…" date, so a string compare admits it to any range.
      const day = dayOf(th.updatedAt);
      if (day === null) continue;
      if (q.since && day < q.since) continue;
      if (q.until && day > q.until) continue;
    }

    const matched: ChatHitMessage[] = [];
    for (const item of th.display) {
      if (item.kind !== "user" && item.kind !== "assistant") continue;
      if (needle && !item.text.toLowerCase().includes(needle)) continue;
      matched.push({ role: item.kind, text: item.text });
    }
    if (matched.length === 0) continue;

    const take = Math.min(budget, matched.length);
    if (take < matched.length) truncated = true;
    // ★ Budget exhausted: this thread matched but nothing of it fits, and the
    //   line above has already set `truncated`. `budget` only ever decreases,
    //   so no later thread could contribute a message either — stop.
    if (take === 0) break;
    budget -= take;

    hits.push({
      threadId: th.id,
      title: threadTitle(th),
      updatedAt: isoInZone(th.updatedAt, tz),
      messages: matched.slice(0, take),
      moreMessages: matched.length - take,
    });
  }

  return { hits, truncated, coverage: "turso" };
}
```

- [ ] **Step 4: Run the test — it should pass**

```bash
npx vitest run src/app/chat-search.test.ts --reporter=dot; echo "EXIT=$?"
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: PASS, 13 tests, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/chat-search.ts src/app/chat-search.test.ts
git commit -m "feat(chat-search): pure engine over stored threads

Caps messages rather than threads, skips the active thread, and takes
availability as an argument so file mode cannot be reported as an empty search."
```

---

### Task 3: The transport registry

**Files:**
- Create: `src/app/chat-threads-registry.ts`
- Create: `src/app/chat-threads-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/chat-threads-registry.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import {
  clearChatThreads,
  publishChatThreads,
  readChatThreads,
} from "./chat-threads-registry";
import type { ChatThread } from "./chat-threads";

const T: ChatThread = {
  id: "t1",
  projectId: "p1",
  name: "",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  history: [],
  display: [],
};

afterEach(() => {
  clearChatThreads();
});

describe("chat threads registry", () => {
  it("returns an unavailable empty value before anything is published", () => {
    expect(readChatThreads("p1")).toEqual({
      threads: [],
      activeThreadId: null,
      available: false,
    });
  });

  it("round-trips a published value for its own project", () => {
    publishChatThreads("p1", { threads: [T], activeThreadId: "t1", available: true });
    expect(readChatThreads("p1")).toEqual({
      threads: [T],
      activeThreadId: "t1",
      available: true,
    });
  });

  it("does not hand one project's threads to another", () => {
    // ★ The single slot is what makes this true by construction: publishing for
    //   a new project REPLACES the slot, so a stale project can never be read.
    publishChatThreads("p1", { threads: [T], activeThreadId: "t1", available: true });
    expect(readChatThreads("p2").available).toBe(false);
    expect(readChatThreads("p2").threads).toEqual([]);
  });

  it("replaces the slot rather than accumulating projects", () => {
    publishChatThreads("p1", { threads: [T], activeThreadId: "t1", available: true });
    publishChatThreads("p2", { threads: [], activeThreadId: null, available: true });
    expect(readChatThreads("p1").available).toBe(false);
    expect(readChatThreads("p2").available).toBe(true);
  });

  it("clears", () => {
    publishChatThreads("p1", { threads: [T], activeThreadId: "t1", available: true });
    clearChatThreads();
    expect(readChatThreads("p1").available).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/chat-threads-registry.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the registry**

Create `src/app/chat-threads-registry.ts`:

```ts
// Carries the chat panel's live thread list up to the AI dispatcher.
//
// ★★★ WHY A MODULE STORE AND NOT PROPS. `useChatThreads` is called in
//   `chat-panel.tsx`; `useChatDispatcher` is called in `task-manager.tsx`, which
//   RENDERS the chain that reaches the panel. Threads therefore sit BELOW the
//   point where the AI snapshot is assembled, and every file in that chain
//   (`task-manager.tsx`, `workspace-section.tsx`, `chat-panel.tsx`) sits at
//   EXACTLY its size baseline, so threading a ref down costs lines on three
//   files that have none. Precedent: `project-appearance-prefs.ts`, which the
//   dispatcher already reads through `useViewDigest`.
//
// ★★ NO `useSyncExternalStore`, no listener set, no snapshot cache, no equality
//   function — the precedent needs all four because components RENDER from it.
//   Nothing renders from chat search: `getSnapshot()` reads at send time. Adding
//   reactivity here would be machinery with no consumer.
//
// ★★ ONE SLOT, not a Map keyed by project. Publishing for a new project replaces
//   the slot outright, so a stale project's threads can never be read back and
//   there is nothing to evict. A Map would leak the previous project's entry on
//   every switch.
import type { ChatThread } from "./chat-threads";

export interface PublishedThreads {
  threads: readonly ChatThread[];
  activeThreadId: string | null;
  /**
   * ★★★ Turso reachability, NOT `threads.length > 0`. The two are different
   * questions and the engine's `coverage` field depends on the distinction.
   */
  available: boolean;
}

const EMPTY: PublishedThreads = { threads: [], activeThreadId: null, available: false };

let slot: { projectId: string; value: PublishedThreads } | null = null;

export function publishChatThreads(projectId: string, value: PublishedThreads): void {
  slot = { projectId, value };
}

/** The live threads for `projectId`, or an unavailable empty value. */
export function readChatThreads(projectId: string): PublishedThreads {
  return slot !== null && slot.projectId === projectId ? slot.value : EMPTY;
}

/**
 * Drop the slot.
 *
 * ★ Module state survives `vi.clearAllMocks()` and RTL cleanup, so every test
 *   touching this must call it in an `afterEach` or it leaks into whatever file
 *   the shuffled run schedules next.
 */
export function clearChatThreads(): void {
  slot = null;
}
```

- [ ] **Step 4: Run the test — it should pass**

```bash
npx vitest run src/app/chat-threads-registry.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/chat-threads-registry.ts src/app/chat-threads-registry.test.ts
git commit -m "feat(chat): single-slot registry carrying threads to the dispatcher

Threads live below the snapshot assembly point and all three files in the prop
chain sit at their size baseline, so the transport is a module store."
```

---

### Task 4: Publish from the threads hook

The publish lives in `use-chat-threads.ts`, not `chat-panel.tsx`: the hook already owns every input, and it has 337 lines of headroom against `chat-panel.tsx`'s zero.

**Files:**
- Modify: `src/app/use-chat-threads.ts`
- Modify: `src/app/use-chat-threads.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/use-chat-threads.test.tsx` (inside the existing top-level `describe`, and add the imports at the top of the file):

```ts
import { clearChatThreads, readChatThreads } from "./chat-threads-registry";
```

```ts
  describe("registry publication", () => {
    afterEach(() => {
      clearChatThreads();
    });

    it("publishes availability false in file mode", () => {
      renderHook(() => useChatThreads(makeDeps({ tursoMode: false, projectId: "p1" })));
      expect(readChatThreads("p1")).toEqual({
        threads: [],
        activeThreadId: null,
        available: false,
      });
    });

    it("publishes availability true in Turso mode", async () => {
      renderHook(() => useChatThreads(makeDeps({ tursoMode: true, projectId: "p1" })));
      await waitFor(() => expect(readChatThreads("p1").available).toBe(true));
    });

    it("clears availability when tursoMode goes false", async () => {
      // ★★★ THE LANDMINE. `panel-chat` is one of only two tabpanels
      //   `workspace-section` mounts unconditionally, so this hook NEVER
      //   remounts on navigation and nothing will reset it for you. A
      //   Turso→file switch has to be published explicitly or `coverage` starts
      //   lying to the model.
      const { rerender } = renderHook(
        ({ turso }: { turso: boolean }) =>
          useChatThreads(makeDeps({ tursoMode: turso, projectId: "p1" })),
        { initialProps: { turso: true } },
      );
      await waitFor(() => expect(readChatThreads("p1").available).toBe(true));
      rerender({ turso: false });
      await waitFor(() => expect(readChatThreads("p1").available).toBe(false));
      expect(readChatThreads("p1").threads).toEqual([]);
    });
  });
```

Read the existing test file first and reuse its own deps factory and Turso mocks — if it has no `makeDeps` helper, build one from the `UseChatThreadsDeps` shape:

```ts
tursoMode, tursoConfig, projectId, lang, busy, history, display,
setHistory, setDisplay, cancelledRef, abortRef, confirm
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/use-chat-threads.test.tsx --reporter=dot; echo "EXIT=$?"
```

Expected: FAIL — the three new tests, `available` never becoming what is asserted.

- [ ] **Step 3: Add the publish effect**

In `src/app/use-chat-threads.ts`, add the import:

```ts
import { publishChatThreads } from "./chat-threads-registry";
```

and add this effect after the existing `threadsRef` sync effect:

```ts
  // Publish to the module registry the AI dispatcher reads. See
  // `chat-threads-registry.ts` for why this is not a prop.
  //
  // ★★★ `tursoMode` GATES THE PAYLOAD, not just the flag. This hook never
  //   unmounts on navigation — `panel-chat` is one of the two tabpanels
  //   `workspace-section` mounts unconditionally — so a Turso→file switch has no
  //   remount to clear stale threads, and publishing them with `available:false`
  //   beside them would leave real conversation text readable by a path that has
  //   just been told it cannot reach any.
  useEffect(() => {
    publishChatThreads(projectId, {
      threads: tursoMode ? threads : [],
      activeThreadId: tursoMode ? activeThreadId : null,
      available: tursoMode,
    });
  }, [projectId, threads, activeThreadId, tursoMode]);
```

- [ ] **Step 4: Run the test — it should pass**

```bash
npx vitest run src/app/use-chat-threads.test.tsx --reporter=dot; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/use-chat-threads.ts; echo "EXIT=$?"
```

Expected: both PASS. eslint matters here — `react-hooks/exhaustive-deps` rejects an `obj.member` dependency, and all four names above are already destructured locals in this hook, so the array is valid as written.

- [ ] **Step 5: Check the size gate**

```bash
node -e "console.log(require('fs').readFileSync('src/app/use-chat-threads.ts','utf8').split('\n').length)"
```

Expected: well under 800 (was 463).

- [ ] **Step 6: Commit**

```bash
git add src/app/use-chat-threads.ts src/app/use-chat-threads.test.tsx
git commit -m "feat(chat): publish live threads to the registry

Gated on tursoMode so a Turso to file switch clears the payload explicitly —
this hook never remounts, so nothing else will."
```

---

### Task 5: The setting

**Files:**
- Modify: `src/app/settings-types.ts`
- Modify: `src/app/settings-types.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/settings-types.test.ts`:

```ts
describe("chatSearch", () => {
  it("is enabled by absence and by true", () => {
    expect(chatSearchEnabled(undefined)).toBe(true);
    expect(chatSearchEnabled(true)).toBe(true);
  });

  it("is disabled only by an explicit false", () => {
    expect(chatSearchEnabled(false)).toBe(false);
  });

  it("ROUND-TRIPS an explicit false through sanitizeAiConfig", () => {
    // ★★★ THE ONLY LOAD-BEARING ASSERTION. A dropped key and a default read
    //   IDENTICALLY — both are `undefined`, both mean ON — so "absent implies
    //   enabled" is green against a sanitizer that omits the field entirely.
    //   That is exactly how `actionSuggestions` went unpinned for its whole life
    //   while every reload silently reverted the user's `false` (§165).
    const out = sanitizeAiConfig({ ...BASE_AI, chatSearch: false });
    expect(out.chatSearch).toBe(false);
  });

  it("normalises a non-false stored value to undefined", () => {
    expect(sanitizeAiConfig({ ...BASE_AI, chatSearch: "yes" }).chatSearch).toBeUndefined();
  });
});
```

Reuse whatever base-config fixture the file already has in place of `BASE_AI`, and add `chatSearchEnabled` to the file's existing import from `./settings-types`.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/settings-types.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: FAIL — `chatSearchEnabled` is not exported.

- [ ] **Step 3: Add the field, the predicate and the sanitize line**

In `src/app/settings-types.ts`, add to `AiConfig` immediately after `activityRecap`:

```ts
  chatSearch?: boolean; // The search_chats tool + the ambient chat pointer. Default ON (undefined = on).
```

Add beside `historySearchEnabled`:

```ts
/** Is `search_chats` live? (`settings.ai.chatSearch !== false`.)
 *
 *  ★★★ ONE definition, read by BOTH the advertisement gate (`toolsFor` /
 *  `toolNamesFor`) and the EXECUTOR gate (`runTool`'s `case "search_chats"`).
 *  Two hand-spelled `=== false` checks are a config slip away from a switch that
 *  advertises off and serves on — the state §162 recorded, in the direction
 *  where only the advertisement existed. */
export function chatSearchEnabled(chatSearch: boolean | undefined): boolean {
  return chatSearch !== false;
}
```

Add to `sanitizeAiConfig`'s return literal, beside its siblings:

```ts
    chatSearch: obj.chatSearch === false ? false : undefined,
```

- [ ] **Step 4: Run the test — it should pass**

```bash
npx vitest run src/app/settings-types.test.ts --reporter=dot; echo "EXIT=$?"
node -e "console.log(require('fs').readFileSync('src/app/settings-types.ts','utf8').split('\n').length)"
```

Expected: PASS; line count under 800 (was 742, headroom 58 — if the additions push past it, condense the comment rather than re-baselining).

- [ ] **Step 5: Commit**

```bash
git add src/app/settings-types.ts src/app/settings-types.test.ts
git commit -m "feat(settings): add the chatSearch toggle, default ON

Round-trip pinned: a dropped key and a default read identically, so only a
write-false-read-false assertion can catch the sanitizeAiConfig omission."
```

---

### Task 6: Tool-list variants

`chat-api.ts` holds two frozen module-level variants today, and a comment stating the rule. A second independent toggle makes four combinations. Replace the pair with a memo keyed by the combination — that keeps the invariant the comment defends (one array identity per settings combination) which the two-constant spelling cannot survive.

Passing the two flags as adjacent `boolean | undefined` parameters would rebuild the §159 transposition hazard, so the flags travel as the `AiConfig` slice and are read by name.

**Files:**
- Modify: `src/app/chat-api.ts`
- Modify: `src/app/chat-api.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/chat-api.test.ts`:

```ts
describe("tool variants", () => {
  const ALL = {};
  const NO_HISTORY = { historySearch: false };
  const NO_CHAT = { chatSearch: false };
  const NEITHER = { historySearch: false, chatSearch: false };

  it("offers search_history by default and drops it when disabled", () => {
    expect(toolNamesFor(ALL).has("search_history")).toBe(true);
    expect(toolNamesFor(NO_HISTORY).has("search_history")).toBe(false);
  });

  it("leaves search_history alone when only the chat flag is off", () => {
    expect(toolNamesFor(NO_CHAT).has("search_history")).toBe(true);
    expect(toolNamesFor(NEITHER).has("search_history")).toBe(false);
  });

  it("returns ONE array identity per settings combination", () => {
    // ★ The property the two frozen constants used to provide. The list ships on
    //   every request, so a fresh array per call would destroy referential
    //   stability for a value that is constant for the whole conversation.
    expect(toolsFor(ALL)).toBe(toolsFor({}));
    expect(toolsFor({ historySearch: true })).toBe(toolsFor(ALL));
    expect(toolsFor(NO_HISTORY)).toBe(toolsFor({ historySearch: false }));
    expect(toolsFor(NO_HISTORY)).not.toBe(toolsFor(ALL));
  });

  it("recomputes the cache breakpoint per variant", () => {
    // A lost breakpoint is invisible except as a bill.
    for (const flags of [ALL, NO_HISTORY, NO_CHAT, NEITHER]) {
      const defs = toolsFor(flags);
      expect(defs.filter((d) => "cache_control" in d)).toHaveLength(1);
      expect(defs[defs.length - 1]).toHaveProperty("cache_control");
    }
  });
});
```

Add `toolsFor` and `toolNamesFor` to the file's existing import from `./chat-api`. If the breakpoint assertion does not match how `withCacheBreakpoint` marks a def, read that function and assert its real shape — the point is that exactly one def in each variant carries the marker and it is the last one.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/chat-api.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: FAIL — `toolNamesFor` still takes a boolean, so every call in the new block is a type error and the assertions never run.

These tests deliberately assert nothing about `search_chats`: the tool does not exist until Task 7, and a committed-but-failing test breaks `git bisect` for everyone who lands between the two commits. Task 7 adds the `search_chats` assertions once there is something to assert.

- [ ] **Step 3: Replace the two constants with a memo**

In `src/app/chat-api.ts`, add the type import:

```ts
import { chatSearchEnabled, historySearchEnabled, type AiConfig } from "./settings-types";
```

(keep whatever that import already pulls in; `AiConfig` is type-only, so it cannot close a runtime cycle.)

Replace `CACHED_TOOLS_NO_HISTORY`, `toolsFor`, `TOOL_NAMES`, `TOOL_NAMES_NO_HISTORY` and `toolNamesFor` with:

```ts
export const CACHED_TOOLS = withCacheBreakpoint(TOOL_DEFS);

/** The flags that select a tool-list variant.
 *
 *  ★★★ ONE OBJECT, NOT TWO ADJACENT BOOLEANS. Both flags are
 *  `boolean | undefined`, so a positional pair typechecks when transposed —
 *  the §159 shape, where two adjacent same-typed strings silently swapped and
 *  passed 337 tests plus tsc. Reading them by name off the config removes the
 *  hazard rather than guarding it. */
export type ToolFlags = Pick<AiConfig, "historySearch" | "chatSearch">;

/** Tool names removed by each bit of the variant key. */
const DISABLED_BY_BIT: ReadonlyArray<readonly [number, string]> = [
  [1, "search_history"],
  [2, "search_chats"],
];

function variantKey(flags: ToolFlags): number {
  return (
    (historySearchEnabled(flags.historySearch) ? 0 : 1) |
    (chatSearchEnabled(flags.chatSearch) ? 0 : 2)
  );
}

// ★★ A MEMO, not four frozen constants. The rule the old pair encoded was ONE
//   ARRAY IDENTITY PER SETTINGS COMBINATION — stable for a whole conversation,
//   because the list ships on every request. Two toggles make four combinations
//   and a third would make eight, so the invariant outlives its old spelling.
const TOOL_VARIANTS = new Map<number, ReturnType<typeof withCacheBreakpoint>>([[0, CACHED_TOOLS]]);
const NAME_VARIANTS = new Map<number, ReadonlySet<string>>();

function variantFor(key: number) {
  const cached = TOOL_VARIANTS.get(key);
  if (cached) return cached;
  const removed = new Set(
    DISABLED_BY_BIT.filter(([bit]) => (key & bit) !== 0).map(([, name]) => name),
  );
  // ★ The breakpoint is RECOMPUTED per variant, never assumed to sit where it
  //   sits in the full list — removing a tool that happens to precede it does
  //   not move it TODAY, but a tool appended after it later would make that
  //   assumption silently wrong, and a lost breakpoint is invisible except as a
  //   bill.
  const built = withCacheBreakpoint(TOOL_DEFS.filter((d) => !removed.has(d.name)));
  TOOL_VARIANTS.set(key, built);
  return built;
}

/** The tool list for this user's settings. */
export function toolsFor(flags: ToolFlags) {
  return variantFor(variantKey(flags));
}

/** The names of the tools this request will actually carry.
 *
 *  ★★ DERIVED FROM THE ARRAYS `toolsFor` RETURNS, never listed by hand. These
 *  feed the prompt surfaces that ADVERTISE tools, so "what the model is told it
 *  has" and "what the request carries" come from ONE place and cannot disagree. */
export function toolNamesFor(flags: ToolFlags): ReadonlySet<string> {
  const key = variantKey(flags);
  const cached = NAME_VARIANTS.get(key);
  if (cached) return cached;
  const built: ReadonlySet<string> = new Set(variantFor(key).map((d) => d.name));
  NAME_VARIANTS.set(key, built);
  return built;
}
```

- [ ] **Step 4: Thread the flags through the two call sites**

Change `buildSystemPrompt`'s parameter from `historySearch: boolean | undefined` to:

```ts
  /** `settings.ai`'s tool flags — the SAME value `callClaude` is given, so the
   *  prompt advertises exactly the tools the request carries. */
  toolFlags: ToolFlags,
```

and its body line to:

```ts
  const offeredTools = toolNamesFor(toolFlags);
```

Do the same for `callClaude`: replace its `historySearch` parameter with `toolFlags: ToolFlags` and its body's `tools: toolsFor(historySearch)` with `tools: toolsFor(toolFlags)`.

- [ ] **Step 5: Update every caller**

```bash
npx tsc --noEmit 2>&1 | head -40; echo "TSC_EXIT=${PIPESTATUS[0]}"
```

Every error is a caller still passing a bare boolean. At each one, pass the config slice instead — e.g. `settings.ai` where the whole config is in scope, or `{ historySearch: x, chatSearch: y }` built from named reads. Re-run until clean:

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

- [ ] **Step 6: Commit**

```bash
git add src/app/chat-api.ts src/app/chat-api.test.ts
git commit -m "refactor(chat-api): memoize tool-list variants by flag combination

Two toggles make four combinations, so the two-frozen-constants spelling cannot
hold. Flags travel as the AiConfig slice — two adjacent boolean|undefined params
would rebuild the transposition hazard §159 closed."
```

Every commit in this plan is green. Nothing is left knowingly failing between tasks.

---

### Task 7: The tool definition

**Files:**
- Modify: `src/app/chat-tool-defs.ts`

- [ ] **Step 1: Add the definition**

Append to `TOOL_DEFS` in `src/app/chat-tool-defs.ts`, immediately after the `search_history` entry:

```ts
  {
    name: "search_chats",
    // ★★★ THE COVERAGE DISCLOSURE IS LOAD-BEARING, NOT HEDGING. Threads are
    //  Turso-only by construction, so in file mode there is nothing to search —
    //  and an empty `hits` array looks identical either way. Without the
    //  `coverage` field and this sentence, the model reports "I searched your
    //  past conversations and found nothing" to every file-mode user, forever.
    // ★★ The ACTIVE thread is deliberately absent from results: it is already
    //  verbatim in this request, so saying so stops the model concluding its own
    //  conversation has gone missing.
    description:
      "Search this project's PAST chat conversations — the threads you and the user have had " +
      "before this one, newest first. Use it when the user refers to something you discussed " +
      "earlier (\"did we already decide…\", \"what did I tell you about…\", \"we talked about this\"), " +
      "or when you need a decision or piece of context that is not in the project's current " +
      "state. Use the list_* tools for current state and search_history for what CHANGED. " +
      "Each hit is one thread: its id, its title, the time it " +
      "was last updated (carrying the project's UTC offset), and the messages that matched. " +
      "The conversation you are in right now is NEVER returned — you already have it in full. " +
      "Check `coverage` before you answer: `turso` means past conversations were searched, and " +
      "`unavailable` means this project does not store them at all, so an empty result is NOT " +
      "evidence that nothing was discussed — say you cannot look rather than that you found " +
      "nothing. If `truncated` is true, or a hit's `moreMessages` is above zero, more matched " +
      "than you were given — say so rather than implying the list is complete. Read-only.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Case-insensitive substring matched against message text.",
        },
        // ★★ Same frame-of-reference contract as search_history: these bounds
        //    resolve in the project's timezone, the same calendar as the
        //    `Today is` date in the system prompt.
        since: {
          type: "string",
          description:
            "Inclusive lower bound as YYYY-MM-DD, in the project's timezone — the same " +
            "calendar as the `Today is` date you were given. Convert relative phrasing yourself.",
        },
        until: {
          type: "string",
          description: "Inclusive upper bound as YYYY-MM-DD, in the project's timezone.",
        },
        limit: {
          type: "number",
          description:
            "Maximum MESSAGES to return across all threads (default 20, maximum 50). " +
            "Threads are not capped — every thread holding a match is eligible.",
        },
      },
    },
  },
```

- [ ] **Step 2: Add the `search_chats` half of the variant tests**

Now that the tool exists, append to the `describe("tool variants", …)` block in `src/app/chat-api.test.ts`:

```ts
  it("offers search_chats by default and drops it when disabled", () => {
    expect(toolNamesFor(ALL).has("search_chats")).toBe(true);
    expect(toolNamesFor(NO_CHAT).has("search_chats")).toBe(false);
  });

  it("drops each tool independently", () => {
    // The combination that matters: one off, one on, in both directions.
    expect(toolNamesFor(NO_HISTORY).has("search_chats")).toBe(true);
    expect(toolNamesFor(NO_CHAT).has("search_history")).toBe(true);
    expect(toolNamesFor(NEITHER).has("search_chats")).toBe(false);
  });
```

- [ ] **Step 3: Run the variant tests**

```bash
npx vitest run src/app/chat-api.test.ts --reporter=dot; echo "EXIT=$?"
node -e "console.log(require('fs').readFileSync('src/app/chat-tool-defs.ts','utf8').split('\n').length)"
```

Expected: PASS. Line count under 800 (was 695 — this entry is roughly 45 lines, leaving margin).

- [ ] **Step 4: Commit**

```bash
git add src/app/chat-tool-defs.ts src/app/chat-api.test.ts
git commit -m "feat(chat): declare the search_chats tool

Description states the coverage split explicitly: unavailable means threads are
not stored, which is not the same as searched-and-empty."
```

---

### Task 8: The executor

`use-chat-dispatcher.ts` has **2 lines** of headroom and `chat-tools.ts` has 34, so the executor body lives in its own module — the `chat-task-patch.ts` extraction precedent.

The spec lists §164's `args` guard as a landmine. It does not transfer literally: §164 is about an activity entry's POSITIONAL `args` array, where dropping a bad element shifts every later `{0}`/`{1}` placeholder and turns a crash into silently wrong text. `search_chats` input is a flat named object with no positional array, so the analogue is coerce-or-drop per field — a bad `query` becomes "no filter", never a stringified `[object Object]` matched against message text. The malformed-input test below is what pins it.

**Files:**
- Create: `src/app/chat-search-tool.ts`
- Create: `src/app/chat-search-tool.test.ts`
- Modify: `src/app/chat-tools.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/chat-search-tool.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runChatSearch } from "./chat-search-tool";
import type { PublishedThreads } from "./chat-threads-registry";
import type { ChatThread } from "./chat-threads";

const T: ChatThread = {
  id: "t1",
  projectId: "p1",
  name: "",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  history: [],
  display: [{ kind: "user", text: "the vendor decision" }],
};

const LIVE: PublishedThreads = { threads: [T], activeThreadId: null, available: true };

describe("runChatSearch", () => {
  it("throws when the toggle is off", () => {
    // ★★★ ENFORCEMENT, not advertisement (§162). The prompt-side gate removes
    //   the tool from the offered set; this one refuses to SERVE it. `runTool`
    //   is reached by NAME, and a model that watched its own search_chats call
    //   succeed three turns ago has a template to mimic — so a switch framed to
    //   the user as turning a capability OFF must not rest on the request being
    //   well-formed.
    expect(() => runChatSearch({}, LIVE, "UTC", false)).toThrow(/switched off/i);
  });

  it("searches when the toggle is on", () => {
    const res = runChatSearch({}, LIVE, "UTC", true);
    expect(res.hits).toHaveLength(1);
    expect(res.coverage).toBe("turso");
  });

  it("coerces or drops malformed input rather than throwing", () => {
    const res = runChatSearch(
      { query: 42, since: null, until: {}, limit: "10" },
      LIVE,
      "UTC",
      true,
    );
    // Every field is coerced-or-dropped: the engine treats an absent field as
    // "no filter", which is the honest reading of garbage from a model that
    // cannot be asked to try again.
    expect(res.hits).toHaveLength(1);
  });

  it("reports unavailable coverage rather than an empty search", () => {
    const res = runChatSearch({}, { threads: [], activeThreadId: null, available: false }, "UTC", true);
    expect(res.coverage).toBe("unavailable");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/chat-search-tool.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the executor**

Create `src/app/chat-search-tool.ts`:

```ts
// The `search_chats` executor.
//
// ★ Extracted rather than inlined in `chat-tools.ts` (34 lines of headroom) or
//   `use-chat-dispatcher.ts` (2), following the `chat-task-patch.ts` precedent.
//   Being its own module also makes it directly testable.
import { searchChats, type ChatSearchResult } from "./chat-search";
import type { PublishedThreads } from "./chat-threads-registry";

/** Model-supplied tool input, before coercion. */
type RawInput = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function runChatSearch(
  input: RawInput,
  published: PublishedThreads,
  tz: string,
  enabled: boolean,
): ChatSearchResult {
  // ★ ENGLISH ON PURPOSE: every throw in this layer is unlocalized, because
  //   these strings are primarily MODEL-facing — they come back as a
  //   `tool_result` for the model to act on, and only incidentally render in the
  //   tool block. Translating one of ~20 would be the inconsistency.
  if (!enabled) {
    throw new Error(
      "search_chats is switched off for this project (Settings → AI → chat history search).",
    );
  }
  return searchChats(
    published.threads,
    published.activeThreadId,
    {
      query: str(input.query),
      since: str(input.since),
      until: str(input.until),
      limit: typeof input.limit === "number" ? input.limit : undefined,
    },
    tz,
    published.available,
  );
}
```

- [ ] **Step 4: Run the test — it should pass**

```bash
npx vitest run src/app/chat-search-tool.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Wire it into `chat-tools.ts`**

Add the imports:

```ts
import { runChatSearch } from "./chat-search-tool";
import type { PublishedThreads } from "./chat-threads-registry";
```

Add to the `ToolDispatcher` interface, beside `isHistorySearchEnabled`:

```ts
  /** The project's stored chat threads, as published by the chat panel.
   *  ★ A METHOD, not a `getSnapshot()` field — same reason as
   *  `getActivityLog()`: `get_app_state` returns the snapshot VERBATIM, and 50
   *  threads of full conversation text is not something every call should
   *  carry. The snapshot gets the bounded `chatPointer` instead. */
  getChatThreads(): PublishedThreads;
  /** Is `search_chats` live? (`settings.ai.chatSearch !== false`.) */
  isChatSearchEnabled(): boolean;
```

Add the executor case beside `case "search_history"`:

```ts
    case "search_chats":
      return runChatSearch(
        input,
        d.getChatThreads(),
        d.getTimezone(),
        d.isChatSearchEnabled(),
      );
```

- [ ] **Step 6: Check the size gate — this is the tight one**

```bash
node -e "console.log(require('fs').readFileSync('src/app/chat-tools.ts','utf8').split('\n').length)"
```

Must stay at or under 800 (was 766). If it does not, condense the two interface docblocks — put the long reasoning in `docs/open-followups.md` and cite it. **Do not re-baseline**; raising a ratchet to admit your own comments defeats the gate.

- [ ] **Step 7: Verify**

```bash
npx vitest run src/app/chat-tools.test.ts --reporter=dot; echo "EXIT=$?"
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

- [ ] **Step 8: Commit**

```bash
git add src/app/chat-search-tool.ts src/app/chat-search-tool.test.ts src/app/chat-tools.ts
git commit -m "feat(chat): serve search_chats from the dispatcher

Executor refuses when the toggle is off — the advertisement gate alone leaves
prior tool_use pairs in the re-sent history as a template to mimic (§162)."
```

---

### Task 9: The ambient pointer

**Files:**
- Modify: `src/app/chat-search.ts`
- Modify: `src/app/chat-search.test.ts`
- Create: `src/app/chat-recap.ts`
- Create: `src/app/chat-recap.test.ts`

- [ ] **Step 1: Write the failing engine test**

In `src/app/chat-search.test.ts`, widen the existing import:

```ts
import { searchChats, summarizeChatThreads } from "./chat-search";
```

then append:

```ts
describe("summarizeChatThreads", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      thread({
        id: `t${i}`,
        updatedAt: `2026-08-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
        display: [{ kind: "user", text: `topic ${i}` }],
      }),
    );

  it("returns null when there are no other threads", () => {
    expect(summarizeChatThreads([], null, UTC)).toBeNull();
    const only = [thread({ id: "active", display: [{ kind: "user", text: "a" }] })];
    expect(summarizeChatThreads(only, "active", UTC)).toBeNull();
  });

  it("counts every other thread but names at most three, newest first", () => {
    const res = summarizeChatThreads(many(5), null, UTC);
    expect(res?.count).toBe(5);
    expect(res?.recent).toHaveLength(3);
    expect(res?.recent.map((r) => r.title)).toEqual(["topic 4", "topic 3", "topic 2"]);
  });

  it("excludes the active thread from the count", () => {
    const res = summarizeChatThreads(many(3), "t0", UTC);
    expect(res?.count).toBe(2);
  });

  it("renders the timestamp in the project zone", () => {
    const one = [
      thread({ id: "t1", updatedAt: "2026-08-05T12:00:00.000Z", display: [{ kind: "user", text: "a" }] }),
    ];
    expect(summarizeChatThreads(one, null, "Europe/Berlin")?.recent[0].at).toContain("+02:00");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/chat-search.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: FAIL — `summarizeChatThreads` is not exported.

- [ ] **Step 3: Add the pointer engine**

Append to `src/app/chat-search.ts`:

```ts
export const CHAT_POINTER_MAX = 3;

export interface ChatPointerEntry {
  title: string;
  /** Rendered in the project zone. */
  at: string;
}

export interface ChatPointer {
  /** Threads other than the active one. */
  count: number;
  recent: readonly ChatPointerEntry[];
}

/**
 * A bounded pointer at past conversations — a count and up to three titles.
 *
 * ★★ COSTS NOTHING. `threadTitle` already supplies each thread's title — the
 *    user's own name when set, else one derived from its first user message —
 *    so this needs no model call and no durable write, which is what removed
 *    summaries, the staleness rule and the cost-per-summary decision from this
 *    slice entirely.
 *
 * ★ Returns `null` when there is nothing to point at, so a project with one
 *   conversation costs zero tokens.
 */
export function summarizeChatThreads(
  threads: readonly ChatThread[],
  activeThreadId: string | null,
  tz: string,
): ChatPointer | null {
  const others = threads
    .filter((th) => th.id !== activeThreadId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  if (others.length === 0) return null;
  return {
    count: others.length,
    recent: others.slice(0, CHAT_POINTER_MAX).map((th) => ({
      title: threadTitle(th),
      at: isoInZone(th.updatedAt, tz),
    })),
  };
}
```

- [ ] **Step 4: Write the failing renderer test**

Create `src/app/chat-recap.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildChatPointerBlock } from "./chat-recap";
import type { ChatPointer } from "./chat-search";

const POINTER: ChatPointer = {
  count: 4,
  recent: [
    { title: "vendor decision", at: "2026-08-09T10:00:00+02:00" },
    { title: "budget review", at: "2026-08-07T10:00:00+02:00" },
  ],
};

const OFFERED = new Set(["search_chats"]);

describe("buildChatPointerBlock", () => {
  it("is empty when there is no pointer", () => {
    expect(buildChatPointerBlock(null, OFFERED)).toBe("");
  });

  it("states the count and names the recent threads", () => {
    const out = buildChatPointerBlock(POINTER, OFFERED);
    expect(out).toContain("4");
    expect(out).toContain("vendor decision");
    expect(out).toContain("budget review");
  });

  it("names search_chats only when that tool is offered", () => {
    // ★★★ The two toggles are INDEPENDENT, so pointer-on + tool-off is a
    //   REACHABLE combination — and it is the one that shipped a prompt naming
    //   a tool the request did not carry, on every turn of every conversation.
    //   The COUNT survives it: knowing four past conversations exist still
    //   orients the model even when it cannot go read them.
    expect(buildChatPointerBlock(POINTER, OFFERED)).toContain("search_chats");
    const without = buildChatPointerBlock(POINTER, new Set<string>());
    expect(without).not.toContain("search_chats");
    expect(without).toContain("4");
  });

  it("omits an untitled thread's empty name rather than printing a blank", () => {
    const out = buildChatPointerBlock(
      { count: 1, recent: [{ title: "", at: "2026-08-09T10:00:00+02:00" }] },
      OFFERED,
    );
    expect(out).not.toContain('""');
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

```bash
npx vitest run src/app/chat-recap.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: FAIL — module not found.

- [ ] **Step 6: Write the renderer**

Create `src/app/chat-recap.ts`:

```ts
// The ambient chat-pointer sentence.
//
// ★ Kept out of `use-chat-dispatcher.ts` so it is testable: that hook is
//   coverage-excluded UI glue. Mirrors `activity-recap.ts`.
//
// ★★ `offeredTools` IS THE SET THE WIRE WILL ACTUALLY SEND (`toolsFor`), and the
//   closing sentence naming the tool is emitted ONLY when it holds that name.
//   `chatSearch` gates the pointer AND the tool together today, but they are
//   read at different points and nothing structurally prevents them diverging —
//   the activity recap shipped exactly that bug, naming `search_history` on
//   every turn of every conversation while the request did not carry it.
//
// ★ Deliberately a plain `ReadonlySet`, not an import from `chat-api.ts`: that
//   module imports this one, and a value import back would close a runtime cycle.
import type { ChatPointer } from "./chat-search";

export function buildChatPointerBlock(
  pointer: ChatPointer | null,
  offeredTools: ReadonlySet<string>,
): string {
  if (!pointer) return "";

  const named = pointer.recent
    .filter((r) => r.title.trim() !== "")
    .map((r) => `"${r.title}" (${r.at})`);

  const head =
    pointer.count === 1
      ? "There is 1 earlier conversation in this project"
      : `There are ${pointer.count} earlier conversations in this project`;

  const recent = named.length > 0 ? `; most recent: ${named.join(", ")}` : "";
  const tool = offeredTools.has("search_chats")
    ? " Use search_chats to read them."
    : "";

  return `${head}${recent}.${tool}`;
}
```

- [ ] **Step 7: Run both tests**

```bash
npx vitest run src/app/chat-search.test.ts src/app/chat-recap.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: PASS.

- [ ] **Step 8: Emit it into the volatile suffix**

In `src/app/chat-api.ts`, import the renderer:

```ts
import { buildChatPointerBlock } from "./chat-recap";
```

Beside the existing `activityBlock`, add:

```ts
  // Thread state changes every turn, so this block MUST stay in the uncached
  // suffix — in the cached prefix it would invalidate the prompt cache on every
  // message, which costs far more than the ~40 tokens it saves.
  const chatBlock = buildChatPointerBlock(snapshot.chatPointer ?? null, offeredTools);
```

and add `chatBlock` to the `volatileText` array immediately after `activityBlock`.

- [ ] **Step 9: Commit**

```bash
git add src/app/chat-search.ts src/app/chat-search.test.ts src/app/chat-recap.ts src/app/chat-recap.test.ts src/app/chat-api.ts
git commit -m "feat(chat): ambient pointer at past conversations

Free — threadTitle already supplies the titles. Names search_chats only
when that tool is actually offered."
```

---

### Task 10: Dispatcher bindings

`use-chat-dispatcher.ts` has **2 lines** of headroom. Everything below is a binding to code that already exists elsewhere.

**Files:**
- Modify: `src/app/chat-tools.ts` (snapshot field)
- Modify: `src/app/use-chat-dispatcher.ts`

- [ ] **Step 1: Add the snapshot field**

In `src/app/chat-tools.ts`, add to the `getSnapshot()` return type beside `activitySummary`:

```ts
    /** Bounded pointer at past conversations — a count and up to three titles.
     *  ★★★ NOT the threads; see `getChatThreads()`. Safe here for the same
     *  reason `activitySummary` is: bounded and small. */
    chatPointer?: ChatPointer;
```

and the type import:

```ts
import type { ChatPointer } from "./chat-search";
```

- [ ] **Step 2: Bind in the dispatcher**

In `src/app/use-chat-dispatcher.ts`, add the imports:

```ts
import { summarizeChatThreads } from "./chat-search";
import { readChatThreads } from "./chat-threads-registry";
import { chatSearchEnabled } from "./settings-types";
```

(fold `chatSearchEnabled` into the existing `./settings-types` import line rather than adding a new one — the file has two lines of headroom.)

In the `getSnapshot` return, beside `activitySummary`:

```ts
        chatPointer: chatSearchEnabled(settingsRef.current.ai.chatSearch)
          ? (summarizeChatThreads(
              readChatThreads(projectId).threads,
              readChatThreads(projectId).activeThreadId,
              getTimezone(),
            ) ?? undefined)
          : undefined,
```

Beside `getActivityLog` / `isHistorySearchEnabled`:

```ts
      getChatThreads: () => readChatThreads(projectId),
      isChatSearchEnabled: () => chatSearchEnabled(settingsRef.current.ai.chatSearch),
```

Read the surrounding code before writing this: `projectId` and `getTimezone` must be the names already in scope in that hook. If `projectId` is not, take it from whichever dep carries the chat project id, and prefer a single `const published = readChatThreads(projectId);` hoisted above the return over the doubled call shown here — it is fewer lines, which matters more here than anywhere else in the plan.

- [ ] **Step 3: Check the size gate — this is the tightest point in the plan**

```bash
node -e "console.log(require('fs').readFileSync('src/app/use-chat-dispatcher.ts','utf8').split('\n').length)"
```

Must be at or under 800. It was 798. If over, condense — extract the snapshot expression into a helper in `chat-search-tool.ts` and call it. Widen that file's existing `./chat-search` import to `import { searchChats, summarizeChatThreads, type ChatPointer, type ChatSearchResult } from "./chat-search";` and add:

```ts
export function chatPointerFor(
  published: PublishedThreads,
  tz: string,
  enabled: boolean,
): ChatPointer | undefined {
  if (!enabled) return undefined;
  return summarizeChatThreads(published.threads, published.activeThreadId, tz) ?? undefined;
}
```

which reduces the dispatcher's snapshot field to a single line. **Do not re-baseline.**

- [ ] **Step 4: Verify**

```bash
npx vitest run src/app/use-chat-dispatcher.test.tsx src/app/chat-tools.test.ts --reporter=dot; echo "EXIT=$?"
npx tsc --noEmit; echo "TSC_EXIT=$?"
npm run size:check; echo "EXIT=$?"
```

- [ ] **Step 5: Commit**

```bash
git add src/app/chat-tools.ts src/app/use-chat-dispatcher.ts
git commit -m "feat(chat): bind chat search and the pointer into the dispatcher"
```

---

### Task 11: The settings row

**Files:**
- Modify: `src/app/settings-sections/ai-section.tsx`
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`

- [ ] **Step 1: Add the EN strings**

In `src/app/i18n.ts`, immediately after `settingsAiActivityRecapHelp`:

```ts
  settingsAiChatSearch: "Let the assistant search past conversations",
  settingsAiChatSearchHelp:
    "The assistant can search this project's earlier chat threads and is told how many exist. " +
    "Past conversations are only stored on Turso projects; with this off, the tool is removed " +
    "from the assistant entirely rather than merely discouraged.",
```

- [ ] **Step 2: Add the DE strings**

`i18n.de.ts` is CRLF, and the Edit tool corrupts umlauts and curls double quotes there — including in umlaut-free strings. Patch with a node utf8 write, matching `\r\n`:

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
const s = fs.readFileSync(p, "utf8");
const anchor = "  settingsAiActivityRecapHelp:";
const i = s.indexOf(anchor);
if (i < 0) throw new Error("anchor not found");
const end = s.indexOf("\r\n", s.indexOf("\",\r\n", i));
const add =
  "\r\n  settingsAiChatSearch: \"Assistent darf frühere Unterhaltungen durchsuchen\"," +
  "\r\n  settingsAiChatSearchHelp:" +
  "\r\n    \"Der Assistent kann frühere Chatverläufe dieses Projekts durchsuchen und erfährt, wie viele es gibt. \" +" +
  "\r\n    \"Frühere Unterhaltungen werden nur in Turso-Projekten gespeichert; ist die Option aus, wird das \" +" +
  "\r\n    \"Werkzeug vollständig entfernt und nicht nur eingeschränkt.\",";
fs.writeFileSync(p, s.slice(0, end) + add + s.slice(end), "utf8");
console.log("inserted");
'
```

- [ ] **Step 3: Verify the encoding survived**

```bash
grep -n "settingsAiChatSearch" src/app/i18n.de.ts
npx vitest run src/app/i18n-encoding.test.ts --reporter=dot; echo "EXIT=$?"
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: real umlauts (`frühere`, `vollständig`), no ASCII substitutions, straight `"` quotes, tsc clean — `tsc` is what enforces EN/DE key parity.

- [ ] **Step 4: Add the toggle row**

In `src/app/settings-sections/ai-section.tsx`, immediately after the activity-recap row's `FieldHint`:

```tsx
        {/* Chat-thread search + the ambient pointer (B2c). Default ON (undefined = on). */}
        <label className="mt-3 flex items-center gap-2">
          <Checkbox
            aria-label={t(lang, "settingsAiChatSearch")}
            checked={settings.ai.chatSearch !== false}
            onChange={() =>
              onChange({
                ...settings,
                ai: {
                  ...settings.ai,
                  chatSearch: settings.ai.chatSearch === false,
                },
              })
            }
          />
          <span className="text-xs text-foreground">
            {t(lang, "settingsAiChatSearch")}
          </span>
        </label>
        <FieldHint className="mt-1">
          {t(lang, "settingsAiChatSearchHelp")}
        </FieldHint>
```

The `aria-label` and the visible `<span>` carry the SAME string, so WCAG 2.5.3 holds by construction. The axe gate cannot see a 2.5.3 violation — the rule it ships is `experimental` and excluded by default — so keeping them identical is the only guard.

- [ ] **Step 5: Verify**

```bash
npx vitest run src/app/settings-sections --reporter=dot; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

- [ ] **Step 6: Commit**

```bash
git add src/app/settings-sections/ai-section.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(settings): add the chat-search toggle row"
```

---

### Task 12: Full gate run

- [ ] **Step 1: Run every local gate, unpiped**

Never read a gate's exit code through a pipe — you get the pipe's status, and the failure diagnostic is discarded.

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "LINT_EXIT=$?"
npm run test:run > /tmp/b2c-suite.log 2>&1; echo "SUITE_EXIT=$?"
grep -E "Test Files|Tests " /tmp/b2c-suite.log
npm run test:coverage > /tmp/b2c-cov.log 2>&1; echo "COV_EXIT=$?"
npm run test:shuffle > /tmp/b2c-shuffle.log 2>&1; echo "SHUFFLE_EXIT=$?"
grep -E "Test Files|Tests " /tmp/b2c-shuffle.log
npm run size:check; echo "SIZE_EXIT=$?"
npm run dup:check; echo "DUP_EXIT=$?"
npm run docs:symbols:check; echo "SYMBOLS_EXIT=$?"
npm run docs:claims:check; echo "CLAIMS_EXIT=$?"
```

`test:shuffle` is the one that matters most for this slice — it is the only local reproduction of the `unit-tests-shuffled` gate, and the registry is module state that leaks across files if any test forgot its `afterEach(clearChatThreads)`.

Run these **one at a time**. Two concurrent vitest processes saturate the machine and produce load-sensitive timeout flakes that never reproduce in isolation.

- [ ] **Step 2: Confirm the three untouched files are untouched**

```bash
git diff --stat origin/main...HEAD -- src/app/task-manager.tsx src/app/workspace-section.tsx src/app/chat-panel.tsx
```

Expected: **no output**. Any diff here means the design was bypassed, and all three are at zero size headroom.

- [ ] **Step 3: Update AGENTS.md**

Add a bullet under "Architecture pointers" recording: the registry and why it is a module store rather than a prop; that `coverage` derives from Turso reachability and never from `threads.length`; that the publish is gated on `tursoMode` because `panel-chat` never remounts; and that the tool-list variants are now a memo keyed by the flag combination rather than two frozen constants.

Then re-run the symbol gate, since that file is scanned:

```bash
npm run docs:symbols:check; echo "EXIT=$?"
```

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs(agents): record the chat-threads registry and the variant memo"
```

---

## What this plan does NOT do

Deliberately out of scope, per the spec:

- Model-written thread summaries, and with them the durable write path, the staleness rule and the cost-per-summary decision.
- A `source` discriminator on `HistoryResult.events`.
- Widening `search_history` to cover chats.
- Attachment content in results, and any ranking or relevance scoring.
- Cross-project search.
- Making chat search work in file mode.

## Verification this plan cannot provide

The e2e, axe and prod-smoke gates do not run locally. "AI Assistant" is in `A11Y_VIEWS`, but `e2e/seed.ts` seeds FILE mode, so the gate renders neither the thread sidebar nor anything this slice adds — a green axe run says nothing about this surface. Eye-verify against a real Turso project before shipping: confirm the assistant answers a question about an earlier thread, and confirm that switching the toggle off makes it say it cannot look rather than that it found nothing.
