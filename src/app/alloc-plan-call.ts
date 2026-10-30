// src/app/alloc-plan-call.ts
//
// Non-hook single forced-tool Anthropic call for AI allocation planning.
// Mirrors task-dedup-call.ts: ONE request, tool_choice forced, NO agentic loop.
// Returns the RAW parsed alternatives (§769: each with task moves and cells, plus whether
// parsing itself had to truncate an over-large proposal) — grounding against the live workspace happens in
// the caller (groundAllocationCells), never here.
//
// SECURITY: the shared runForcedToolCall envelope never logs or echoes the api
// key or the raw response body. Thrown errors carry only the HTTP status
// (AiHttpError, message status-only) or the token "parse" for malformed output.
import { PRIVACY_NOT_YET_THREADED } from "./ai-privacy";
import {
  PROPOSE_ALLOCATIONS_TOOL,
  buildAllocSystemPrompt,
} from "./alloc-plan/alloc-plan";
import { parseAllocationAlternatives, type ParsedAllocAlternatives } from "./alloc-plan/alloc-alternatives";
import { runForcedToolCallWithRetry } from "./ai-forced-call";

interface AiCreds {
  apiKey: string;
  model: string;
  /** The user's guides for this action (§701), from `actionGuideText`. */
  guideText?: string;
}

/** Run one forced propose_allocations tool call and return the parsed result
 *  (`{alternatives, truncated}` — `truncated` must be read from HERE, not only
 *  from the later grounding step, because this parse is where an over-large
 *  proposal is actually cut). A reply cut at the output budget is asked for once more
 *  with RETRY_MAX_TOKENS (§764). Throws AiHttpError(status, errorType?, safeMessage?) on a
 *  non-OK response and Error("parse") on absent/malformed tool output, or when
 *  the retry is cut too. The
 *  api key is NEVER included in the thrown error — only the status + safe
 *  body tokens. */
export async function runAllocProposal(
  context: string,
  ai: AiCreds,
  instruction: string,
  signal?: AbortSignal,
): Promise<ParsedAllocAlternatives> {
  // The context digest is `#`/newline-formatted data; the instruction is free
  // user text. A labeled separator keeps the two visually distinct for
  // readability — it is NOT the security boundary. That boundary is
  // downstream: groundAllocationCells refuses any resourceId/periodKey that
  // isn't real, and nothing is written without per-cell human confirmation.
  const userMessage = `${context}\n\n---\nUSER REQUEST: ${instruction}`;

  const reply = await runForcedToolCallWithRetry({
    apiKey: ai.apiKey,
    privacy: PRIVACY_NOT_YET_THREADED,
    model: ai.model,
    system: buildAllocSystemPrompt(),
    guideText: ai.guideText,
    tools: [PROPOSE_ALLOCATIONS_TOOL],
    toolName: PROPOSE_ALLOCATIONS_TOOL.name,
    messages: [{ role: "user", content: userMessage }],
    // A worst-case MAX_ALLOC_CELLS=200 proposal serializes to roughly
    // 2,900-3,300 tokens of tool-use JSON alone (§769: 50 task moves and three
    // summaries add about 1,000 more, so the worst case stays near 4,500 and 8192 holds); 4096 left too little
    // headroom for a broad request and a truncated response surfaced as an
    // undifferentiated Error("parse"). 8192 gives real room; the system
    // prompt also asks the model to prioritise rather than enumerate
    // exhaustively when a request is very broad. A reply cut there is asked
    // for once more at 16384 (§764); a model whose output cap is lower refuses
    // that, and the cut reply is the parse error, as before the retry existed.
    maxTokens: 8192,
    signal,
  }, 16_384);
  // A reply cut at the retry budget too is never read (§764): its input may be partial yet still parse.
  if (reply.stopReason === "max_tokens") throw new Error("parse");
  const parsed = parseAllocationAlternatives(reply.input);
  if (!parsed) throw new Error("parse");
  return parsed;
}
