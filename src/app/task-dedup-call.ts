// src/app/task-dedup-call.ts
//
// Non-hook single forced-tool Anthropic call for the "Deduplicate & unify tasks"
// feature. Mirrors scheduled-job-analysis.ts: ONE request, tool_choice forced,
// NO agentic loop. Returns the RAW parsed groups — grounding against the live
// workspace happens in the caller (groundMergeGroups), never here.
//
// SECURITY: never logs or echoes the api key or the raw response body. Thrown
// errors carry only the HTTP status (AiHttpError, with the safe error.type token
// and safe body message) or the token "parse" for malformed tool output.
import {
  PROPOSE_MERGES_TOOL,
  buildDedupSystemPrompt,
  parseMergeProposal,
  type RawMergeGroup,
} from "./task-dedup/dedup";
import { AiHttpError, safeAiErrorMessage, safeAiErrorType } from "./ai-errors";

const ANTHROPIC_VERSION = "2023-06-01";

interface AiCreds {
  apiKey: string;
  model: string;
}
interface ToolUseBlock {
  type: string;
  name?: string;
  input?: unknown;
}

/** Run one forced propose_task_merges tool call and return the raw parsed groups.
 *  Throws AiHttpError(status, errorType?, safeMessage?) on a non-OK response and
 *  Error("parse") on malformed tool output. The api key is NEVER included in the
 *  thrown error — only the status + safe body tokens. */
export async function runDedupProposal(
  context: string,
  ai: AiCreds,
  signal?: AbortSignal,
): Promise<RawMergeGroup[]> {
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
      max_tokens: 4096,
      system: buildDedupSystemPrompt(),
      messages: [{ role: "user", content: context }],
      tools: [PROPOSE_MERGES_TOOL],
      tool_choice: { type: "tool", name: PROPOSE_MERGES_TOOL.name },
    }),
    signal,
  });
  if (!res.ok) {
    // status + safe body tokens only — never echo key or full body.
    let errorType: string | undefined;
    let safeMessage: string | undefined;
    try {
      const body = await res.json();
      errorType = safeAiErrorType(body);
      safeMessage = safeAiErrorMessage(body);
    } catch {
      /* non-JSON body */
    }
    throw new AiHttpError(res.status, errorType, safeMessage);
  }
  const json = (await res.json()) as { content?: ToolUseBlock[] };
  const toolUse = (json.content ?? []).find(
    (b) => b.type === "tool_use" && b.name === PROPOSE_MERGES_TOOL.name,
  );
  const parsed = toolUse ? parseMergeProposal(toolUse.input) : null;
  if (!parsed) throw new Error("parse");
  return parsed;
}
