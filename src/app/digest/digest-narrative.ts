// Optional AI narrative for the weekly digest. ONE forced-tool Anthropic call
// (no agentic loop) via the shared runForcedToolCall envelope, mirroring
// scheduled-job-analysis.ts for security: the api key and response body are NEVER
// logged or echoed — thrown errors carry only the HTTP status (AiHttpError,
// message status-only) or the token "parse". (Deliberately a direct one-shot
// fetch rather than chat-api's callClaude, which embeds the response body in its
// thrown message and would leak it.)
import type { AiPrivacy } from "../ai-privacy";
import type { Lang } from "../i18n";
import type { DigestModel } from "./digest-model";
import { runForcedToolCallWithRetry } from "../ai-forced-call";
import type { AiConsentLevel } from "../ai-consent";

// Shared control-char scrub (hex escapes — never literal control bytes).
const CONTROL_CHARS = /[\x00-\x1f]/g;
const MAX_NARRATIVE = 2000;
/** Output budgets. Three sentences fit the first, but a model asked with auto choice can think first
 *  and run out (§763, §764), so a cut reply is asked for once more at the second. */
const NARRATIVE_MAX_TOKENS = 1024;
const NARRATIVE_RETRY_MAX_TOKENS = 2048;

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
  /** The privacy of the project whose data this request carries (AI people protection, spec R3). */
  privacy: AiPrivacy;
  lang: Lang;
  /** The user's guides for this action (§701), from `actionGuideText`. */
  guideText?: string;
  /** The consent the request needs: `background` for the scheduled auto-run, interactive (the default) for a click. */
  level?: AiConsentLevel;
}

/** Run one forced write_digest_narrative tool call and return the parsed
 *  paragraph. Throws AiHttpError(status) on a non-OK response (message
 *  status-only) and Error("parse") on absent/malformed/empty tool output, and on
 *  a reply cut at the output budget twice (a partial paragraph is never shown). The
 *  api key and response body are NEVER included in the thrown message. */
export async function runDigestNarrative(
  digest: DigestModel,
  ctx: DigestNarrativeCtx,
  signal?: AbortSignal,
): Promise<string> {
  const { input, stopReason } = await runForcedToolCallWithRetry({
    apiKey: ctx.apiKey,
    privacy: ctx.privacy,
    model: ctx.model,
    guideText: ctx.guideText,
    level: ctx.level,
    tools: [NARRATIVE_TOOL],
    toolName: "write_digest_narrative",
    messages: [{ role: "user", content: buildDigestNarrativePrompt(digest, ctx.lang) }],
    maxTokens: NARRATIVE_MAX_TOKENS,
    signal,
  }, NARRATIVE_RETRY_MAX_TOKENS);
  if (stopReason === "max_tokens") throw new Error("parse");
  const narrative = parseDigestNarrative((input as { narrative?: unknown }).narrative);
  if (!narrative) throw new Error("parse");
  return narrative;
}
