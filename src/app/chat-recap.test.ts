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
