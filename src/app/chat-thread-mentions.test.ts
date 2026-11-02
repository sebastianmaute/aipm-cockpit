// src/app/chat-thread-mentions.test.ts — the "find chats mentioning a person" search.
import { describe, it, expect } from "vitest";
import { findThreadsMentioning } from "./chat-thread-mentions";
import type { ChatThread } from "./chat-threads";

function thread(id: string, over: Partial<ChatThread> = {}): ChatThread {
  return {
    id, projectId: "p", ownerId: null, name: `Thread ${id}`,
    createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z", history: [], display: [], ...over,
  };
}

const ids = (list: readonly ChatThread[]) => list.map((th) => th.id);

describe("findThreadsMentioning", () => {
  it("finds a name inside a tool result, case-insensitively", () => {
    const th = thread("a", {
      history: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "u1", content: "Owner: Jane DOE" }] }],
    });
    expect(ids(findThreadsMentioning([th, thread("b")], "jane doe", null))).toEqual(["a"]);
  });

  it("finds an e-mail address in an assistant reply", () => {
    const th = thread("a", {
      history: [{ role: "assistant", content: [{ type: "text", text: "Mail Jane.Doe@Example.com today." }] }],
    });
    expect(ids(findThreadsMentioning([th], "jane.doe@example.com", null))).toEqual(["a"]);
  });

  it("finds a name in a plain user message, a tool input, the display and the thread name", () => {
    const user = thread("u", { history: [{ role: "user", content: "ask Jane" }] });
    const tool = thread("t", {
      history: [{ role: "assistant", content: [{ type: "tool_use", id: "x", name: "update_task", input: { assignee: "Jane" } }] }],
    });
    const shown = thread("d", { display: [{ kind: "notice", text: "Jane was assigned" }] });
    const named = thread("n", { name: "Notes on Jane" });
    expect(ids(findThreadsMentioning([user, tool, shown, named, thread("z")], "JANE", null))).toEqual(["u", "t", "d", "n"]);
  });

  it("never returns a colleague's row, even when it mentions the person", () => {
    const mine = thread("m", { ownerId: "me", name: "Jane" });
    const legacy = thread("l", { name: "Jane" });
    const colleague = thread("c", { ownerId: "colleague", name: "Jane" });
    expect(ids(findThreadsMentioning([mine, legacy, colleague], "jane", "me"))).toEqual(["m", "l"]);
    expect(ids(findThreadsMentioning([mine, legacy, colleague], "jane", null))).toEqual(["l"]);
  });

  it("matches a name whatever its Unicode composition", () => {
    const decomposed = "Müller";
    const th = thread("a", { history: [{ role: "assistant", content: [{ type: "text", text: `Ask ${decomposed}` }] }] });
    expect(ids(findThreadsMentioning([th], "Müller", null))).toEqual(["a"]);
    expect(ids(findThreadsMentioning([thread("b", { name: "Müller" })], decomposed, null))).toEqual(["b"]);
  });

  it("trims the query and returns nothing for an empty one", () => {
    const th = thread("a", { name: "Jane" });
    expect(ids(findThreadsMentioning([th], "  jane  ", null))).toEqual(["a"]);
    expect(findThreadsMentioning([th], "   ", null)).toEqual([]);
    expect(findThreadsMentioning([th], "", null)).toEqual([]);
  });
});
