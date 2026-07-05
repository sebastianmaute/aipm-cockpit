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
  const system: SystemBlock[] = [
    ...buildSystemPrompt(args.lang, args.snapshot, args.guides, args.groundInGuides),
    scopeBlock(args.entity, args.item, args.itemLabel),
  ];
  const res = await callClaude(
    args.apiKey,
    args.model,
    system,
    [{ role: "user", content: args.instruction }],
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
