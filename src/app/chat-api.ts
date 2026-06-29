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
    "When the user attaches a document, read it and, when they ask, extract the relevant items (tasks, risks, milestones, stakeholders) and create them with the matching create_ tool. Summarise what you created and ask before bulk-creating many records.",
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
      max_tokens: 4096,
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
