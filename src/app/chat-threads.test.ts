// src/app/chat-threads.test.ts
import { describe, it, expect, vi } from "vitest";
import { deriveThreadName, stripAttachmentsForPersistence, newThreadId, THREAD_NAME_MAX } from "./chat-threads";
import type { ApiMessage, DisplayItem } from "./chat-api";

describe("deriveThreadName", () => {
  it("returns the first user message, trimmed", () => {
    const display: DisplayItem[] = [{ kind: "user", text: "  Plan Q1 budget review  " }];
    expect(deriveThreadName(display)).toBe("Plan Q1 budget review");
  });

  it("returns '' when there is no user message yet", () => {
    expect(deriveThreadName([])).toBe("");
    expect(deriveThreadName([{ kind: "notice", text: "x" }])).toBe("");
  });

  it("ignores a later user message and only takes the first one", () => {
    const display: DisplayItem[] = [
      { kind: "user", text: "first" },
      { kind: "assistant", text: "reply" },
      { kind: "user", text: "second" },
    ];
    expect(deriveThreadName(display)).toBe("first");
  });

  it("truncates by code point, not UTF-16 unit, past THREAD_NAME_MAX", () => {
    // Each target emoji is 2 UTF-16 code units but 1 code point — a naive .slice(0, N)
    // on the raw string would split one in half and corrupt it.
    const long = "\u{1F3AF}".repeat(THREAD_NAME_MAX + 5);
    const name = deriveThreadName([{ kind: "user", text: long }]);
    expect(Array.from(name.replace(/…$/, "")).length).toBe(THREAD_NAME_MAX);
    expect(name.endsWith("…")).toBe(true);
  });

  it("does not truncate a message at or under the cap", () => {
    const exact = "x".repeat(THREAD_NAME_MAX);
    expect(deriveThreadName([{ kind: "user", text: exact }])).toBe(exact);
  });
});

describe("stripAttachmentsForPersistence", () => {
  it("replaces image/document blocks with text placeholders", () => {
    const history: ApiMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "see attached" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: "BBBB" } },
        ],
      },
    ];
    expect(stripAttachmentsForPersistence(history)).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "see attached" },
          { type: "text", text: "[attachment: image]" },
          { type: "text", text: "[attachment: document]" },
        ],
      },
    ]);
  });

  it("leaves string content and non-attachment blocks untouched", () => {
    const history: ApiMessage[] = [
      { role: "user", content: "plain text" },
      { role: "assistant", content: [{ type: "text", text: "reply" }] },
    ];
    expect(stripAttachmentsForPersistence(history)).toEqual(history);
  });

  it("leaves tool_use and tool_result blocks untouched", () => {
    const history: ApiMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check that." },
          { type: "tool_use", id: "toolu_01", name: "list_tasks", input: { status: "open" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_01", content: "[]", is_error: false }],
      },
    ];
    expect(stripAttachmentsForPersistence(history)).toEqual(history);
  });
});

describe("newThreadId", () => {
  it("returns a non-empty, unique string each call", () => {
    const a = newThreadId();
    const b = newThreadId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("falls back to a timestamped random id when crypto.randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    try {
      const id = newThreadId();
      expect(id).toMatch(/^thread-\d+-[a-z0-9]+$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
