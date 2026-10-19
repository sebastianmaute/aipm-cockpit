import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetToolChoiceFallbackForTests, runForcedToolCall, runForcedToolCallWithStop } from "./ai-forced-call";
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

describe("runForcedToolCall — a model that refuses a forced tool_choice", () => {
  const REFUSAL = {
    ok: false,
    status: 400,
    json: async () => ({ error: { type: "invalid_request_error", message: 'tool_choice: type "tool" and "any" are not supported for this model.' } }),
  };
  const TOOL_REPLY = {
    ok: true,
    status: 200,
    json: async () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "t", input: { a: 1 } }] }),
  };
  const choices = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.map((c: unknown[]) => (JSON.parse((c[1] as { body: string }).body) as { tool_choice: unknown }).tool_choice);

  beforeEach(() => __resetToolChoiceFallbackForTests());

  it("resends once with tool_choice auto and returns the tool input", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(REFUSAL).mockResolvedValueOnce(TOOL_REPLY);
    vi.stubGlobal("fetch", fetchMock);
    await expect(runForcedToolCall({ ...args(), model: "claude-sonnet-5-5" })).resolves.toEqual({ a: 1 });
    expect(choices(fetchMock)).toEqual([{ type: "tool", name: "t" }, { type: "auto" }]);
  });

  it("sends auto straight away for that model afterwards, and still forces the tool for other models", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(REFUSAL).mockResolvedValue(TOOL_REPLY);
    vi.stubGlobal("fetch", fetchMock);
    await runForcedToolCall({ ...args(), model: "claude-sonnet-5-5" });
    await runForcedToolCall({ ...args(), model: "claude-sonnet-5-5" });
    await runForcedToolCall({ ...args(), model: "claude-sonnet-5" });
    expect(choices(fetchMock)).toEqual([
      { type: "tool", name: "t" },
      { type: "auto" },
      { type: "auto" },
      { type: "tool", name: "t" },
    ]);
  });

  it("does not resend on any other 400", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { type: "invalid_request_error", message: "prompt is too long: 300000 tokens > 200000 maximum" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(runForcedToolCall(args())).rejects.toBeInstanceOf(AiHttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws parse when the auto reply carries no tool call", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(REFUSAL).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "hello" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(runForcedToolCall({ ...args(), model: "claude-sonnet-5-5" })).rejects.toThrow("parse");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
