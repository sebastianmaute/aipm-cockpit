// src/app/inline-ai-edit-call.ts
//
// Non-hook single-shot call for the inline entity editor. Reuses callClaude
// (which already sends the tool defs + browser headers). NEVER logs/echoes the
// key or body; the caller reads only { blocks, text, usage }. No agentic loop.
import {
  buildSystemPrompt,
  callClaude,
  toolsNamed,
  type ApiUsage,
  type ContentBlock,
  type SystemBlock,
  type ToolFlags,
  type ToolUseBlock,
} from "./chat-api";

/** ★★ BOTH RECALL TOOLS OFF for the inline editor, spelled by NAME so the two
 *  same-typed flags cannot be transposed (§159). The inline path edits ONE item
 *  from a scoped prompt; searching prior chat history or prior threads is out of
 *  scope for it, and every tool it does not carry is schema it does not pay for
 *  on each keystroke-sized request. */
const NO_RECALL_TOOLS: ToolFlags = { historySearch: false, chatSearch: false };
import { type ToolDispatcher } from "./chat-tools";
import { type Lang } from "./i18n";
import { type OperatingGuide } from "./operating-guide";
import { type InlineEntity } from "./inline-ai-edit/entity-descriptor";
import { PLANNABLE_TOOL_NAMES } from "./inline-ai-edit/plan";

export interface InlineEditArgs {
  apiKey: string;
  model: string;
  lang: Lang;
  entity: InlineEntity;
  item: Record<string, unknown>;
  itemLabel: string;
  instruction: string;
  snapshot: ReturnType<ToolDispatcher["getSnapshot"]>;
  guides: readonly OperatingGuide[];
  groundInGuides: boolean;
  /** §701 — the guides that target inline edit, from `actionGuideText`;
   *  appended after the scope block. */
  guideText?: string;
  // ★★ NO `historySearch` FIELD, deliberately. It was here so the kill switch
  //    could reach a path billed for the tool schema like any other — but this
  //    path is single-shot, so `search_history` can only ever produce a failed
  //    edit and is now dropped unconditionally. See `callInlineEdit`. Do not
  //    re-add it: a caller passing `true` would be asking for the trap back.
  signal?: AbortSignal;
}

export interface InlineEditResult {
  blocks: ToolUseBlock[];
  text: string;
  usage: ApiUsage;
}

type InlineTools = ReturnType<typeof toolsNamed>;
let inlineToolsCache: InlineTools | null = null;

/** The plannable tools, without `expectedToken` (§715 D1). Its schema text says "REQUIRED. The token
 *  returned when you read this record", but this path has no read tools and the app stamps the
 *  stored row's token itself at apply (`use-inline-entity-edit.ts`). A model that follows the schema
 *  asks to read first, which ends in an empty plan. Built once: the set never changes. ★ So a test
 *  that mocks `toolsNamed` after the first inline call in its file never reaches this path. */
function inlineTools(): InlineTools {
  if (inlineToolsCache) return inlineToolsCache;
  inlineToolsCache = toolsNamed(PLANNABLE_TOOL_NAMES).map((def) => {
    const schema = def.input_schema as { properties?: Record<string, unknown>; required?: readonly string[] };
    if (!schema.properties || !("expectedToken" in schema.properties)) return def;
    const { expectedToken: _dropped, ...properties } = schema.properties;
    void _dropped;
    return {
      ...def,
      input_schema: {
        ...def.input_schema,
        properties,
        ...(schema.required ? { required: schema.required.filter((r) => r !== "expectedToken") } : {}),
      },
    };
  }) as InlineTools;
  return inlineToolsCache;
}

function scopeBlock(entity: InlineEntity, item: Record<string, unknown>, itemLabel: string): SystemBlock {
  const fields = JSON.stringify(item);
  return {
    type: "text",
    text:
      `INLINE EDIT MODE. You are editing exactly ONE ${entity} (below): ${itemLabel}. Use tool calls to ` +
      `make the user's requested change: the ${entity}'s update tool for this item's fields, and you may ` +
      "create related items (create_task / create_raid_item / create_change / " +
      "create_milestone / create_stakeholder) when asked. Do NOT update or delete any OTHER item. Do NOT " +
      "chat or explain unless you cannot proceed without more detail. This request carries no read tools " +
      "(no list_, get_ or search_ calls), whatever any other guidance says: the target's fields are " +
      `below, so act on them directly. Target ${entity}:\n` +
      fields,
  };
}

