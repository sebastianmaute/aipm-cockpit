// Optional AI narrative for the weekly digest. ONE forced-tool Anthropic call
// (no agentic loop) via the shared runForcedToolCall envelope, mirroring
// scheduled-job-analysis.ts for security: the api key and response body are NEVER
// logged or echoed — thrown errors carry only the HTTP status (AiHttpError,
// message status-only) or the token "parse". (Deliberately a direct one-shot
// fetch rather than chat-api's callClaude, which embeds the response body in its
// thrown message and would leak it.)
import type { Lang } from "../i18n";
import type { DigestModel } from "./digest-model";
import { runForcedToolCall } from "../ai-forced-call";

// Shared control-char scrub (hex escapes — never literal control bytes).
const CONTROL_CHARS = /[\x00-\x1f]/g;
const MAX_NARRATIVE = 2000;

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
 *  paragraph. Throws AiHttpError(status) on a non-OK response (message
 *  status-only) and Error("parse") on absent/malformed/empty tool output. The
 *  api key and response body are NEVER included in the thrown message. */
export async function runDigestNarrative(
  digest: DigestModel,
  ctx: DigestNarrativeCtx,
  signal?: AbortSignal,
): Promise<string> {
  const input = await runForcedToolCall({
    apiKey: ctx.apiKey,
    model: ctx.model,
    tools: [NARRATIVE_TOOL],
    toolName: "write_digest_narrative",
    messages: [{ role: "user", content: buildDigestNarrativePrompt(digest, ctx.lang) }],
    maxTokens: 1024,
    signal,
  });
  const narrative = parseDigestNarrative((input as { narrative?: unknown }).narrative);
  if (!narrative) throw new Error("parse");
  return narrative;
}
