// Non-hook, plain-async form of the Action Center "Analyze with AI" call. Performs
// the SAME single forced-tool Anthropic request as use-action-analysis.ts so both
// the React hook and the SP5 scheduled-job runner (which loops per due job and
// therefore cannot call a hook) share ONE source of truth for the call. No React.
// SECURITY: never logs or echoes the api key or the raw response body — thrown
// errors carry only the HTTP status (as digits) or the token "parse".
import { parseAnalysis, ANALYZE_TOOL, buildAnalysisSystemPrompt, type ActionAnalysis } from "./action-ai";

const ANTHROPIC_VERSION = "2023-06-01";

interface AiCreds { apiKey: string; model: string }
interface ToolUseBlock { type: string; name?: string; input?: unknown }

/** Run one forced report_analysis tool call and return the parsed analysis.
 *  Throws Error(status) on a non-OK response and Error("parse") on malformed tool
 *  output. The api key and response body are NEVER included in the thrown message. */
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
  if (!res.ok) throw new Error(String(res.status)); // status only — never echo key/body
  const json = (await res.json()) as { content?: ToolUseBlock[] };
  const toolUse = (json.content ?? []).find((b) => b.type === "tool_use" && b.name === "report_analysis");
  const parsed = toolUse ? parseAnalysis(toolUse.input) : null;
  if (!parsed) throw new Error("parse");
  return parsed;
}
