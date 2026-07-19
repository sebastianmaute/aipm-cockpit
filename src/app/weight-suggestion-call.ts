// src/app/weight-suggestion-call.ts - non-hook forced suggest_weights call. The
// shared runForcedToolCall envelope NEVER logs/echoes the api key or response
// body; thrown errors carry only HTTP status (AiHttpError, message status-only)
// or "parse". Mirrors scheduled-job-analysis.ts.
import { type NextActionsConfig } from "./settings-types";
import { type SuggestionScope } from "./next-actions-tuning";
import { SUGGEST_TOOL, buildSuggestionSystemPrompt, parseSuggestionResponse, type SuggestionResult } from "./weight-suggestion-ai";
import { runForcedToolCall } from "./ai-forced-call";

interface AiCreds { apiKey: string; model: string }

export async function runWeightSuggestion(context: string, ai: AiCreds, current: NextActionsConfig, scope: SuggestionScope): Promise<SuggestionResult> {
  const input = await runForcedToolCall({
    apiKey: ai.apiKey,
    model: ai.model,
    system: buildSuggestionSystemPrompt(),
    tools: [SUGGEST_TOOL],
    toolName: "suggest_weights",
    messages: [{ role: "user", content: context }],
    maxTokens: 2048,
  });
  return parseSuggestionResponse(input, current, scope);
}
