// Non-hook, plain-async form of the Action Center "Analyze with AI" call. Performs
// the SAME single forced-tool Anthropic request as use-action-analysis.ts so both
// the React hook and the SP5 scheduled-job runner (which loops per due job and
// therefore cannot call a hook) share ONE source of truth for the call. No React.
// SECURITY: the shared runForcedToolCall envelope never logs or echoes the api key
// or the raw response body — thrown errors carry only the HTTP status (AiHttpError,
// message status-only) or the token "parse".
import { parseAnalysis, ANALYZE_TOOL, buildAnalysisSystemPrompt, type ActionAnalysis } from "./action-ai";
import { runForcedToolCallWithStop } from "./ai-forced-call";

interface AiCreds {
  apiKey: string;
  model: string;
  /** The user's guides for this action (§701), from `actionGuideText`. */
  guideText?: string;
  /** Cache the guide prefix: set by the scheduled-job runner, which can run
   *  several due jobs in one tick (`runForcedToolCall`'s `cacheGuides`). */
  cacheGuides?: boolean;
}

/** Run one forced report_analysis tool call and return the parsed analysis.
 *  Throws AiHttpError(status, errorType?, safeMessage?) on a non-OK response and
 *  Error("parse") on absent/malformed tool output, or on a reply cut at the output budget (its input
 *  may be partial). The api key and response body
 *  are NEVER included in the thrown error — only the status + safe tokens. */
export async function runJobAnalysis(context: string, ai: AiCreds, signal?: AbortSignal): Promise<ActionAnalysis> {
  const { input, stopReason } = await runForcedToolCallWithStop({
    apiKey: ai.apiKey,
    model: ai.model,
    system: buildAnalysisSystemPrompt(),
    guideText: ai.guideText,
    cacheGuides: ai.cacheGuides,
    tools: [ANALYZE_TOOL],
    toolName: "report_analysis",
    messages: [{ role: "user", content: context }],
    // 4096, as task dedup and the project proposal use (was 2048); a reply cut at it is still "parse".
    maxTokens: 4096,
    signal,
  });
  const parsed = stopReason === "max_tokens" ? null : parseAnalysis(input);
  if (!parsed) throw new Error("parse");
  return parsed;
}
