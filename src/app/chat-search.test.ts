import { describe, expect, it } from "vitest";
import { searchChats, summarizeChatThreads } from "./chat-search";
import type { ChatThread } from "./chat-threads";

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
});
