import { describe, expect, it } from "vitest";
import { AI_FEATURES, aiOrigin, chatSendOrigins, isKnownAiFeature, sanitizeAiOrigin } from "./activity-origin";

describe("aiOrigin", () => {
  it("builds a frozen origin without link keys when no link is given", () => {
    const o = aiOrigin("chat");
    expect(o).toEqual({ feature: "chat" });
    expect(Object.isFrozen(o)).toBe(true);
    expect(Object.hasOwn(o, "threadId")).toBe(false);
    expect(Object.hasOwn(o, "requestId")).toBe(false);
  });

  it("carries the link when given", () => {
    const o = aiOrigin("chat", { threadId: "t", requestId: "r" });
    expect(o).toEqual({ feature: "chat", threadId: "t", requestId: "r" });
    expect(Object.isFrozen(o)).toBe(true);
  });
});

describe("sanitizeAiOrigin", () => {
  it("keeps a bare feature", () => {
    expect(sanitizeAiOrigin({ feature: "chat" })).toEqual({ feature: "chat" });
  });

  it("returns a well-formed origin by reference", () => {
    const a = { feature: "chat" };
    const b = { feature: "chat", threadId: "t", requestId: "r" };
    expect(sanitizeAiOrigin(a)).toBe(a);
    expect(sanitizeAiOrigin(b)).toBe(b);
  });

  it("strips an unknown extra key, so no user-written string rides the origin", () => {
    expect(sanitizeAiOrigin({ feature: "chat", note: "x" })).toEqual({ feature: "chat" });
    expect(sanitizeAiOrigin({ feature: "chat", threadId: "t", requestId: "r", note: "x" })).toEqual({ feature: "chat", threadId: "t", requestId: "r" });
  });

  it("keeps a whole link", () => {
    expect(sanitizeAiOrigin({ feature: "chat", threadId: "t", requestId: "r" })).toEqual({ feature: "chat", threadId: "t", requestId: "r" });
  });

  it("drops a half link", () => {
    expect(sanitizeAiOrigin({ feature: "chat", threadId: "t" })).toEqual({ feature: "chat" });
    expect(sanitizeAiOrigin({ feature: "chat", requestId: "r" })).toEqual({ feature: "chat" });
    expect(sanitizeAiOrigin({ feature: "chat", threadId: "t", requestId: "" })).toEqual({ feature: "chat" });
    expect(sanitizeAiOrigin({ feature: "chat", threadId: "", requestId: "r" })).toEqual({ feature: "chat" });
    expect(sanitizeAiOrigin({ feature: "chat", threadId: 5, requestId: "r" })).toEqual({ feature: "chat" });
  });

  it("keeps an unknown string feature", () => {
    expect(sanitizeAiOrigin({ feature: "futureThing" })).toEqual({ feature: "futureThing" });
  });

  it("drops malformed values", () => {
    for (const v of [null, undefined, "chat", 3, [], {}, { feature: 3 }, { feature: "" }]) {
      expect(sanitizeAiOrigin(v)).toBeNull();
    }
  });
});

describe("isKnownAiFeature", () => {
  it("knows every listed feature", () => {
    for (const f of AI_FEATURES) expect(isKnownAiFeature(f)).toBe(true);
  });

  it("is own-property safe", () => {
    expect(isKnownAiFeature("toString")).toBe(false);
    expect(isKnownAiFeature("futureThing")).toBe(false);
  });
});

describe("chatSendOrigins (§799)", () => {
  it("links both origins to the thread and request in Turso mode", () => {
    const o = chatSendOrigins(true, "th1", "rq1");
    expect(o.chat).toEqual({ feature: "chat", threadId: "th1", requestId: "rq1" });
    expect(o.proposal).toEqual({ feature: "chatProposal", threadId: "th1", requestId: "rq1" });
  });

  it("carries no link in file mode, even with a thread id, nor without a thread", () => {
    for (const o of [chatSendOrigins(false, "th1", "rq1"), chatSendOrigins(true, null, "rq1")]) {
      expect(o.chat).toEqual({ feature: "chat" });
      expect(o.proposal).toEqual({ feature: "chatProposal" });
    }
  });
});
