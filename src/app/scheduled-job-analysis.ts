// Non-hook, plain-async form of the Action Center "Analyze with AI" call: one
// forced-tool Anthropic request, repeated once with a larger budget when the reply
// is cut. use-action-analysis.ts calls it too, so both
// the React hook and the SP5 scheduled-job runner (which loops per due job and
// therefore cannot call a hook) share ONE source of truth for the call. No React.
// SECURITY: the shared runForcedToolCall envelope never logs or echoes the api key
// or the raw response body — thrown errors carry only the HTTP status (AiHttpError,
// message status-only) or the token "parse".
import type { AiPrivacy } from "./ai-privacy";
import { parseAnalysis, ANALYZE_TOOL, buildAnalysisSystemPrompt, type ActionAnalysis } from "./action-ai";
import { runForcedToolCallWithRetry } from "./ai-forced-call";
import type { AiConsentLevel } from "./ai-consent";

interface AiCreds {
  apiKey: string;
  model: string;
  /** The privacy of the project whose data this request carries (AI people protection, spec R3). */
  privacy: AiPrivacy;
  /** The user's guides for this action (§701), from `actionGuideText`. */
  guideText?: string;
  /** Cache the guide prefix: set by the scheduled-job runner, which can run
   *  several due jobs in one tick (`runForcedToolCall`'s `cacheGuides`). */
  cacheGuides?: boolean;
  /** The consent each request needs: the scheduled-job runner passes `background`; the Action Center's
   *  click passes nothing (interactive). */
  level?: AiConsentLevel;
}

// The output budget, as task dedup and the project proposal use (was 2048), and the one a reply cut at
// it is asked for again with, as the WBS and allocation plans use. Billing counts the tokens used, so a
// cut first reply is billed in full on top of the retry (about 12k output tokens at worst).
const MAX_TOKENS = 4096;
const RETRY_MAX_TOKENS = 8192;

/** Run the forced report_analysis tool call and return the parsed analysis. A reply cut at the output
 *  budget is never read (its input may be partial yet still parse); it is asked for once more with
 *  RETRY_MAX_TOKENS. Throws AiHttpError(status, errorType?, safeMessage?) on a non-OK response and
 *  Error("parse") on absent/malformed tool output, or when the retry is cut too. The api key and
 *  response body are NEVER included in the thrown error — only the status + safe tokens. */
export async function runJobAnalysis(context: string, ai: AiCreds, signal?: AbortSignal): Promise<ActionAnalysis> {
  const reply = await runForcedToolCallWithRetry(
    {
      apiKey: ai.apiKey,
      privacy: ai.privacy,
      model: ai.model,
      system: buildAnalysisSystemPrompt(),
      guideText: ai.guideText,
      cacheGuides: ai.cacheGuides,
      level: ai.level,
      tools: [ANALYZE_TOOL],
      toolName: "report_analysis",
      messages: [{ role: "user", content: context }],
      maxTokens: MAX_TOKENS,
      signal,
    },
    RETRY_MAX_TOKENS,
  );
  const parsed = reply.stopReason === "max_tokens" ? null : parseAnalysis(reply.input);
  if (!parsed) throw new Error("parse");
  return parsed;
}
