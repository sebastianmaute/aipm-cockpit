import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runForcedToolCall, runForcedToolCallWithStop } from "./ai-forced-call";
import { AiHttpError } from "./ai-errors";
import { __resetAiKeyStatusForTests, getAiKeyStatus } from "./ai-key-status";

const KEY = "sk-ant-api03-ForcedCallKey000000000";

function args() {
  return {
    apiKey: KEY,
    model: "claude-sonnet-5",
    tools: [],
    toolName: "t",
    messages: [],
    maxTokens: 10,
  };
}

function stubReply(stopReason: string | undefined) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ stop_reason: stopReason, content: [{ type: "tool_use", name: "t", input: { a: 1 } }] }),
  }));
}

function stubStatus(status: number) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => (status === 200
      ? { content: [{ type: "tool_use", name: "t", input: { a: 1 } }] }
      : { error: { type: "authentication_error", message: "invalid x-api-key" } }),
  }));
}

beforeEach(() => __resetAiKeyStatusForTests());
afterEach(() => vi.unstubAllGlobals());

describe("runForcedToolCallWithStop — the reply's stop reason beside the input", () => {
  it("returns the input and the stop reason", async () => {
    stubReply("max_tokens");
    await expect(runForcedToolCallWithStop(args())).resolves.toEqual({ input: { a: 1 }, stopReason: "max_tokens" });
    stubReply("tool_use");
    await expect(runForcedToolCallWithStop(args())).resolves.toEqual({ input: { a: 1 }, stopReason: "tool_use" });
  });

  it("reports an absent stop reason as undefined, and runForcedToolCall still returns the input alone", async () => {
    stubReply(undefined);
    await expect(runForcedToolCallWithStop(args())).resolves.toEqual({ input: { a: 1 }, stopReason: undefined });
    stubReply("max_tokens");
    await expect(runForcedToolCall(args())).resolves.toEqual({ a: 1 });
  });
});

describe("runForcedToolCall — §650 reports the key verdict at the envelope", () => {
  it.each([
    [401, "rejected"],
    [403, "forbidden"],
  ] as const)("a %i reports %s", async (status, expected) => {
    stubStatus(status);
    await expect(runForcedToolCall(args())).rejects.toBeInstanceOf(AiHttpError);
    expect(getAiKeyStatus()).toBe(expected);
  });

  it("a 200 reports ok", async () => {
    stubStatus(403);
    await expect(runForcedToolCall(args())).rejects.toBeInstanceOf(AiHttpError);
    stubStatus(200);
    await expect(runForcedToolCall(args())).resolves.toEqual({ a: 1 });
    expect(getAiKeyStatus()).toBe("ok");
  });

  it("a 500 or a network failure leaves the verdict unchanged", async () => {
    stubStatus(401);
    await expect(runForcedToolCall(args())).rejects.toBeInstanceOf(AiHttpError);
    stubStatus(500);
    await expect(runForcedToolCall(args())).rejects.toBeInstanceOf(AiHttpError);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(runForcedToolCall(args())).rejects.toBeInstanceOf(TypeError);
    expect(getAiKeyStatus()).toBe("rejected");
  });
});
