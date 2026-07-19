// Non-hook, plain-async form of the Action Center "Analyze with AI" call. Performs
// the SAME single forced-tool Anthropic request as use-action-analysis.ts so both
// the React hook and the SP5 scheduled-job runner (which loops per due job and
// therefore cannot call a hook) share ONE source of truth for the call. No React.
// SECURITY: the shared runForcedToolCall envelope never logs or echoes the api key
// or the raw response body — thrown errors carry only the HTTP status (AiHttpError,
// message status-only) or the token "parse".
import { parseAnalysis, ANALYZE_TOOL, buildAnalysisSystemPrompt, type ActionAnalysis } from "./action-ai";
import { runForcedToolCall } from "./ai-forced-call";

interface AiCreds { apiKey: string; model: string }

/** Run one forced report_analysis tool call and return the parsed analysis.
 *  Throws AiHttpError(status, errorType?, safeMessage?) on a non-OK response and
 *  Error("parse") on absent/malformed tool output. The api key and response body
 *  are NEVER included in the thrown error — only the status + safe tokens. */
export async function runJobAnalysis(context: string, ai: AiCreds, signal?: AbortSignal): Promise<ActionAnalysis> {
  const input = await runForcedToolCall({
    apiKey: ai.apiKey,
    model: ai.model,
    system: buildAnalysisSystemPrompt(),
    tools: [ANALYZE_TOOL],
    toolName: "report_analysis",
    messages: [{ role: "user", content: context }],
    maxTokens: 2048,
    signal,
  });
  const parsed = parseAnalysis(input);
  if (!parsed) throw new Error("parse");
  return parsed;
}
