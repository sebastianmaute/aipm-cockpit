import { describe, expect, it } from "vitest";
import { searchChats } from "./chat-search";
import type { ChatThread } from "./chat-threads";

const UTC = "UTC";

function thread(over: Partial<ChatThread> & { id: string }): ChatThread {
  return {
    id: over.id,
    projectId: "default",
    // ★ `name`, not `title` — `ChatThread`'s stored label is `name`, and it is
    //   inert here: `searchChats` derives a hit's title from the display list
    //   via `deriveThreadName`, never from this field.
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
