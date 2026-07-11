// Non-hook, plain-async form of the Action Center "Analyze with AI" call. Performs
// the SAME single forced-tool Anthropic request as use-action-analysis.ts so both
// the React hook and the SP5 scheduled-job runner (which loops per due job and
// therefore cannot call a hook) share ONE source of truth for the call. No React.
// SECURITY: never logs or echoes the api key or the raw response body — thrown
// errors carry only the HTTP status (as digits) or the token "parse".
import { parseAnalysis, ANALYZE_TOOL, buildAnalysisSystemPrompt, type ActionAnalysis } from "./action-ai";
import { AiHttpError, safeAiErrorType } from "./ai-errors";

const ANTHROPIC_VERSION = "2023-06-01";

interface AiCreds { apiKey: string; model: string }
interface ToolUseBlock { type: string; name?: string; input?: unknown }

/** Run one forced report_analysis tool call and return the parsed analysis.
 *  Throws AiHttpError(status, errorType?) on a non-OK response and Error("parse")
 *  on malformed tool output. The api key and response body message are NEVER
 *  included in the thrown error — only the status + safe error.type token. */
export async function runJobAnalysis(context: string, ai: AiCreds, signal?: AbortSignal): Promise<ActionAnalysis> {
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
      system: buildAnalysisSystemPrompt(),
      messages: [{ role: "user", content: context }],
      tools: [ANALYZE_TOOL],
      tool_choice: { type: "tool", name: "report_analysis" },
    }),
    signal,
  });
  if (!res.ok) {
    // status + safe `error.type` token only — never echo key/body message.
    let errorType: string | undefined;
    try { errorType = safeAiErrorType(await res.json()); } catch { /* non-JSON body */ }
    throw new AiHttpError(res.status, errorType);
  }
  const json = (await res.json()) as { content?: ToolUseBlock[] };
  const toolUse = (json.content ?? []).find((b) => b.type === "tool_use" && b.name === "report_analysis");
  const parsed = toolUse ? parseAnalysis(toolUse.input) : null;
  if (!parsed) throw new Error("parse");
  return parsed;
}
