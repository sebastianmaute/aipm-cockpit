// Optional AI narrative for the weekly digest. ONE forced-tool Anthropic call
// (no agentic loop), mirroring scheduled-job-analysis.ts EXACTLY for security:
// the api key and response body are NEVER logged or echoed — thrown errors carry
// only the HTTP status (as digits) or the token "parse". (Deliberately a direct
// fetch rather than chat-api's callClaude, which embeds the response body in its
// thrown message and would leak it.)
import type { Lang } from "../i18n";
import type { DigestModel } from "./digest-model";

// Shared control-char scrub (hex escapes — never literal control bytes).
const CONTROL_CHARS = /[\x00-\x1f]/g;
const MAX_NARRATIVE = 2000;

const ANTHROPIC_VERSION = "2023-06-01";

/** Forced tool: the model must return the paragraph as a single string field. */
const NARRATIVE_TOOL = {
  name: "write_digest_narrative",
  description: "Return the one-paragraph weekly status narrative for the digest.",
  input_schema: {
    type: "object",
    properties: {
      narrative: { type: "string", description: "The status paragraph, prose only." },
    },
    required: ["narrative"],
  },
} as const;

interface ToolUseBlock {
  type: string;
  name?: string;
  input?: unknown;
}

export function buildDigestNarrativePrompt(model: DigestModel, lang: Lang): string {
  const rag = model.rag === "R" ? "Red" : model.rag === "A" ? "Amber" : "Green";
  const ms = model.milestonesDueSoon.map((m) => `${m.name} (${m.date})`).join(", ") || "none";
  return (
    `Write ONE short paragraph (max 3 sentences) summarizing this project's weekly status for a PM. ` +
    `Language: ${lang === "de" ? "German" : "English"}. Facts:\n` +
    `- Overall RAG: ${rag}\n` +
    `- Overdue tasks: ${model.overdue.count}\n` +
    `- Open RAID: ${model.openRaid.count} (${model.openRaid.high} high)\n` +
    `- Milestones due soon: ${ms}\n` +
    `Return prose only, no headings or lists.`
  );
}

export function parseDigestNarrative(text: unknown): string {
  if (typeof text !== "string") return "";
  return text.replace(CONTROL_CHARS, "").trim().slice(0, MAX_NARRATIVE);
}

export interface DigestNarrativeCtx {
  apiKey: string;
  model: string;
  lang: Lang;
}

/** Run one forced write_digest_narrative tool call and return the parsed
 *  paragraph. Throws Error(status) on a non-OK response and Error("parse") on
 *  malformed/empty tool output. The api key and response body are NEVER included
 *  in the thrown message. */
export async function runDigestNarrative(
  digest: DigestModel,
  ctx: DigestNarrativeCtx,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ctx.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ctx.model,
      max_tokens: 1024,
      messages: [{ role: "user", content: buildDigestNarrativePrompt(digest, ctx.lang) }],
      tools: [NARRATIVE_TOOL],
      tool_choice: { type: "tool", name: "write_digest_narrative" },
    }),
    signal,
  });
  if (!res.ok) throw new Error(String(res.status)); // status only — never echo key/body
  const json = (await res.json()) as { content?: ToolUseBlock[] };
  const toolUse = (json.content ?? []).find(
    (b) => b.type === "tool_use" && b.name === "write_digest_narrative",
  );
  const input = toolUse?.input as { narrative?: unknown } | undefined;
  const narrative = parseDigestNarrative(input?.narrative);
  if (!narrative) throw new Error("parse");
  return narrative;
}
