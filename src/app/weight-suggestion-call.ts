// src/app/weight-suggestion-call.ts - non-hook forced suggest_weights call. NEVER
// logs/echoes the api key or response body; thrown errors carry only HTTP status
// (digits) or "parse". Mirrors scheduled-job-analysis.ts.
import { type NextActionsConfig } from "./settings-types";
import { type SuggestionScope } from "./next-actions-tuning";
import { SUGGEST_TOOL, buildSuggestionSystemPrompt, parseSuggestionResponse, type SuggestionResult } from "./weight-suggestion-ai";

const ANTHROPIC_VERSION = "2023-06-01";
interface AiCreds { apiKey: string; model: string }
interface ToolUseBlock { type: string; name?: string; input?: unknown }

export async function runWeightSuggestion(context: string, ai: AiCreds, current: NextActionsConfig, scope: SuggestionScope): Promise<SuggestionResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ai.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ai.model,
      max_tokens: 2048,
      system: buildSuggestionSystemPrompt(),
      messages: [{ role: "user", content: context }],
      tools: [SUGGEST_TOOL],
      tool_choice: { type: "tool", name: "suggest_weights" },
    }),
  });
  if (!res.ok) throw new Error(String(res.status));
  const json = (await res.json()) as { content?: ToolUseBlock[] };
  const toolUse = (json.content ?? []).find((b) => b.type === "tool_use" && b.name === "suggest_weights");
  if (!toolUse) throw new Error("parse");
  return parseSuggestionResponse(toolUse.input, current, scope);
}
