// src/app/weight-suggestion-call.ts - non-hook forced suggest_weights call. The
// shared runForcedToolCallWithStop envelope NEVER logs/echoes the api key or response
// body; thrown errors carry only HTTP status (AiHttpError, message status-only)
// or "parse". Mirrors scheduled-job-analysis.ts.
import { type NextActionsConfig } from "./settings-types";
import { type SuggestionScope } from "./next-actions-tuning";
import { SUGGEST_TOOL, buildSuggestionSystemPrompt, parseSuggestionResponse, type SuggestionResult } from "./weight-suggestion-ai";
import { runForcedToolCallWithStop } from "./ai-forced-call";

interface AiCreds {
  apiKey: string;
  model: string;
  /** The user's guides for this action (§701), from `actionGuideText`. */
  guideText?: string;
}

// §763 — a model asked with `auto` tool choice (one that refuses a forced choice) thinks first, on the
// same output budget. A reply cut there carries `{}` or only its first suggestions, and
// parseSuggestionResponse reads either without an error (`{}` as "no change suggested"). As
// scheduled-job-analysis.ts: 4096, a cut reply asked for once more with 8192, and a cut reply never read.
// On an `auto` model a cut can cost up to three billed replies (plain 4096, strict 4096, strict 8192) and
// marks the tool strict for the session; see committee-report/report-call.ts.
const MAX_TOKENS = 4096;
const RETRY_MAX_TOKENS = 8192;

/** Throws AiHttpError(status) on a non-OK response and Error("parse") on a reply
 *  without the tool call, or when the retry is cut too. */
export async function runWeightSuggestion(context: string, ai: AiCreds, current: NextActionsConfig, scope: SuggestionScope): Promise<SuggestionResult> {
  const call = (maxTokens: number) =>
    runForcedToolCallWithStop({
      apiKey: ai.apiKey,
      model: ai.model,
      system: buildSuggestionSystemPrompt(),
      guideText: ai.guideText,
      tools: [SUGGEST_TOOL],
      toolName: "suggest_weights",
      messages: [{ role: "user", content: context }],
      maxTokens,
    });
  let reply = await call(MAX_TOKENS);
  if (reply.stopReason === "max_tokens") reply = await call(RETRY_MAX_TOKENS);
  if (reply.stopReason === "max_tokens") throw new Error("parse");
  return parseSuggestionResponse(reply.input, current, scope);
}
