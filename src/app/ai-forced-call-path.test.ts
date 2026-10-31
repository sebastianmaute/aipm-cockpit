import { describe, expect, it, vi } from "vitest";
import "../test/ai-consent-live";

const postAiMessages = vi.hoisted(() => vi.fn());
vi.mock("./ai-transport", async (orig) => ({ ...(await orig<typeof import("./ai-transport")>()), postAiMessages }));

import { runForcedToolCall } from "./ai-forced-call";

function call(level?: "interactive" | "background") {
  postAiMessages.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: "tool_use", name: "suggest_weights", input: { a: 1 } }] }),
  });
  return runForcedToolCall({
    privacy: { protected: false }, apiKey: "sk-ant-api03-PathKey0000000000000000", model: "claude-sonnet-5", tools: [],
    toolName: "suggest_weights", messages: [], maxTokens: 10, level,
  });
}

describe("the usage path of a forced call", () => {
  it("names the tool and the consent class", async () => {
    await call("background");
    expect(postAiMessages.mock.calls[0][0].path).toBe("suggest_weights:background");
  });

  it("defaults the class to interactive", async () => {
    postAiMessages.mockClear();
    await call();
    expect(postAiMessages.mock.calls[0][0].path).toBe("suggest_weights:interactive");
  });
});
