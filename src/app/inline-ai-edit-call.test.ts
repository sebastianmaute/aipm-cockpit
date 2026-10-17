import { describe, it, expect, vi, afterEach } from "vitest";
import { asTimeZoneForTests } from "./timezone";
import * as chatApi from "./chat-api";
import { callInlineEdit, type InlineEditArgs } from "./inline-ai-edit-call";
import { PLANNABLE_TOOL_NAMES } from "./inline-ai-edit/plan";
import { VIEW_AI_SCOPE } from "./view-ai-scope";
import { buildViewScopeBlock } from "./view-ai-scope-block";
import type { AppView } from "./nav-config";

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
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    };
    vi.spyOn(chatApi, "callClaude").mockResolvedValue(response);
    const r = await callInlineEdit({
      apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x", lang: "en-US",
      entity: "task", item, itemLabel: "Fix login bug", instruction: "mark done", snapshot, guides: [], groundInGuides: false,
    });
    expect(r.blocks.map((b) => b.name)).toEqual(["update_task"]);
    expect(r.text).toContain("Sure");
    expect(r.usage).toEqual({ input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
  });

  it("propagates the api key + model to callClaude and never returns them", async () => {
    const response: Awaited<ReturnType<typeof chatApi.callClaude>> = {
      content: [],
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
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
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    };
    const spy = vi.spyOn(chatApi, "callClaude").mockResolvedValue(response);
    await callInlineEdit({
      apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x", lang: "en-US",
      entity: "task", item, itemLabel: "Fix login bug", instruction: "mark done",
      snapshot: {
        ...snapshot,
        viewDigest:
          "12 tasks visible as rows in the table.\nVisible rows: #7 Somebody else's task [To Do]",
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
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
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
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
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

// §701 — the guides that target inline edit arrive as ready text and are
// appended after the scope block; without it the system blocks are unchanged.
describe("callInlineEdit guide text", () => {
  const empty: Awaited<ReturnType<typeof chatApi.callClaude>> = {
    content: [],
    stop_reason: "end_turn",
    usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  };
  async function systemBlocks(guideText?: string) {
    const spy = vi.spyOn(chatApi, "callClaude").mockResolvedValue(empty);
    await callInlineEdit({
      apiKey: "sk-ant-xxxxxxxxxxxxxxxx", model: "claude-x", lang: "en-US",
      entity: "task", item, itemLabel: "Fix login bug", instruction: "mark done",
      snapshot, guides: [], groundInGuides: true, guideText,
    });
    return spy.mock.calls[0][2] as { text: string }[];
  }
  it("appends the guide text as the last block, after the scope block", async () => {
    const without = await systemBlocks();
    vi.restoreAllMocks();
    const withText = await systemBlocks("INLINE-MARK");
    expect(withText).toHaveLength(without.length + 1);
    expect(withText[withText.length - 1].text).toBe("INLINE-MARK");
    expect(withText[withText.length - 2].text).toMatch(/INLINE EDIT MODE/);
  });
  it("adds no block for empty guide text", async () => {
    const without = await systemBlocks();
    vi.restoreAllMocks();
    expect(await systemBlocks("")).toHaveLength(without.length);
  });
});

// §715 D1 — this path is single-shot: a READ tool call (list_milestones, get_task…) can never be
// answered, and the plan matches only update/create/delete tools, so a model that looks first yields an
// empty plan ("No changes to apply"). Measured live: a milestone description edit answered list_milestones.
describe("the tools an inline edit offers (§715 D1)", () => {
  it("are exactly the tools its plan can act on", async () => {
    const empty: Awaited<ReturnType<typeof chatApi.callClaude>> = { content: [], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } };
    const spy = vi.spyOn(chatApi, "callClaude").mockResolvedValue(empty);
    await callInlineEdit({ apiKey: "k", model: "m", lang: "en-US", entity: "milestone", item: { id: 5, name: "MVP target" }, itemLabel: "MVP target", instruction: "x", snapshot, guides: [], groundInGuides: false });
    const tools = spy.mock.calls[0][6] as { name: string }[] | undefined;
    expect(tools, "a tool list is passed").toBeDefined();
    const names = tools!.map((t) => t.name);
    expect(names.filter((n) => !PLANNABLE_TOOL_NAMES.has(n))).toEqual([]);
    expect(names).toEqual(expect.arrayContaining(["update_milestone", "update_raid_item", "update_task", "create_task"]));
    expect(names.some((n) => /^(list_|get_|search_)/.test(n))).toBe(false);
  });
});

// The prompt must advertise only what the request carries: a view's "Relevant tools here" naming
// list_milestones invites the exact unanswerable call the narrowed list exists to prevent.
describe("the tools an inline edit's prompt names (§715 D1)", () => {
  it("are tools the request carries, on every view", async () => {
    const empty: Awaited<ReturnType<typeof chatApi.callClaude>> = { content: [], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } };
    const spy = vi.spyOn(chatApi, "callClaude").mockResolvedValue(empty);
    const views = Object.keys(VIEW_AI_SCOPE) as AppView[];
    // Positive control: the regex below matches the line the block emits when a hint DOES survive, so
    // a reworded line fails here instead of passing the loop by absence (no plannable tool is hinted on
    // any view today, so after the narrowing the loop alone never sees the line).
    expect(/Relevant tools here: ([^\n]*)\./.exec(buildViewScopeBlock("milestones", chatApi.toolNamesFor({})))?.[1]).toContain("list_milestones");
    for (const currentView of views) {
      spy.mockClear();
      await callInlineEdit({ apiKey: "k", model: "m", lang: "en-US", entity: "milestone", item: { id: 5, name: "MVP target" }, itemLabel: "MVP target", instruction: "x", snapshot: { ...snapshot, currentView }, guides: [], groundInGuides: false });
      const carried = new Set((spy.mock.calls[0][6] as { name: string }[]).map((t) => t.name));
      const text = chatApi.systemBlocksText(spy.mock.calls[0][2]);
      // Control: the view scope block itself still ran for this view.
      expect(text, currentView).toContain(`VIEW SCOPE — the user is looking at the "${currentView}" view.`);
      const line = /Relevant tools here: ([^\n]*)\./.exec(text);
      const named = line ? line[1].split(", ") : [];
      expect(named.filter((n) => !carried.has(n)), currentView).toEqual([]);
      // The line names exactly the hints that survive the narrowing.
      const surviving = (VIEW_AI_SCOPE[currentView].toolHints ?? []).filter((h) => carried.has(h));
      expect(named, currentView).toEqual(surviving);
    }
  });
});

// Guidance the inline path cannot filter (the stable prompt's "call the matching list_ tool", a view's
// `reading`) still names read tools; the scope block, which the model reads last, says they are absent.
describe("the inline scope block (§715 D1)", () => {
  it("says the request carries no read tools", async () => {
    const empty: Awaited<ReturnType<typeof chatApi.callClaude>> = { content: [], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } };
    const spy = vi.spyOn(chatApi, "callClaude").mockResolvedValue(empty);
    await callInlineEdit({ apiKey: "k", model: "m", lang: "en-US", entity: "milestone", item: { id: 5, name: "MVP target" }, itemLabel: "MVP target", instruction: "x", snapshot, guides: [], groundInGuides: false });
    const system = spy.mock.calls[0][2];
    const scope = system.find((b) => b.text.startsWith("INLINE EDIT MODE."));
    expect(scope?.text).toContain("This request carries no read tools");
  });
});

describe("toolsNamed (§715 D1)", () => {
  it("keeps only the named tools, one array per set, with one cache breakpoint", () => {
    const wanted = new Set(["update_task", "update_milestone"]);
    const a = chatApi.toolsNamed(wanted);
    expect(a.map((t) => t.name).sort()).toEqual(["update_milestone", "update_task"]);
    expect(chatApi.toolsNamed(new Set(wanted))).toBe(a);
    expect(a.filter((t) => "cache_control" in t)).toHaveLength(1);
  });
});
