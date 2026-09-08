// src/app/chat-cache-layout.test.ts — pins buildWireMessages: where cache
// breakpoints land on the message array and how the volatile turn context is
// attached, without ever persisting into the caller's history array.
import { describe, expect, it } from "vitest";
import { buildWireMessages } from "./chat-cache-layout";
import type { ApiMessage, ContentBlock } from "./chat-api";

describe("buildWireMessages", () => {
  const hist = (n: number): ApiMessage[] =>
    Array.from({ length: n }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: [{ type: "text" as const, text: `m${i}` }],
    })) as ApiMessage[];

  it("appends the turn context to the final user message", () => {
    const out = buildWireMessages(hist(1), "CTX").messages;
    const last = out[out.length - 1];
    expect(last.role).toBe("user");
    expect(JSON.stringify(last.content)).toContain("CTX");
  });

  it("appends a new user message when the history ends on an assistant turn", () => {
    const h = hist(2); // user, assistant
    const out = buildWireMessages(h, "CTX").messages;
    expect(out).toHaveLength(3);
    expect(out[2].role).toBe("user");
    expect(JSON.stringify(out[2].content)).toContain("CTX");
  });

  // ★★★ THE PROPERTY THE WHOLE SLICE EXISTS FOR, and it is asserted against the
  //     RETURNED prefix length rather than a hand-computed slice bound. An
  //     earlier draft sliced at `history.length - 1`, which is only the right
  //     boundary when the final history message is a user turn — with an
  //     assistant turn last the context rides a NEWLY APPENDED message and every
  //     index shifts by one, so the assertion silently compared the wrong things.
  it("keeps everything it cached byte-identical as history grows", () => {
    const h = hist(4);
    const before = buildWireMessages(h, "CTX-A");
    const h2 = [
      ...h,
      { role: "assistant", content: [{ type: "text", text: "a" }] },
      { role: "user", content: [{ type: "text", text: "u" }] },
    ] as ApiMessage[];
    const after = buildWireMessages(h2, "CTX-B");
    expect(after.cachedPrefixLength).toBeGreaterThanOrEqual(before.cachedPrefixLength);
    expect(after.messages.slice(0, before.cachedPrefixLength)).toEqual(
      before.messages.slice(0, before.cachedPrefixLength),
    );
  });

  it("marks no breakpoint at or after the context-bearing message", () => {
    const out = buildWireMessages(hist(4), "CTX");
    expect(out.cachedPrefixLength).toBeLessThan(out.messages.length);
    const tail = out.messages.slice(out.cachedPrefixLength);
    expect(JSON.stringify(tail)).not.toContain("cache_control");
  });

  it("never places more than two breakpoints on the messages", () => {
    const out = buildWireMessages(hist(20), "CTX");
    const marks = JSON.stringify(out.messages).match(/cache_control/g) ?? [];
    expect(marks.length).toBeLessThanOrEqual(2);
  });

  it("keeps tool_result blocks leading their user message", () => {
    const withResults: ApiMessage[] = [
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "x", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
    ];
    const out = buildWireMessages(withResults, "CTX").messages;
    const last = out[out.length - 1];
    const kinds = (last.content as ContentBlock[]).map((b) => b.type);
    expect(kinds[0]).toBe("tool_result");
    expect(kinds[kinds.length - 1]).toBe("text");
  });

  it("returns history untouched when the turn context is empty", () => {
    const h = hist(3);
    const out = buildWireMessages(h, "");
    expect(out.messages).toEqual(h);
    expect(out.cachedPrefixLength).toBe(h.length);
  });

  // ★ A string `content` is widened to a block pair rather than concatenated,
  //   matching `appendUserNote`'s existing rule in chat-api.ts.
  it("widens a string content instead of concatenating into it", () => {
    const h: ApiMessage[] = [{ role: "user", content: "hello" }];
    const last = buildWireMessages(h, "CTX").messages[0];
    expect(Array.isArray(last.content)).toBe(true);
    expect((last.content as ContentBlock[]).map((b) => b.type)).toEqual(["text", "text"]);
  });

  // ★★ Extra coverage beyond the plan's listed cases, for branches
  // `withCacheControl` and `checkpointMarks` take that no test above reaches
  // on its own: an empty-blocks message, a tool_use-terminated message
  // (neither `text` nor `tool_result` — must NOT be marked), and the
  // `bucket < 1` early return for an empty cached prefix.
  //
  // Both fixtures below use exactly two history messages ending on an
  // assistant turn, so buildWireMessages appends a third (context-bearing)
  // message and cachedPrefixLength is 2 — checkpointMarks(2) is the current
  // bucket boundary (index 1) AND the previous one (index 0), so BOTH
  // original messages are breakpoint candidates.

  it("skips marking a message whose content array is empty", () => {
    const h: ApiMessage[] = [
      { role: "user", content: [] },
      { role: "assistant", content: [{ type: "text", text: "a" }] },
    ];
    const out = buildWireMessages(h, "CTX");
    expect(out.messages[0].content).toEqual([]);
    // The other candidate (index 1) is a normal text message and DOES get
    // marked — confirms the empty-content message is skipped for its own
    // reason, not because nothing in this fixture is markable.
    const marked = out.messages[1].content as ContentBlock[];
    expect(marked[marked.length - 1]).toHaveProperty("cache_control");
  });

  it("does not mark a message ending in a tool_use block", () => {
    const h: ApiMessage[] = [
      { role: "user", content: [{ type: "text", text: "u0" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "x", input: {} }] },
    ];
    const out = buildWireMessages(h, "CTX");
    const toolUseMsg = out.messages[1].content as ContentBlock[];
    expect(toolUseMsg[toolUseMsg.length - 1]).not.toHaveProperty("cache_control");
    // The other candidate (index 0) is a normal text message and DOES get
    // marked — confirms the tool_use message is skipped for its own reason.
    const textMsg = out.messages[0].content as ContentBlock[];
    expect(textMsg[textMsg.length - 1]).toHaveProperty("cache_control");
  });

  it("places no breakpoints when the cached prefix is empty", () => {
    // A single history message ending on a user turn merges the context into
    // it, leaving cachedPrefixLength at 0 — checkpointMarks(0) must hit the
    // `bucket < 1` early return rather than indexing bucket - 1 = -1.
    const out = buildWireMessages([{ role: "user", content: "hi" }], "CTX");
    expect(out.cachedPrefixLength).toBe(0);
    expect(JSON.stringify(out.messages)).not.toContain("cache_control");
  });
});
