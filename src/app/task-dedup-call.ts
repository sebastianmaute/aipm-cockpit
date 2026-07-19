// src/app/task-dedup-call.ts
//
// Non-hook single forced-tool Anthropic call for the "Deduplicate & unify tasks"
// feature. Mirrors scheduled-job-analysis.ts: ONE request, tool_choice forced,
// NO agentic loop. Returns the RAW parsed groups — grounding against the live
// workspace happens in the caller (groundMergeGroups), never here.
//
// SECURITY: the shared runForcedToolCall envelope never logs or echoes the api
// key or the raw response body. Thrown errors carry only the HTTP status
// (AiHttpError, with the safe error.type token + safe body message; message
// status-only) or the token "parse" for malformed tool output.
import {
  PROPOSE_MERGES_TOOL,
  buildDedupSystemPrompt,
  parseMergeProposal,
  type RawMergeGroup,
} from "./task-dedup/dedup";
import { runForcedToolCall } from "./ai-forced-call";

interface AiCreds {
  apiKey: string;
  model: string;
}

/** Run one forced propose_task_merges tool call and return the raw parsed groups.
 *  Throws AiHttpError(status, errorType?, safeMessage?) on a non-OK response and
 *  Error("parse") on absent/malformed tool output. The api key is NEVER included
 *  in the thrown error — only the status + safe body tokens. */
export async function runDedupProposal(
  context: string,
  ai: AiCreds,
  signal?: AbortSignal,
): Promise<RawMergeGroup[]> {
  const input = await runForcedToolCall({
    apiKey: ai.apiKey,
    model: ai.model,
    system: buildDedupSystemPrompt(),
    tools: [PROPOSE_MERGES_TOOL],
    toolName: PROPOSE_MERGES_TOOL.name,
    messages: [{ role: "user", content: context }],
    maxTokens: 4096,
    signal,
  });
  const parsed = parseMergeProposal(input);
  if (!parsed) throw new Error("parse");
  return parsed;
}
