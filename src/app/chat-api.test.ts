import { describe, it, expect } from "vitest";
import {
  closeDanglingToolUses,
  maxOutputTokensFor,
  type ApiMessage,
  type ToolResultBlock,
} from "./chat-api";

describe("maxOutputTokensFor", () => {
  it("floors the legacy Claude 3.0 trio at 4096 (their hard cap)", () => {
    expect(maxOutputTokensFor("claude-3-haiku-20240307")).toBe(4096);
    expect(maxOutputTokensFor("claude-3-opus-20240229")).toBe(4096);
    expect(maxOutputTokensFor("claude-3-sonnet-20240229")).toBe(4096);
  });
  it("uses 8192 for 3.5+/4.x and unknown/future models", () => {
    expect(maxOutputTokensFor("claude-3-5-sonnet-20241022")).toBe(8192);
    expect(maxOutputTokensFor("claude-3-7-sonnet-20250219")).toBe(8192);
    expect(maxOutputTokensFor("claude-sonnet-4")).toBe(8192);
    expect(maxOutputTokensFor("claude-opus-4-8")).toBe(8192);
    expect(maxOutputTokensFor("claude-haiku-4-5-20251001")).toBe(8192);
    expect(maxOutputTokensFor("claude-something-new")).toBe(8192);
  });
});

// A conversation is invalid to the Anthropic API when an assistant message with
// `tool_use` blocks is not immediately followed by a user message carrying a
// `tool_result` for each id (400 invalid_request_error). This happens when a
// turn is truncated at max_tokens mid-tool-use, or the user stops mid-turn, so
// the tool loop never ran/appended the results. closeDanglingToolUses repairs
// history by injecting synthetic (is_error) tool_result blocks.

const toolUseMsg = (ids: string[]): ApiMessage => ({
  role: "assistant",
  content: ids.map((id) => ({ type: "tool_use" as const, id, name: "create_task", input: {} })),
});

const resultsOf = (msg: ApiMessage | undefined): ToolResultBlock[] =>
  msg?.role === "user" && Array.isArray(msg.content)
    ? (msg.content.filter((b) => (b as ToolResultBlock).type === "tool_result") as ToolResultBlock[])
    : [];

describe("closeDanglingToolUses", () => {
  it("inserts a synthetic tool_result when a tool_use is followed by a user text turn", () => {
    const input: ApiMessage[] = [
      { role: "user", content: "create tasks" },
      toolUseMsg(["a1"]),
      { role: "user", content: "why no output?" },
    ];
    const out = closeDanglingToolUses(input);
    expect(out).toHaveLength(4);
    // The injected carrier sits immediately after the assistant tool_use.
    const carrier = resultsOf(out[2]);
    expect(carrier).toHaveLength(1);
    expect(carrier[0].tool_use_id).toBe("a1");
    expect(carrier[0].is_error).toBe(true);
    // The user's follow-up text is preserved, now at the end.
    expect(out[3]).toEqual({ role: "user", content: "why no output?" });
  });

  it("appends a synthetic carrier when the tool_use is the last message", () => {
    const input: ApiMessage[] = [{ role: "user", content: "go" }, toolUseMsg(["x1", "x2"])];
    const out = closeDanglingToolUses(input);
    expect(out).toHaveLength(3);
    const ids = resultsOf(out[2]).map((r) => r.tool_use_id);
    expect(ids).toEqual(["x1", "x2"]);
  });

  it("leaves a well-formed tool_use → tool_result pair unchanged", () => {
    const input: ApiMessage[] = [
      { role: "user", content: "go" },
      toolUseMsg(["ok1"]),
      { role: "user", content: [{ type: "tool_result", tool_use_id: "ok1", content: "done" }] },
    ];
    expect(closeDanglingToolUses(input)).toEqual(input);
  });

  it("merges missing results into a partial carrier instead of splitting across two user turns", () => {
    // Defensive: the current tool loop is all-or-nothing, but as an exported
    // helper it must still heal a partial carrier into ONE user message that
    // covers every id (not assistant → user(B) → user(A), which stays invalid).
    const input: ApiMessage[] = [
      { role: "user", content: "go" },
      toolUseMsg(["a", "b"]),
      { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "done" }] },
    ];
    const out = closeDanglingToolUses(input);
    expect(out).toHaveLength(3); // no extra message inserted
    const ids = resultsOf(out[2]).map((r) => r.tool_use_id).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("is an identity for histories with no tool_use blocks", () => {
    const input: ApiMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
    ];
    expect(closeDanglingToolUses(input)).toEqual(input);
  });
});
