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
import { PRIVACY_NOT_YET_THREADED } from "./ai-privacy";
import {
  PROPOSE_MERGES_TOOL,
  buildDedupSystemPrompt,
  parseMergeProposal,
  type RawMergeGroup,
} from "./task-dedup/dedup";
import { runForcedToolCallWithRetry } from "./ai-forced-call";

interface AiCreds {
  apiKey: string;
  model: string;
  /** The user's guides for this action (§701), from `actionGuideText`. */
  guideText?: string;
}

/** Run one forced propose_task_merges tool call and return the raw parsed groups.
 *  A reply cut at the output budget is asked for once more at 8192 (§764).
 *  Throws AiHttpError(status, errorType?, safeMessage?) on a non-OK response and
 *  Error("parse") on absent/malformed tool output, or when the retry is cut too.
 *  The api key is NEVER included
 *  in the thrown error — only the status + safe body tokens. */
export async function runDedupProposal(
  context: string,
  ai: AiCreds,
  signal?: AbortSignal,
): Promise<RawMergeGroup[]> {
  const reply = await runForcedToolCallWithRetry({
    apiKey: ai.apiKey,
    privacy: PRIVACY_NOT_YET_THREADED,
    model: ai.model,
    system: buildDedupSystemPrompt(),
    guideText: ai.guideText,
    tools: [PROPOSE_MERGES_TOOL],
    toolName: PROPOSE_MERGES_TOOL.name,
    messages: [{ role: "user", content: context }],
    maxTokens: 4096,
    signal,
  }, 8192);
  // A reply cut at the retry budget too is never read (§764): its input may be partial yet still parse.
  if (reply.stopReason === "max_tokens") throw new Error("parse");
  const parsed = parseMergeProposal(reply.input);
  if (!parsed) throw new Error("parse");
  return parsed;
}
