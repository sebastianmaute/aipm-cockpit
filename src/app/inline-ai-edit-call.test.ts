import { describe, it, expect, vi, afterEach } from "vitest";
import * as chatApi from "./chat-api";
import { callInlineEdit, type InlineEditArgs } from "./inline-ai-edit-call";

afterEach(() => vi.restoreAllMocks());

const task = {
  id: 42,
  taskName: "Fix login bug",
  status: "To Do",
} as unknown as InlineEditArgs["task"];

const snapshot: InlineEditArgs["snapshot"] = {
  today: "2026-07-03",
  language: "en-US",
  holidayCountries: [],
  storageKind: "browser",
  taskCount: 1,
  knownGroups: [],
  knownLabels: [],
  mode: "advanced",
  enabledModules: [],
  currentView: "open-points",
};

describe("callInlineEdit", () => {
  it("returns tool_use blocks and text from a single callClaude response", async () => {
    const response: Awaited<ReturnType<typeof chatApi.callClaude>> = {
      content: [
        { type: "text", text: "Sure." },
        { type: "tool_use", id: "b1", name: "update_task", input: { id: 42, status: "Done" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    vi.spyOn(chatApi, "callClaude").mockResolvedValue(response);
    const r = await callInlineEdit({
      apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x", lang: "en-US",
      task, instruction: "mark done", snapshot, guides: [], groundInGuides: false,
    });
    expect(r.blocks.map((b) => b.name)).toEqual(["update_task"]);
    expect(r.text).toContain("Sure");
    expect(r.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  it("propagates the api key + model to callClaude and never returns them", async () => {
    const response: Awaited<ReturnType<typeof chatApi.callClaude>> = {
      content: [],
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0 },
    };
    const spy = vi.spyOn(chatApi, "callClaude").mockResolvedValue(response);
    await callInlineEdit({ apiKey: "sk-ant-secret000000000000", model: "claude-y", lang: "en-US", task, instruction: "x", snapshot, guides: [], groundInGuides: false });
    expect(spy.mock.calls[0][0]).toBe("sk-ant-secret000000000000");
    expect(spy.mock.calls[0][1]).toBe("claude-y");
  });
});