export async function callInlineEdit(args: InlineEditArgs): Promise<InlineEditResult> {
  // ★★ STRIP THE VIEW DIGEST. Inline edit does NOT build its own snapshot — it
  // reuses the chat dispatcher's (`use-inline-entity-edit.ts` calls the same
  // `dispatcher.getSnapshot()`), so without this it inherits the VIEW STATE
  // block describing the surface the editor was opened from. Two reasons that
  // is wrong, and the second is the serious one:
  //   1. It restates content the editor already has — `scopeBlock` below hands
  //      the model the target entity's own fields verbatim.
  //   2. Inline edit PLANS MUTATIONS. Opened from Open Points, the digest lists
  //      up to 15 NEIGHBOURING task rows, ids and all, directly contradicting
  //      the scope block's "Do NOT update or delete any OTHER item".
  // ★★★ STRIP THE ACTIVITY SUMMARY FOR THE SAME REASON, ONE STEP FURTHER. The
  // spread above carries every OTHER snapshot field, so `activitySummary`
  // survived it and `buildActivityRecapBlock` rendered "…Use search_history to
  // read them." into every single-shot edit prompt. That is not merely surplus:
  // this path has NO agentic loop, so a `search_history` tool_use can never be
  // answered, and `use-inline-entity-edit.ts` matches only the update/create/
  // delete tools — a searching model therefore yields an EMPTY plan, i.e. an
  // edit that silently does nothing. An instruction to call it is an
  // instruction to fail.
  // ★★★ AND THE CHAT POINTER, WHICH IS THE SAME SPREAD BUG A THIRD TIME:
  // `chatPointer` joined the snapshot in a later slice and rode through a strip
  // list naming only the two blocks known when that list was written. Milder
  // than the recap and still pure loss — `buildChatPointerBlock` filters its
  // closing "Use search_chats to read them." against the tools this request
  // carries, so `NO_RECALL_TOOLS` already suppresses the instruction, and what
  // survives is "There are N earlier conversations in this project; most
  // recent: …": tokens naming conversations the model is then given no tool to
  // open. A pointer at unreachable content is a distraction, not context.
  // ★ extend the list, do
  // not trust it.
  // ★★★ AND THE TOOL ITSELF IS DROPPED, unconditionally — `NO_RECALL_TOOLS`,
  // not `args`. Suppressing the sentence while still OFFERING the
  // tool leaves the trap armed for any instruction that invites a look
  // backwards ("put this back the way it was last week"). The kill switch is
  // honoured a fortiori: off stays off, and on is off HERE too. ★ The cost is
  // real and accepted — this path always sends its own `toolsNamed` list
  // (§715 D1: only the plannable tools), so it no longer shares a prompt-cache prefix with the chat panel, costing
  // one extra cache write per 5-minute window in an interleaved chat/inline-edit
  // session. A silent no-op edit is worse than a cache miss. ★ There is
  // deliberately no `historySearch` field on `InlineEditArgs` any more: a
  // parameter that is read nowhere is one a future editor re-wires.
  // ★★ VIEW SCOPE IS DELIBERATELY KEPT — this is a decision, not an oversight,
  // and the test's control assertion depends on it. It carries no entity ids,
  // and orienting the model on what the surface is makes its edit better. Its
  // `toolHints` are filtered to the tools this request carries (below), and no
  // view hints a plannable tool today, so none survive. ★ A view's `reading`
  // is NOT filtered by tool name and some name read tools — none of the views
  // with inline edit (raid, changes, milestones, stakeholders, open-points) do.
  // ★ Passing `buildSystemPrompt` the NAMES of the `tools` list below keeps that
  // block honest: it filters its hints against the tools this request carries,
  // so a read-tool hint (`list_milestones`, Activity's `search_history`)
  // disappears with the tool. `NO_RECALL_TOOLS` alone would not: it names every
  // tool but the two recall ones.
  // §715 D1 — only the tools the plan can act on: a read tool here is a call nobody answers.
  const tools = inlineTools();
  const offered = new Set(tools.map((d) => d.name));
  const system: SystemBlock[] = [
    ...buildSystemPrompt(
      args.lang,
      {
        ...args.snapshot,
        viewDigest: undefined,
        activitySummary: undefined,
        chatPointer: undefined,
      },
      args.guides,
      args.groundInGuides,
      NO_RECALL_TOOLS,
      offered,
    ),
    scopeBlock(args.entity, args.item, args.itemLabel),
  ];
  // §701 — the guides that target inline edit itself. ★ `args.guides` (the
  // CHAT path above) is `[]` from both production callers, so this path sends
  // no chat guides; the inline-edit guides arrive as ready text instead.
  // ★ They sit AFTER the scope block, which changes with every item, so they
  // are never part of a cached prefix — accepted: an inline edit is one request,
  // and moving them ahead of the scope block would put user guidance before the
  // "you are editing exactly ONE item" boundary it must not override.
  if (args.guideText) system.push({ type: "text", text: args.guideText });
  const res = await callClaude(
    args.apiKey,
    args.model,
    system,
    [{ role: "user", content: args.instruction }],
    NO_RECALL_TOOLS,
    args.signal,
    tools,
  );
  const blocks = res.content.filter(
    (b: ContentBlock): b is ToolUseBlock => b.type === "tool_use",
  );
  const text = res.content
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .trim();
  return { blocks, text, usage: res.usage };
}
