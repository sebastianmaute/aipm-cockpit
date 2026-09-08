// src/app/chat-cache-layout.test.ts — pins buildWireMessages: where cache
// breakpoints land on the message array and how the volatile turn context is
// attached, without ever persisting into the caller's history array.
import { describe, expect, it } from "vitest";
import { buildWireMessages, MAX_MESSAGE_BREAKPOINTS } from "./chat-cache-layout";
import type { ApiMessage, ContentBlock } from "./chat-api";

const hist = (n: number): ApiMessage[] =>
  Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: [{ type: "text" as const, text: `m${i}` }],
  })) as ApiMessage[];

describe("buildWireMessages", () => {
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

  it("marks no breakpoint at or after the context-bearing message", () => {
    const out = buildWireMessages(hist(4), "CTX");
    expect(out.cachedPrefixLength).toBeLessThan(out.messages.length);
    const tail = out.messages.slice(out.cachedPrefixLength);
    expect(JSON.stringify(tail)).not.toContain("cache_control");
  });

  it("never places more than two breakpoints on the messages", () => {
    const out = buildWireMessages(hist(20), "CTX");
    const marks = JSON.stringify(out.messages).match(/cache_control/g) ?? [];
    expect(marks.length).toBeLessThanOrEqual(MAX_MESSAGE_BREAKPOINTS);
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

  // ★ `cachedPrefixLength`'s contract ("the prefix `checkpointMarks` placed
  //   breakpoints across") holds on this path too — see the comment on the
  //   `turnContext === ""` branch in chat-cache-layout.ts for why that was
  //   chosen over leaving the path unmarked. hist(3) is user/assistant/user;
  //   checkpointMarks(3) = [1, 2] (verified by the table below), so index 0
  //   stays untouched while 1 and 2 pick up a breakpoint.
  it("marks its own cached prefix when the turn context is empty, rather than returning history untouched", () => {
    const h = hist(3);
    const out = buildWireMessages(h, "");
    expect(out.cachedPrefixLength).toBe(h.length);
    expect(out.messages[0]).toEqual(h[0]);
    const marked1 = out.messages[1].content as ContentBlock[];
    const marked2 = out.messages[2].content as ContentBlock[];
    expect(marked1[marked1.length - 1]).toHaveProperty("cache_control");
    expect(marked2[marked2.length - 1]).toHaveProperty("cache_control");
  });

  it("places no breakpoints (and returns an empty array) when there is no history and no context", () => {
    const out = buildWireMessages([], "");
    expect(out).toEqual({ messages: [], cachedPrefixLength: 0 });
  });

  // ★ A string `content` is widened to a block pair rather than concatenated,
  //   matching `appendUserNote`'s existing rule in chat-api.ts.
  it("widens a string content instead of concatenating into it", () => {
    const h: ApiMessage[] = [{ role: "user", content: "hello" }];
    const last = buildWireMessages(h, "CTX").messages[0];
    expect(Array.isArray(last.content)).toBe(true);
    expect((last.content as ContentBlock[]).map((b) => b.type)).toEqual(["text", "text"]);
  });

  it("places no breakpoints when the cached prefix is empty", () => {
    // A single history message ending on a user turn merges the context into
    // it, leaving cachedPrefixLength at 0 — checkpointMarks(0) must return []
    // rather than indexing bucket - 1 = -1.
    const out = buildWireMessages([{ role: "user", content: "hi" }], "CTX");
    expect(out.cachedPrefixLength).toBe(0);
    expect(JSON.stringify(out.messages)).not.toContain("cache_control");
  });

  // ★★ Extra coverage beyond the plan's listed cases, for branches
  // `withCacheControl` takes that no test above reaches on its own: an
  // empty-blocks message, and a tool_use-terminated message (neither `text`
  // nor `tool_result` — must NOT be marked). Both fixtures use THREE history
  // messages ending on assistant, giving cachedPrefixLength 3 and marks
  // [1, 2] (the table below confirms this pair) — index 2 is the one under
  // test, index 1 is a plain text message that must still get marked, so a
  // pass here can't be "nothing in this fixture is markable."

  it("skips marking a message whose content array is empty", () => {
    const h: ApiMessage[] = [
      { role: "user", content: [{ type: "text", text: "u0" }] },
      { role: "assistant", content: [{ type: "text", text: "a1" }] },
      { role: "assistant", content: [] },
    ];
    const out = buildWireMessages(h, "CTX");
    expect(out.cachedPrefixLength).toBe(3);
    expect(out.messages[2].content).toEqual([]);
    const marked = out.messages[1].content as ContentBlock[];
    expect(marked[marked.length - 1]).toHaveProperty("cache_control");
  });

  it("does not mark a message ending in a tool_use block", () => {
    const h: ApiMessage[] = [
      { role: "user", content: [{ type: "text", text: "u0" }] },
      { role: "assistant", content: [{ type: "text", text: "a1" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "x", input: {} }] },
    ];
    const out = buildWireMessages(h, "CTX");
    expect(out.cachedPrefixLength).toBe(3);
    const toolUseMsg = out.messages[2].content as ContentBlock[];
    expect(toolUseMsg[toolUseMsg.length - 1]).not.toHaveProperty("cache_control");
    const textMsg = out.messages[1].content as ContentBlock[];
    expect(textMsg[textMsg.length - 1]).toHaveProperty("cache_control");
  });

  // ★ Only a `role: "user"` message can carry raw string `content` (chat-api.ts's
  //   `ApiMessage` union), so this needs a NON-tail user message (the tail must
  //   stay non-user here to take the append branch, or the merge branch would
  //   widen the string itself before withCacheControl ever sees it — a
  //   different code path). cachedPrefixLength 3, marks [1, 2]; index 1 is the
  //   string-content message under test.
  it("widens a marked non-tail message's raw string content before marking it", () => {
    const h: ApiMessage[] = [
      { role: "user", content: [{ type: "text", text: "u0" }] },
      { role: "user", content: "raw string" },
      { role: "assistant", content: [{ type: "text", text: "a2" }] },
    ];
    const out = buildWireMessages(h, "CTX");
    expect(out.cachedPrefixLength).toBe(3);
    const marked = out.messages[1].content;
    expect(Array.isArray(marked)).toBe(true);
    const blocks = marked as ContentBlock[];
    expect(blocks[blocks.length - 1]).toHaveProperty("cache_control");
  });
});

describe("checkpointMarks (observed through buildWireMessages, not exported)", () => {
  // Every history message is `assistant` so the tail is never `role: "user"`
  // — buildWireMessages always takes the append branch, so
  // `cachedPrefixLength === n` exactly, for every n including 0. That gives
  // direct control over the value `checkpointMarks` sees, which `hist()`
  // above (alternating roles, sometimes hitting the merge branch) does not.
  const assistantOnly = (n: number): ApiMessage[] =>
    Array.from({ length: n }, (_, i) => ({
      role: "assistant" as const,
      content: [{ type: "text" as const, text: `m${i}` }],
    }));

  const markedIndices = (messages: ApiMessage[], upTo: number): number[] => {
    const idxs: number[] = [];
    for (let i = 0; i < upTo; i++) {
      const content = messages[i].content;
      const blocks = typeof content === "string" ? [] : content;
      const last = blocks[blocks.length - 1];
      if (last && "cache_control" in last) idxs.push(i);
    }
    return idxs;
  };

  // ★★★ THIS TABLE IS THE MUTATION-PROOF DETECTOR for both halves of
  // `checkpointMarks`, but the two mutants are caught by DIFFERENT rows, and
  // neither mutant is caught by all of them. On the "distinct" rows (3, 5, 6,
  // 7, 9, 10) anchor and boundary land on different indices: dropping the
  // BOUNDARY half loses the row's second entry there, and dropping the ANCHOR
  // half loses its first — each mutation turns every one of those six rows
  // red. On the "coincide" rows (1, 2, 4, 8) anchor and boundary are the SAME
  // index (verified by hand-simulation, not just asserted): dropping either
  // half still leaves that one shared index marked, so those four rows catch
  // NEITHER mutant. Consequently the distinct rows are load-bearing for BOTH
  // mutants and must not be trimmed as redundant with the coincide rows; the
  // coincide rows are kept as plain regression coverage of the power-of-two
  // boundary, and pin nothing else.
  // ★★★ IN PARTICULAR THEY DO NOT PIN THE DEDUPLICATION, and an earlier
  // revision of THIS comment claimed they did — a false claim written while
  // correcting a different false claim in the same lines. Dedup is
  // UNOBSERVABLE through `buildWireMessages` at every row: `withCacheControl`
  // is idempotent at a given index, and `markedIndices` below collects
  // POSITIONS, not markers, so an un-deduplicated `[anchor, boundary]` on a
  // coincide row applies the same mark twice to the same block and yields a
  // byte-identical wire. Measured over L=0..10, not reasoned — every row is
  // IDENTICAL between the real function and a no-dedup mutant. The
  // `marks.length <= MAX_MESSAGE_BREAKPOINTS` assertions do not see it either;
  // they count `cache_control` occurrences, which is 1 either way. Nothing in
  // this file detects a dedup regression — do not add a sentence saying
  // otherwise without a mutant that actually goes red.
  it.each<[number, number[]]>([
    [0, []],
    [1, [0]],
    [2, [1]],
    [3, [1, 2]],
    [4, [3]],
    [5, [3, 4]],
    [6, [3, 5]],
    [7, [3, 6]],
    [8, [7]],
    [9, [7, 8]],
    [10, [7, 9]],
  ])("cachedPrefixLength %i -> marks at %j", (n, expected) => {
    const out = buildWireMessages(assistantOnly(n), "CTX");
    expect(out.cachedPrefixLength).toBe(n);
    expect(markedIndices(out.messages, out.cachedPrefixLength)).toEqual(expected);
  });
});

describe("content stability across growth", () => {
  // ★★★ MARKER-STABILITY IS NOT REQUIRED — only CONTENT-stability is. See the
  // file header on chat-cache-layout.ts: Anthropic's own guidance says a
  // moving marker is not an invalidator ("earlier breakpoints remain valid
  // read points"; "the moving marker... is not an invalidator"), and this
  // file previously shipped a rewrite based on the OPPOSITE, wrong reading of
  // a marker-inclusive `.toEqual`. Do not add `cache_control` back into a
  // stability comparison — strip it first, as below.
  function stripCacheControl(messages: ApiMessage[]): ApiMessage[] {
    const stripBlock = (b: ContentBlock): ContentBlock => {
      if (!("cache_control" in b)) return b;
      const clone: Record<string, unknown> = { ...b };
      delete clone.cache_control;
      return clone as ContentBlock;
    };
    return messages.map((m) =>
      typeof m.content === "string" ? m : { ...m, content: m.content.map(stripBlock) },
    ) as ApiMessage[];
  }

  // Sweeps every cachedPrefixLength from 0 to 40 (crossing every
  // power-of-two boundary up to 32) via +2 growth steps, checking BOTH that
  // the content-only prefix never rewrites AND that the breakpoint budget is
  // never exceeded — this replaces the runtime `throw` chat-cache-layout.ts
  // used to carry for the budget half.
  it.each(Array.from({ length: 41 }, (_, n) => n))(
    "n=%i -> n+2: content-stable prefix, budget respected",
    (n) => {
      const before = buildWireMessages(hist(n), "CTX-A");
      const after = buildWireMessages(hist(n + 2), "CTX-B");
      expect(stripCacheControl(after.messages.slice(0, before.cachedPrefixLength))).toEqual(
        stripCacheControl(before.messages.slice(0, before.cachedPrefixLength)),
      );
      const marks = JSON.stringify(after.messages).match(/cache_control/g) ?? [];
      expect(marks.length).toBeLessThanOrEqual(MAX_MESSAGE_BREAKPOINTS);
    },
  );

  // A few larger pairs, each straddling a doubling boundary, so the sweep
  // above (which only reaches 32) isn't the only crossing exercised.
  it.each<[number, number]>([
    [1000, 1002],
    [2047, 2049], // straddles 2048
    [4095, 4097], // straddles 4096
  ])("n=%i -> n+2 stays content-stable and in budget at larger scale", (n, n2) => {
    const before = buildWireMessages(hist(n), "CTX-A");
    const after = buildWireMessages(hist(n2), "CTX-B");
    expect(stripCacheControl(after.messages.slice(0, before.cachedPrefixLength))).toEqual(
      stripCacheControl(before.messages.slice(0, before.cachedPrefixLength)),
    );
    const marks = JSON.stringify(after.messages).match(/cache_control/g) ?? [];
    expect(marks.length).toBeLessThanOrEqual(MAX_MESSAGE_BREAKPOINTS);
  });
});
