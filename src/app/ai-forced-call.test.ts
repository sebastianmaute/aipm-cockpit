import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runForcedToolCall } from "./ai-forced-call";
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
