import { describe, expect, it } from "vitest";
import {
  CHAT_EXCERPT_MAX,
  DEFAULT_CHAT_LIMIT,
  MAX_CHAT_LIMIT,
  searchChats,
  summarizeChatThreads,
  threadTitle,
} from "./chat-search";
// ★ Imported, never hardcoded as 60 — a copy of the constant here stops
//   tracking its subject the moment the cap moves.
import { deriveThreadName, THREAD_NAME_MAX, type ChatThread } from "./chat-threads";

const UTC = "UTC";

function thread(over: Partial<ChatThread> & { id: string }): ChatThread {
  return {
    id: over.id,
    projectId: "default",
    // ★ `name`, not `title` — `ChatThread`'s stored label is `name`, and it is
    //   the PRIMARY source of a hit's title (see `threadTitle`). Defaulting it
    //   to "" here matches a thread that has never been saved or renamed, which
    //   is the fallback branch; a fixture that only ever leaves it "" cannot
    //   express the renamed-thread case, so set it explicitly when that is what
    //   is under test.
    name: over.name ?? "",
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
          { kind: "tool", name: "list_tasks", input: {}, result: "[]", error: false },
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

  it("resolves a bound in the PROJECT zone, not UTC", () => {
    // ★★ The case above cannot pin the zone: its stamps are all 12:00:00Z, and
    //    no zone within ±12h moves a midday instant to another calendar day, so
    //    `makeDayInZone(tz)` → `makeDayInZone("UTC")` survives it. 22:00Z is
    //    2026-08-06 in Berlin and 2026-08-05 in UTC, so a since of 2026-08-06
    //    must INCLUDE it — and EXCLUDES it the moment the zone is ignored.
    const threads = [
      thread({ id: "berlin", updatedAt: "2026-08-05T22:00:00.000Z", display: [{ kind: "user", text: "a" }] }),
    ];
    const res = searchChats(threads, null, { since: "2026-08-06" }, "Europe/Berlin", true);
    expect(res.hits.map((h) => h.threadId)).toEqual(["berlin"]);
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

  it("orders on the RAW UTC stamp, so a DST fall-back cannot reorder results", () => {
    // ★★ Berlin renders 00:30Z as `02:30:00+02:00` and the LATER 01:30Z as
    //    `02:30:00+01:00` on 2026-10-25, so a comparator sorting the ZONE-
    //    rewritten strings puts the older thread first. Sorting the raw stamps
    //    is the only spelling that survives this.
    const threads = [
      thread({ id: "older", updatedAt: "2026-10-25T00:30:00.000Z", display: [{ kind: "user", text: "a" }] }),
      thread({ id: "newer", updatedAt: "2026-10-25T01:30:00.000Z", display: [{ kind: "user", text: "a" }] }),
    ];
    expect(searchChats(threads, null, {}, "Europe/Berlin", true).hits.map((h) => h.threadId))
      .toEqual(["newer", "older"]);
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

  it("derives the title from the first user message when the thread has no name", () => {
    const threads = [
      thread({ id: "t1", display: [{ kind: "assistant", text: "hi" }, { kind: "user", text: "vendor choice" }] }),
    ];
    expect(searchChats(threads, null, {}, UTC, true).hits[0].title).toBe("vendor choice");
  });

  it("prefers the user's own thread name over the derived one", () => {
    // ★ `name` and the first user message DIFFER on purpose: a fixture where
    //   they agree — or where `name` is "" — passes whichever field the code
    //   reads, so it cannot tell a renamed thread being cited correctly from
    //   one cited under a title that appears nowhere in the sidebar.
    const threads = [
      thread({
        id: "t1",
        name: "Q3 sourcing",
        display: [{ kind: "user", text: "vendor choice" }],
      }),
    ];
    expect(searchChats(threads, null, {}, UTC, true).hits[0].title).toBe("Q3 sourcing");
  });

  it("caps the over-long name it hands the model in a hit", () => {
    // `search_chats` returns this verbatim, so the cap has to survive the
    // producer -> hit hop, not merely exist inside `threadTitle`.
    const name = "q".repeat(THREAD_NAME_MAX * 3);
    const threads = [thread({ id: "t1", name, display: [{ kind: "user", text: "vendor choice" }] })];
    expect(name.length).toBeGreaterThan(THREAD_NAME_MAX);
    expect(searchChats(threads, null, {}, UTC, true).hits[0].title).toHaveLength(THREAD_NAME_MAX + 1);
  });

  it("falls back to the derived name when the stored name is only whitespace", () => {
    const threads = [
      thread({ id: "t1", name: "   ", display: [{ kind: "user", text: "vendor choice" }] }),
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

  // ★★★ THE MESSAGE COUNT IS NOT A SIZE BUDGET, and nothing else in this file
  //    can see that: every other fixture holds messages a few characters long,
  //    so the cap is invisible to them whether it is applied or not. A user
  //    message is stored up to CHAT_MESSAGE_MAX (10 000) and an assistant one is
  //    bounded only by the model's max_tokens, so an unclipped default call
  //    returns hundreds of KB into one tool_result.
  it("clips a long message to CHAT_EXCERPT_MAX and flags it as clipped", () => {
    const long = "x".repeat(CHAT_EXCERPT_MAX + 500);
    const threads = [
      thread({
        id: "t1",
        display: [
          { kind: "user", text: long },
          { kind: "assistant", text: "short" },
        ],
      }),
    ];
    const msgs = searchChats(threads, null, {}, UTC, true).hits[0].messages;
    expect(msgs[0].text).toHaveLength(CHAT_EXCERPT_MAX);
    expect(msgs[0].clipped).toBe(true);
    // ★ The SHORT message is the anti-vacuity half. Without it a flag hardcoded
    //   to `true` — or a clip that shortened every message — passes the two
    //   assertions above, and the model would be told a complete message was an
    //   excerpt, which is the same disclosure defect pointing the other way.
    expect(msgs[1].text).toBe("short");
    expect(msgs[1].clipped).toBeUndefined();
  });

  it("still returns a hit whose only match sits past the excerpt cap", () => {
    // ★★ The needle is matched against the FULL text; only the returned copy is
    //   clipped. Clipping FIRST would silently drop this thread — the excerpt
    //   would then not contain the needle either, which is what `clipped`
    //   discloses.
    const threads = [
      thread({ id: "t1", display: [{ kind: "user", text: "y".repeat(CHAT_EXCERPT_MAX) + " vendor" }] }),
    ];
    const res = searchChats(threads, null, { query: "vendor" }, UTC, true);
    expect(res.hits.map((h) => h.threadId)).toEqual(["t1"]);
    expect(res.hits[0].messages[0].clipped).toBe(true);
  });

  it("backs the clip off a lone surrogate instead of splitting an astral character", () => {
    // ★★ "\u{10000}" is TWO UTF-16 code units and the cap lands BETWEEN them. A
    //   hand-rolled `.slice(0, CHAT_EXCERPT_MAX)` keeps the lone HIGH surrogate,
    //   which UTF-8 encoding replaces with U+FFFD — so CSV/Markdown corrupt
    //   while JSON/IndexedDB survive, a backend-dependent silent corruption this
    //   repo already fixed once in `clipText`. This pins that we reuse it.
    const text = "a".repeat(CHAT_EXCERPT_MAX - 1) + "\u{10000}" + "tail";
    const threads = [thread({ id: "t1", display: [{ kind: "user", text }] })];
    const out = searchChats(threads, null, {}, UTC, true).hits[0].messages[0];
    expect(out.text).toHaveLength(CHAT_EXCERPT_MAX - 1);
    expect(out.text.charCodeAt(out.text.length - 1)).toBe("a".charCodeAt(0));
    expect(out.clipped).toBe(true);
  });

  // ★★★ `resolveLimit(q.limit, DEFAULT_CHAT_LIMIT, MAX_CHAT_LIMIT)` passes two
  //    ADJACENT same-typed numbers. Transposed, the default silently becomes 50
  //    and the ceiling 20 — contradicting the tool description while `tsc` and
  //    every other test in this file stay green, because the largest fixture
  //    elsewhere is three messages. Only a fixture holding MORE matched messages
  //    than MAX_CHAT_LIMIT, asserting BOTH positions, can tell them apart.
  //    Mirrors the `MAX_HISTORY_LIMIT` guard in `history-search.test.ts`.
  it("defaults to DEFAULT_CHAT_LIMIT and clamps to MAX_CHAT_LIMIT", () => {
    // ★ Equal constants would make the two assertions below indistinguishable,
    //   so the fixture's own premise is pinned first.
    expect(DEFAULT_CHAT_LIMIT).toBeLessThan(MAX_CHAT_LIMIT);
    const threads = [
      thread({
        id: "many",
        display: Array.from({ length: MAX_CHAT_LIMIT + 10 }, (_, i) => ({
          kind: "user" as const,
          text: `m${i}`,
        })),
      }),
    ];
    expect(searchChats(threads, null, {}, UTC, true).hits[0].messages).toHaveLength(
      DEFAULT_CHAT_LIMIT,
    );
    expect(
      searchChats(threads, null, { limit: 9999 }, UTC, true).hits[0].messages,
    ).toHaveLength(MAX_CHAT_LIMIT);
    // ★ A rejected limit falls back to the DEFAULT, not the ceiling — the third
    //   position the transposition also moves.
    expect(searchChats(threads, null, { limit: 0 }, UTC, true).hits[0].messages).toHaveLength(
      DEFAULT_CHAT_LIMIT,
    );
  });
});

// ★★★ SIZE is a hazard the DERIVED branch never exposes: `deriveThreadName`
//   caps its own output, so a fixture that leaves `name` blank CANNOT express
//   this bug at any assertion count. Every over-long fixture below therefore
//   sets `name` — the user-set branch, which nothing upstream clamps (the
//   rename Input has no maxLength, the rename writer stores it verbatim, and
//   the loader reads it with no cap).
describe("threadTitle", () => {
  it("clips an over-long USER-SET name to THREAD_NAME_MAX and marks the cut with an ellipsis", () => {
    const name = "x".repeat(THREAD_NAME_MAX * 3);
    const th = thread({ id: "t1", name, display: [{ kind: "user", text: "short first message" }] });
    // Anti-vacuity, both halves: the fixture is over the cap, AND its derived
    // fallback is under it — so the clipped length below can only have come
    // from the `name` branch.
    expect(name.length).toBeGreaterThan(THREAD_NAME_MAX);
    expect(deriveThreadName(th.display).length).toBeLessThanOrEqual(THREAD_NAME_MAX);

    const out = threadTitle(th);
    expect(out).toHaveLength(THREAD_NAME_MAX + 1);
    expect(out.endsWith("…")).toBe(true);
    // The same shape `deriveThreadName` produces, so the two branches read
    // alike to the model.
    expect(out.slice(0, THREAD_NAME_MAX)).toBe("x".repeat(THREAD_NAME_MAX));
  });

  it("leaves a name at exactly the cap untouched and adds no ellipsis", () => {
    const exact = "y".repeat(THREAD_NAME_MAX);
    const out = threadTitle(thread({ id: "t1", name: exact }));
    expect(out).toBe(exact);
    expect(out).not.toContain("…");
  });

  it("does not double the ellipsis when the clip LANDS ON one", () => {
    // ★★ The fixture this assertion used to carry was a repeated single
    //   character, in which the 60th unit can never BE an ellipsis — so its
    //   `not.toContain("……")` could not fail at any assertion count. Only a
    //   name already carrying `…` at the cut reaches the doubling branch.
    const name = `${"z".repeat(THREAD_NAME_MAX - 1)}… and more text`;
    // Anti-vacuity, both halves: the clip really fires (the name is over the
    // cap) AND the clipped result really ends on the ellipsis the guard tests.
    expect(name.length).toBeGreaterThan(THREAD_NAME_MAX);
    expect(name.slice(0, THREAD_NAME_MAX).endsWith("…")).toBe(true);

    const out = threadTitle(thread({ id: "t1", name }));
    expect(out).toHaveLength(THREAD_NAME_MAX);
    expect(out).not.toContain("……");
  });

  // ★★★ PINS AN ORDER, NOT A LENGTH. When the cap moved to its producer the path
  //   flipped from flatten-then-cap to cap-then-flatten: `threadTitle` clips first
  //   and `inlineTitle` (chat-recap.ts) collapses whatever survives. A title with a
  //   long INTERIOR whitespace run therefore yields FEWER visible characters than it
  //   used to, because the run is spent against the cap before it is collapsed.
  //   Deliberate and bounded either way, but nothing pinned it, so a future edit
  //   could reverse it in silence. docs/open-followups.md §176.
  // ★★ The fixture is built so the two orders produce DIFFERENT strings — that is
  //   the whole point. Flatten-then-cap would collapse the run to ONE space and keep
  //   29 trailing "b"s; cap-then-flatten keeps TAIL of them. A fixture without a long
  //   interior run cannot tell the two apart.
  it("clips before flattening, so an interior whitespace run is spent against the cap", () => {
    const HEAD = 30;
    const GAP = 20;
    // ★ Derived, never re-spelled as 10 — the surviving tail is whatever the cap
    //   leaves after the head and the whole (uncollapsed) run are charged against it.
    const TAIL = THREAD_NAME_MAX - HEAD - GAP;
    const name = `${"a".repeat(HEAD)}${" ".repeat(GAP)}${"b".repeat(30)}`;
    // Anti-vacuity, all three halves: the fixture is over the cap, the whole
    // whitespace run sits INSIDE it, and something still survives past the run.
    // Drop any one and the two orderings agree, so the assertion cannot fail.
    expect(name.length).toBeGreaterThan(THREAD_NAME_MAX);
    expect(HEAD + GAP).toBeLessThan(THREAD_NAME_MAX);
    expect(TAIL).toBeGreaterThan(0);

    const title = threadTitle(thread({ id: "t1", name }));
    expect(title).toBe(`${"a".repeat(HEAD)}${" ".repeat(GAP)}${"b".repeat(TAIL)}…`);
  });
});

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

  it("caps the over-long name it puts in the pointer", () => {
    // The pointer rides the UNCACHED half of the system prompt on every turn
    // and `get_app_state` returns it verbatim, so an uncapped title is billed
    // twice over.
    const name = "p".repeat(THREAD_NAME_MAX * 3);
    const one = [thread({ id: "t1", name, display: [{ kind: "user", text: "a" }] })];
    expect(name.length).toBeGreaterThan(THREAD_NAME_MAX);
    expect(summarizeChatThreads(one, null, UTC)?.recent[0].title).toHaveLength(THREAD_NAME_MAX + 1);
  });
});
