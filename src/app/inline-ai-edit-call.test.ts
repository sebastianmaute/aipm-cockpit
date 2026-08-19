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

  // ★★★ THE SNAPSHOT SPREAD CARRIES EVERY FIELD IT IS NOT ASKED ABOUT. The
  // digest strip above was written as `{ ...snapshot, viewDigest: undefined }`,
  // so `activitySummary` — added to the snapshot by a much later slice — rode
  // straight through it, and every single-shot edit prompt ended with "Use
  // search_history to read them." Same shape as the digest defect and a strictly
  // worse consequence: inline edit has NO agentic loop, so a `search_history`
  // tool_use can never be answered, and `use-inline-entity-edit.ts` matches only
  // update/create/delete blocks — a searching model therefore yields an EMPTY
  // plan, i.e. an edit that silently does nothing.
  describe("search_history cannot be reached from this single-shot path", () => {
    const emptyResponse: Awaited<ReturnType<typeof chatApi.callClaude>> = {
      content: [],
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0 },
    };
    const withActivity = {
      ...snapshot,
      currentView: "activity" as const,
      activitySummary: {
        total: 4,
        byActor: { user: 4, ai: 0, integration: 0, unknown: 0 },
        latestAt: "2026-07-03T09:00:00.000Z",
        days: 7,
      },
    };
    async function callWith(snap: InlineEditArgs["snapshot"]) {
      const spy = vi.spyOn(chatApi, "callClaude").mockResolvedValue(emptyResponse);
      await callInlineEdit({
        apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x", lang: "en-US",
        entity: "task", item, itemLabel: "Fix login bug", instruction: "mark done",
        snapshot: snap, guides: [], groundInGuides: false,
      });
      return spy;
    }

    // ★★ THE CONTROL FOR THE TWO NEGATIVES BELOW, and it has to be built the
    //    hard way: assert that this very fixture DOES produce a recap through
    //    the chat path. Without it, both negatives pass against a fixture whose
    //    `activitySummary` was never renderable in the first place — the exact
    //    vacuity a "nothing happened" assertion invites.
    it("CONTROL: the same snapshot does produce a recap on the chat path", () => {
      const chatText = chatApi
        .buildSystemPrompt("en-US", withActivity, [], false, {})
        .map((b) => b.text)
        .join("\n");
      expect(chatText).toContain("Recent project activity: 4 changes");
      expect(chatText).toContain("Use search_history to read them.");
    });

    it("strips the activity recap, so nothing instructs the model to search", async () => {
      const spy = await callWith(withActivity);
      const systemText = spy.mock.calls[0][2].map((b) => b.text).join("\n");
      expect(systemText).not.toContain("Recent project activity");
      expect(systemText).not.toContain("search_history");
      // Same control as the digest test: prove buildSystemPrompt still ran.
      expect(systemText).toContain("VIEW SCOPE");
      expect(systemText).toContain("Today is 2026-07-03");
    });

    // ★★★ AND THE TOOL ITSELF IS GONE, unconditionally. Suppressing the
    // sentence while still OFFERING the tool leaves the trap armed for any
    // instruction that invites a look backwards ("put this back the way it was
    // last week"). The flags are passed literally — this must NOT track
    // `settings.ai`, so there is no argument to vary here.
    // ★★ READ BY NAME, never positionally: both flags are `boolean | undefined`,
    //    so an assertion on "the false one" cannot tell a transposition apart.
    it("passes both recall flags off to callClaude", async () => {
      const spy = await callWith(withActivity);
      const flags = spy.mock.calls[0][4];
      expect(flags.historySearch).toBe(false);
      expect(flags.chatSearch).toBe(false);
    });

    // ★ The unconditional claim, from the other end: a snapshot with NO activity
    //   at all must reach the wire the same way.
    it("passes them off even when the snapshot carries no activity", async () => {
      const spy = await callWith(snapshot);
      const flags = spy.mock.calls[0][4];
      expect(flags.historySearch).toBe(false);
      expect(flags.chatSearch).toBe(false);
    });
  });

  // ★★★ THE SAME SPREAD, A THIRD TIME. `chatPointer` joined the snapshot in a
  // later slice and rode straight through a strip list that named only
  // `viewDigest` and `activitySummary`. Milder than the recap — the closing
  // "Use search_chats to read them." is already suppressed by NO_RECALL_TOOLS —
  // but what survives names past conversations the model has no tool to open.
  describe("the chat pointer cannot be acted on from this single-shot path", () => {
    const emptyResponse: Awaited<ReturnType<typeof chatApi.callClaude>> = {
      content: [],
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0 },
    };
    const withPointer = {
      ...snapshot,
      chatPointer: {
        count: 2,
        recent: [{ title: "Budget rework thread", at: "2026-07-02T10:00:00.000Z" }],
      },
    };

    // ★★ THE CONTROL, built the same hard way as the recap's above: prove this
    //    very fixture DOES render a pointer through the chat path. Without it
    //    the negatives below pass against a fixture that never produced the
    //    sentence — and stay green with `buildChatPointerBlock` deleted outright.
    it("CONTROL: the same snapshot does produce a pointer on the chat path", () => {
      const chatText = chatApi
        .buildSystemPrompt("en-US", withPointer, [], false, {})
        .map((b) => b.text)
        .join("\n");
      expect(chatText).toContain("There are 2 earlier conversations in this project");
      expect(chatText).toContain("Budget rework thread");
      expect(chatText).toContain("Use search_chats to read them.");
    });

    it("strips the chat pointer, so no past conversation is named", async () => {
      const spy = vi.spyOn(chatApi, "callClaude").mockResolvedValue(emptyResponse);
      await callInlineEdit({
        apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x", lang: "en-US",
        entity: "task", item, itemLabel: "Fix login bug", instruction: "mark done",
        snapshot: withPointer, guides: [], groundInGuides: false,
      });
      const systemText = spy.mock.calls[0][2].map((b) => b.text).join("\n");
      expect(systemText).not.toContain("earlier conversations in this project");
      expect(systemText).not.toContain("Budget rework thread");
      // Same control as the digest/recap tests: prove buildSystemPrompt still ran.
      expect(systemText).toContain("VIEW SCOPE");
      expect(systemText).toContain("Today is 2026-07-03");
    });
  });
});
