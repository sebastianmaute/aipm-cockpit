import { describe, it, expect, vi, afterEach } from "vitest";
import { asTimeZoneForTests } from "./timezone";
import * as chatApi from "./chat-api";
import { callInlineEdit, type InlineEditArgs } from "./inline-ai-edit-call";

afterEach(() => vi.restoreAllMocks());

const item: InlineEditArgs["item"] = {
  id: 42,
  taskName: "Fix login bug",
  status: "To Do",
};

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
  timezone: asTimeZoneForTests("UTC"),
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
      entity: "task", item, itemLabel: "Fix login bug", instruction: "mark done", snapshot, guides: [], groundInGuides: false,
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
    await callInlineEdit({ apiKey: "sk-ant-secret000000000000", model: "claude-y", lang: "en-US", entity: "task", item, itemLabel: "x", instruction: "x", snapshot, guides: [], groundInGuides: false });
    expect(spy.mock.calls[0][0]).toBe("sk-ant-secret000000000000");
    expect(spy.mock.calls[0][1]).toBe("claude-y");
  });

  // Inline edit reuses the CHAT dispatcher's snapshot, so it inherits whatever
  // `getSnapshot()` puts on it — including the VIEW STATE digest, which lists
  // NEIGHBOURING rows of the surface the editor was opened from. Handing those
  // to a mutation planner contradicts the scope block's "Do NOT update or
  // delete any OTHER item", so `callInlineEdit` blanks `viewDigest`.
  it("strips the view digest, so no OTHER item's rows reach the mutation planner", async () => {
    const response: Awaited<ReturnType<typeof chatApi.callClaude>> = {
      content: [],
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0 },
    };
    const spy = vi.spyOn(chatApi, "callClaude").mockResolvedValue(response);
    await callInlineEdit({
      apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x", lang: "en-US",
      entity: "task", item, itemLabel: "Fix login bug", instruction: "mark done",
      snapshot: {
        ...snapshot,
        viewDigest:
          "12 task(s) visible in the table.\nVisible rows: #7 Somebody else's task [To Do]",
      },
      guides: [], groundInGuides: false,
    });
    const systemText = spy.mock.calls[0][2].map((b) => b.text).join("\n");
    expect(systemText).not.toContain("VIEW STATE");
    expect(systemText).not.toContain("Somebody else's task");
    // CONTROL: the two negatives above would also pass against an EMPTY system
    // prompt, so assert something only buildSystemPrompt can emit. ★ It must NOT
    // be `itemLabel` ("Fix login bug"): that comes from scopeBlock(), which
    // callInlineEdit appends independently of buildSystemPrompt — so it stays
    // present even if buildSystemPrompt returns [], and controls for nothing.
    expect(systemText).toContain("VIEW SCOPE");
    expect(systemText).toContain("Today is 2026-07-03");
  });
});
