// src/app/chat-api.ts — the AI chat's wire layer: Anthropic message/content types,
// the system-prompt assembler, the fetch call, and small pure helpers. Non-React +
// i18n-free (per the repo's "engines live in plain modules; React surfaces import
// them" pattern); `chat-panel.tsx` consumes everything here.
import { TOOL_DEFS, type ToolDispatcher } from "./chat-tools";
import type { Lang } from "./i18n";
import { selectActiveGuides, assembleGuideBlock, type OperatingGuide } from "./operating-guide";
import type { AttachmentBlock } from "./chat-attachments";

export type TextBlock = { type: "text"; text: string };
export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};
export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | AttachmentBlock;

export type SystemBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };

export type ApiMessage =
  | { role: "user"; content: string | ContentBlock[] }
  | { role: "assistant"; content: ContentBlock[] };

export type DisplayItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | {
      kind: "tool";
      name: string;
      input: unknown;
      result: string;
      error: boolean;
    };

export type ApiUsage = { input_tokens: number; output_tokens: number };

export const ANTHROPIC_VERSION = "2023-06-01";

/** Per-request output-token ceiling for a model. The Anthropic API requires a
 *  `max_tokens`; the legacy Claude 3.0 trio (haiku/opus/sonnet) hard-caps at
 *  4096 (a higher value 400s), while everything from 3.5 onward supports >=8192.
 *  Unknown/future ids default to the 8192 floor every current model accepts. */
export function maxOutputTokensFor(model: string): number {
  return /^claude-3-(haiku|opus|sonnet)\b/.test(model) ? 4096 : 8192;
}

/** Injected (invisible) user turn that resumes a response the model cut off at
 *  max_tokens, so the loop can stitch the full answer without the user prodding. */
export const CONTINUE_NUDGE =
  "Your previous message was cut off at the length limit. Continue exactly where you left off — do not repeat anything you already wrote.";

/** Read a File into the data shape `buildAttachmentBlock` expects: base64 (no
 *  data: prefix) for pdf/image, decoded UTF-8 text for text. */
export function readAttachmentData(
  file: File,
  kind: "pdf" | "image" | "text",
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    if (kind === "text") {
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.readAsText(file);
    } else {
      reader.onload = () => {
        // readAsDataURL → "data:<mime>;base64,<DATA>"; keep only <DATA>.
        const result = String(reader.result ?? "");
        const comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.readAsDataURL(file);
    }
  });
}

export function buildSystemPrompt(
  lang: Lang,
  snapshot: ReturnType<ToolDispatcher["getSnapshot"]>,
  guides: readonly OperatingGuide[],
  groundInGuides: boolean,
): SystemBlock[] {
  const groups = (snapshot.knownGroups ?? []).join(", ") || "(none)";
  const labels = (snapshot.knownLabels ?? []).join(", ") || "(none)";
  // STABLE prefix (cached): fixed instructions that never interpolate per-call
  // state, plus the (large) guide text. Anthropic prompt-cache is prefix-based,
  // so this must come FIRST and contain only call-invariant content.
  const stableInstructions = [
    "You are an assistant embedded in the List of Open Points Tracker app, a list-of-open-points task manager.",
    "The user is a project lead tracking open tasks. Each task has: id, taskName, assignee, assigneeEmail, dueDate (YYYY-MM-DD), lastUpdateDate, priority (Low/Medium/High/Urgent), status (To Do/In Progress/On Hold/In Review/Cancelled/Done), blockers, notes, group (single optional category), labels (zero or more tags).",
    "Use the provided tools to read and modify the app's state. Prefer calling tools over guessing. After modifying state, briefly confirm what changed.",
    "Beyond tasks you can also read and write RAID items (Risks/Assumptions/Issues/Dependencies), change-control items, milestones, and stakeholders via their list_/create_/update_/delete_ tools. RAID category is R/A/I/D; status must match the category. Dates are YYYY-MM-DD.",
    "You can also read the resource directory (list_resources) and add people to it (create_resource, with firstName/lastName). IMPORTANT: assigning a task to a person by name does NOT add them to the directory — when a document describes a team or resource plan, call create_resource for each person so they appear in the directory, not just as task assignees.",
    "When the user attaches a document, read it and, when they ask, extract the relevant items (tasks, risks, milestones, stakeholders, people/resources) and create them with the matching create_ tool. Summarise what you created and ask before bulk-creating many records.",
    "Before deleting anything (delete_task, delete_all_tasks, delete_raid_item, delete_change, delete_milestone, delete_stakeholder) confirm with the user in chat unless they were already explicit.",
    "When the user references a record by name or fragment, call the matching list_ tool to find its ID first.",
    `Active language code: ${lang}.`,
  ].join("\n");
  const guideBlock = groundInGuides
    ? assembleGuideBlock(selectActiveGuides(guides, {
        mode: snapshot.mode, modules: snapshot.enabledModules, view: snapshot.currentView,
      }))
    : "";
  const stableText = [stableInstructions, guideBlock].filter(Boolean).join("\n\n");

  // VOLATILE suffix (uncached): per-call state + the APP CONTEXT block. Placed
  // AFTER the cached prefix so it never invalidates the cache.
  const appContext = [
    "APP CONTEXT — adapt your behavior to this.",
    `Mode: ${snapshot.mode}. Enabled modules: ${snapshot.enabledModules.join(", ") || "(none)"}.`,
    `Current view: ${snapshot.currentView}.`,
    "In simple mode keep actions minimal and never reference disabled modules.",
    "You are acting as a senior project & program manager.",
  ].join("\n");
  const volatileText = [
    `Today is ${snapshot.today}. UI language is ${snapshot.language}. Respond in the user's language. Storage backend: ${snapshot.storageKind}. Current task count: ${snapshot.taskCount}.`,
    `Known groups: ${groups}. Known labels: ${labels}. When the user mentions a category, prefer reusing an existing group or label rather than creating near-duplicates.`,
    appContext,
  ].join("\n");

  return [
    { type: "text", text: stableText, cache_control: { type: "ephemeral" } },
    { type: "text", text: volatileText },
  ];
}

