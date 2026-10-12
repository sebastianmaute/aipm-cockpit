// src/app/ai-forced-call.ts — the ONE audited fetch envelope for every one-shot,
// forced-tool Anthropic call in the app (Action-Center analysis, scheduled jobs,
// weight suggestions, task dedup, committee report, digest narrative, project
// proposal). Each caller keeps its OWN parse/ground/coerce/validation; only the
// wire call + error throw are shared here, so a leak fix lives in ONE place.
//
// SECURITY INVARIANT (never regress): this module NEVER logs or echoes the api
// key or the raw response body. The key lives only in the request header, which
// is never read back. On a non-OK response only the SAFE tokens `error.type`
// (classification) and the sanitized `error.message` (surfaceable, NOT logged)
// are read via ai-errors helpers; the thrown AiHttpError.message stays
// status-only. There is NO console.* anywhere in this file. Thrown errors carry
// only the HTTP status (AiHttpError) or the token "parse" for absent tool output.
//
// This is a SINGLE forced call — NO agentic loop, NO streaming. The multi-turn
// chat tool loop stays in chat-api.ts (callClaude), which is deliberately NOT
// routed through here.
import type { ApiMessage, SystemBlock } from "./chat-api";
import { AiHttpError, safeAiErrorType, safeAiErrorMessage } from "./ai-errors";
import { reportAiKeyResponse } from "./ai-key-status";

const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

export interface ForcedToolCallArgs {
  apiKey: string;
  model: string;
  /** Optional system prompt (string or cacheable SystemBlock[]). Omitted from
   *  the request body entirely when undefined. */
  system?: string | SystemBlock[];
  /** The user's operating guides for this action (§701), from
   *  `actionGuideText`. Appended AFTER `system`, so the fixed prompt stays a
   *  stable prefix; "" or undefined sends nothing. */
  guideText?: string;
  tools: unknown[];
  /** The tool that `tool_choice` forces AND whose tool_use block is returned. */
  toolName: string;
  messages: ApiMessage[];
  maxTokens: number;
  signal?: AbortSignal;
}

/** `system` with the guide text after it as its own block, carrying the cache
 *  marker. Tools, the fixed prompt and the guides are all stable between runs
 *  of one action, so marking the LAST system block caches the whole prefix —
 *  which is what makes up to ~3k tokens of guides cheap on the recurring
 *  background runners. Below the model's minimum cacheable length the marker
 *  is simply not honoured, never an error. No guide text: `system` unchanged,
 *  byte for byte. ★ A caller passing a block array with its own markers would
 *  add one more; no forced caller does today (the 4-per-request limit). */
export function withGuideText(
  system: string | SystemBlock[] | undefined,
  guideText: string | undefined,
): string | SystemBlock[] | undefined {
  if (!guideText) return system;
  const guideBlock: SystemBlock = { type: "text", text: guideText, cache_control: { type: "ephemeral" } };
  if (system === undefined) return [guideBlock];
  if (typeof system === "string") return [{ type: "text", text: system }, guideBlock];
  return [...system, guideBlock];
}

interface ToolUseBlock {
  type: string;
  name?: string;
  input?: unknown;
}

/**
 * POST one forced-tool request and return the raw `input` of the forced tool's
 * `tool_use` block (each caller validates that input itself).
 *
 * Throws `AiHttpError(status, errorType?, safeMessage?)` on a non-OK response
 * (message is status-only — never the key or raw body) and `Error("parse")` when
 * the response carries no matching `tool_use` block.
 */
export async function runForcedToolCall(
  args: ForcedToolCallArgs,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    model: args.model,
    max_tokens: args.maxTokens,
    messages: args.messages,
    tools: args.tools,
    tool_choice: { type: "tool", name: args.toolName },
  };
  const system = withGuideText(args.system, args.guideText);
  if (system !== undefined) body.system = system;

  const res = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "x-api-key": args.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: args.signal,
  });

  if (!res.ok) {
    // Parse the RESPONSE body ONCE for two SAFE reads only: the `error.type`
    // token (classification) and the sanitized `error.message` (surfaceable, not
    // logged). The body carries no secret; the api key is only in the request
    // header, which is never read here. The thrown message stays status-only.
    let errorType: string | undefined;
    let safeMessage: string | undefined;
    try {
      const errBody: unknown = await res.json();
      errorType = safeAiErrorType(errBody);
      safeMessage = safeAiErrorMessage(errBody);
    } catch {
      // Non-JSON / unreadable body — the status alone is enough to classify.
    }
    // §650 — the key verdict is reported HERE, at the envelope, so every forced-call
    // feature (the silent ones included) feeds the banner: 401 → rejected, 403 → forbidden.
    reportAiKeyResponse(args.apiKey, res.status, errorType);
    throw new AiHttpError(res.status, errorType, safeMessage);
  }
  reportAiKeyResponse(args.apiKey, 200);

  const json = (await res.json()) as { content?: ToolUseBlock[] };
  const toolUse = (json.content ?? []).find(
    (b) => b.type === "tool_use" && b.name === args.toolName,
  );
  if (!toolUse) throw new Error("parse");
  return (toolUse.input ?? {}) as Record<string, unknown>;
}
