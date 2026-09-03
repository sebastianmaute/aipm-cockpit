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

  // ★★★ THE `limit: "10"` CASE ABOVE CANNOT SEE THIS, and that is why this one
  //   exists rather than an assertion added there. `LIVE` yields exactly one
  //   hit, so an honoured limit and a dropped one produce the identical
  //   `toHaveLength(1)` — that case pins coerce-or-drop-without-throwing, not
  //   the limit. Discriminating it needs MORE hits than the limit asks for.
  //   Before the fix, `typeof input.limit === "number"` sent a string straight
  //   to `undefined`, so a model asking for `"1"` silently got the default page
  //   size — the same defect class as `list_tasks`, just with a milder blast
  //   radius (a default page, not the whole register).
  it("honours a numeric-STRING limit rather than falling back to the default page", () => {
    const threads = ["a", "b", "c"].map((id) => ({
      ...T,
      id,
      display: [{ kind: "user" as const, text: "the vendor decision" }],
    }));
    const live: PublishedThreads = { threads, activeThreadId: null, available: true };
    // Anti-vacuity: unlimited really does return more than the limit asks for,
    // so the assertion below is about the limit and not about a thin fixture.
    expect(runChatSearch({ query: "vendor" }, live, "UTC", true).hits.length).toBeGreaterThan(1);
    expect(runChatSearch({ query: "vendor", limit: "1" }, live, "UTC", true).hits).toHaveLength(1);
  });

  it("reports unavailable coverage rather than an empty search", () => {
    const res = runChatSearch({}, { threads: [], activeThreadId: null, available: false }, "UTC", true);
    expect(res.coverage).toBe("unavailable");
  });

  it("reports searchable coverage for an EMPTY but available thread list", () => {
    // ★★★ THE ONLY FIXTURE THAT CAN TELL THE TWO SOURCES APART. Every other
    //   case here is satisfied by an executor that derives coverage from
    //   `threads.length` instead of from the registry's `available` flag: the
    //   turso case has a thread, the unavailable case has neither. An empty
    //   list that IS available separates them — "Turso, no chats yet" must
    //   still report `turso`, or the model tells the user it searched and found
    //   nothing on the one project where that is a lie about the opposite thing.
    const res = runChatSearch(
      {},
      { threads: [], activeThreadId: null, available: true },
      "UTC",
      true,
    );
    expect(res.coverage).toBe("turso");
    expect(res.hits).toHaveLength(0);
  });
});