export function systemBlocksText(blocks: SystemBlock[]): string {
  return blocks.map((b) => b.text).join("\n\n");
}

/** Content for a synthetic tool_result standing in for a call that never ran
 *  (turn truncated at max_tokens, or the user stopped mid-turn). */
export const INTERRUPTED_TOOL_RESULT =
  "Tool call was interrupted before it produced a result. Ignore it.";

/**
 * Repair a conversation so every assistant `tool_use` block is immediately
 * followed by a user message carrying a `tool_result` for each id — the
 * invariant the Anthropic API enforces (400 invalid_request_error otherwise).
 *
 * A dangling `tool_use` arises when the tool loop pushes the assistant message
 * but exits before running the tools + appending results: the turn stopped at
 * `max_tokens` with tool_use in its content, or the user hit Stop/Escape. Left
 * in history, the NEXT send appends a user turn right after the dangling
 * tool_use and the whole request is rejected — wedging the chat.
 *
 * The tool loop builds a turn's results all-or-nothing (one user message with
 * every result, or none), so a dangling turn never has a partial carrier —
 * detection is simply "is the next message a user tool_result carrier for these
 * ids?". If not, inject one with `is_error` results for all the ids. A
 * well-formed history is returned unchanged (identity).
 */
export function closeDanglingToolUses(messages: ApiMessage[]): ApiMessage[] {
  const out: ApiMessage[] = [];
  const consumed = new Set<number>(); // indices folded into a merged carrier
  for (let i = 0; i < messages.length; i++) {
    if (consumed.has(i)) continue;
    const msg = messages[i];
    out.push(msg);
    if (msg.role !== "assistant") continue;
    const toolUseIds = msg.content
      .filter((b): b is ToolUseBlock => b.type === "tool_use")
      .map((b) => b.id);
    if (toolUseIds.length === 0) continue;
    const next = messages[i + 1];
    const nextResults =
      next?.role === "user" && Array.isArray(next.content)
        ? next.content.filter((b): b is ToolResultBlock => b.type === "tool_result")
        : null;
    const satisfied = new Set((nextResults ?? []).map((b) => b.tool_use_id));
    const missing = toolUseIds.filter((id) => !satisfied.has(id));
    if (missing.length === 0) continue;
    const synthetic: ToolResultBlock[] = missing.map((id) => ({
      type: "tool_result" as const,
      tool_use_id: id,
      content: INTERRUPTED_TOOL_RESULT,
      is_error: true,
    }));
    if (nextResults && nextResults.length > 0) {
      // Partial carrier: fold the missing results INTO it (keep one user message
      // immediately after the assistant) rather than inserting a second user
      // turn that would split the results and stay invalid.
      out.push({ role: "user", content: [...synthetic, ...(next.content as ContentBlock[])] });
      consumed.add(i + 1);
    } else {
      // No carrier at all: insert one covering every dangling id.
      out.push({ role: "user", content: synthetic });
    }
  }
  return out;
}

export async function callClaude(
  apiKey: string,
  model: string,
  system: SystemBlock[],
  messages: ApiMessage[],
  signal?: AbortSignal,
): Promise<{
  content: ContentBlock[];
  stop_reason: string;
  usage: ApiUsage;
}> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey.trim(),
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxOutputTokensFor(model),
      system: system,
      messages,
      tools: TOOL_DEFS,
    }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text.slice(0, 300)}`);
  }
  const json = await res.json() as { content: ContentBlock[]; stop_reason: string; usage?: ApiUsage };
  return {
    content: json.content,
    stop_reason: json.stop_reason,
    usage: json.usage ?? { input_tokens: 0, output_tokens: 0 },
  };
}

export function stringifyResult(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
