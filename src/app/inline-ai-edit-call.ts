// src/app/inline-ai-edit-call.ts
//
// Non-hook single-shot call for the inline entity editor. Reuses callClaude
// (which already sends the tool defs + browser headers). NEVER logs/echoes the
// key or body; the caller reads only { blocks, text, usage }. No agentic loop.
import {
  buildSystemPrompt,
  callClaude,
  type ApiUsage,
  type ContentBlock,
  type SystemBlock,
  type ToolUseBlock,
} from "./chat-api";
import { type ToolDispatcher } from "./chat-tools";
import { type Lang } from "./i18n";
import { type OperatingGuide } from "./operating-guide";
import { type InlineEntity } from "./inline-ai-edit/entity-descriptor";

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

function scopeBlock(entity: InlineEntity, item: Record<string, unknown>, itemLabel: string): SystemBlock {
  const fields = JSON.stringify(item);
  return {
    type: "text",
    text:
      `INLINE EDIT MODE. You are editing exactly ONE ${entity} (below): ${itemLabel}. Use tool calls to ` +
      `make the user's requested change: the ${entity}'s update tool for this item's fields, and you may ` +
      "create related items (create_task / create_raid_item / create_change / " +
      "create_milestone / create_stakeholder) when asked. Do NOT update or delete any OTHER item. Do NOT " +
      `chat or explain unless you cannot proceed without more detail. Target ${entity}:\n` +
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
  // ★★★ AND THE TOOL ITSELF IS DROPPED, unconditionally — `false`, not
  // `args.historySearch`. Suppressing the sentence while still OFFERING the
  // tool leaves the trap armed for any instruction that invites a look
  // backwards ("put this back the way it was last week"). The kill switch is
  // honoured a fortiori: off stays off, and on is off HERE too. ★ The cost is
  // real and accepted — this path now always sends `CACHED_TOOLS_NO_HISTORY`,
  // so it no longer shares a prompt-cache prefix with the chat panel, costing
  // one extra cache write per 5-minute window in an interleaved chat/inline-edit
  // session. A silent no-op edit is worse than a cache miss. ★ There is
  // deliberately no `historySearch` field on `InlineEditArgs` any more: a
  // parameter that is read nowhere is one a future editor re-wires.
  // ★★ VIEW SCOPE IS DELIBERATELY KEPT — this is a decision, not an oversight,
  // and the test's control assertion depends on it. It carries no entity ids,
  // and orienting the model on what the surface is makes its edit better. Its
  // `toolHints` do name broad tools the scope block then forbids acting on
  // beyond this item; that tension is accepted because the scope block is
  // adjacent and explicit, where a list of real neighbouring ids is not.
  // ★ Passing the same `false` to `buildSystemPrompt` is what keeps that block
  // honest: it filters its hints against the tools this request carries, so
  // Activity's `search_history` hint disappears with the tool.
  const system: SystemBlock[] = [
    ...buildSystemPrompt(
      args.lang,
      { ...args.snapshot, viewDigest: undefined, activitySummary: undefined },
      args.guides,
      args.groundInGuides,
      false,
    ),
    scopeBlock(args.entity, args.item, args.itemLabel),
  ];
  const res = await callClaude(
    args.apiKey,
    args.model,
    system,
    [{ role: "user", content: args.instruction }],
    false,
    args.signal,
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
