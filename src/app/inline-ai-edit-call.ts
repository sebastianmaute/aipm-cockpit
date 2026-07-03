// src/app/inline-ai-edit-call.ts
//
// Non-hook single-shot call for the inline task editor. Reuses callClaude (which
// already sends the tool defs + browser headers). NEVER logs/echoes the key or
// body; the caller reads only { blocks, text, usage }. No agentic loop.
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
import { type Task } from "./types";

export interface InlineEditArgs {
  apiKey: string;
  model: string;
  lang: Lang;
  task: Task;
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

function scopeBlock(task: Task): SystemBlock {
  const fields = JSON.stringify({
    id: task.id,
    taskName: task.taskName,
    assignee: task.assignee,
    dueDate: task.dueDate,
    startDate: task.startDate,
    status: task.status,
    priority: task.priority,
    notes: task.notes,
    blockers: task.blockers,
    group: task.group,
    labels: task.labels,
    resourceId: task.resourceId,
  });
  return {
    type: "text",
    text:
      "INLINE EDIT MODE. You are editing exactly ONE task (below). Use tool calls to " +
      "make the user's requested change: update_task for this task's fields, and you may " +
      "create related items (create_task / create_raid_item / create_change / " +
      "create_milestone / create_stakeholder) when asked. Do NOT update or delete any other task. Do NOT " +
      "chat or explain unless you cannot proceed without more detail. Target task:\n" +
      fields,
  };
}

export async function callInlineEdit(args: InlineEditArgs): Promise<InlineEditResult> {
  const system: SystemBlock[] = [
    ...buildSystemPrompt(args.lang, args.snapshot, args.guides, args.groundInGuides),
    scopeBlock(args.task),
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
