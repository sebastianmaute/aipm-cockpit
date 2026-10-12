// src/app/wbs-plan-call.ts
//
// Non-hook single forced-tool Anthropic call for AI work-breakdown optimization.
// Mirrors alloc-plan-call.ts: ONE request, tool_choice forced, NO agentic loop.
// Returns the RAW parsed items — grounding against the live task list happens
// in the caller (groundWbsProposal), never here.
//
// SECURITY: the shared runForcedToolCall envelope never logs or echoes the api
// key or the raw response body. Thrown errors carry only the HTTP status
// (AiHttpError, message status-only) or the token "parse" for malformed output.
import {
  PROPOSE_WBS_TOOL,
  buildWbsSystemPrompt,
  parseWbsProposal,
  type ParsedWbsProposal,
} from "./wbs-plan/wbs-plan";
import { runForcedToolCall } from "./ai-forced-call";

interface AiCreds {
  apiKey: string;
  model: string;
  /** The user's guides for this action (§701), from `actionGuideText`. */
  guideText?: string;
}

/** Run one forced propose_wbs_changes tool call and return the parsed result
 *  (`{items, truncated}`). Throws AiHttpError on a non-OK response and
 *  Error("parse") on absent/malformed tool output. The api key is NEVER
 *  included in a thrown error. */
export async function runWbsProposal(
  context: string,
  ai: AiCreds,
  instruction: string,
  signal?: AbortSignal,
): Promise<ParsedWbsProposal> {
  // The labeled separator is readability only, NOT the security boundary:
  // groundWbsProposal refuses any target that isn't real and nothing is
  // written without per-item human confirmation.
  const userMessage = `${context}\n\n---\nUSER REQUEST: ${instruction}`;

  const input = await runForcedToolCall({
    apiKey: ai.apiKey,
    model: ai.model,
    system: buildWbsSystemPrompt(),
    guideText: ai.guideText,
    tools: [PROPOSE_WBS_TOOL],
    toolName: PROPOSE_WBS_TOOL.name,
    messages: [{ role: "user", content: userMessage }],
    // The output budget, kept at 8192 on purpose. Rough sizes of one item's
    // tool JSON (estimated at ~4 characters a token, not measured): a link,
    // estimate or regroup ~30-35 tokens with a short `why`, a newTask ~50, a
    // six-piece split ~135; a one-sentence description adds ~25. So
    // MAX_WBS_ITEMS (60) items WITHOUT descriptions fit even when every one is
    // a six-piece split (60 × 135 ≈ 8.1k), and a typical mix fits with short
    // descriptions. What does not fit is many split pieces each carrying a
    // description (60 × (135 + 6 × 25) ≈ 17k); that answer is cut off and
    // surfaces as the generic error. The system prompt therefore tells the
    // model to keep descriptions to one sentence and to omit them on broad
    // requests. NOT raised instead: the app sends any live `claude-*` id
    // (settings-types.ts), and a model whose output cap is 8192 would refuse a
    // larger `max_tokens` on EVERY call, turning a rare overflow into a
    // permanent failure. alloc-plan-call.ts uses the same ceiling.
    maxTokens: 8192,
    signal,
  });
  const parsed = parseWbsProposal(input);
  if (!parsed) throw new Error("parse");
  return parsed;
}
