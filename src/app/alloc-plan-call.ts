// src/app/alloc-plan-call.ts
//
// Non-hook single forced-tool Anthropic call for AI allocation planning.
// Mirrors task-dedup-call.ts: ONE request, tool_choice forced, NO agentic loop.
// Returns the RAW parsed cells (plus whether parsing itself had to truncate
// an over-large proposal) — grounding against the live workspace happens in
// the caller (groundAllocationCells), never here.
//
// SECURITY: the shared runForcedToolCall envelope never logs or echoes the api
// key or the raw response body. Thrown errors carry only the HTTP status
// (AiHttpError, message status-only) or the token "parse" for malformed output.
import {
  PROPOSE_ALLOCATIONS_TOOL,
  buildAllocSystemPrompt,
  parseAllocationProposal,
  type ParsedAllocationProposal,
} from "./alloc-plan/alloc-plan";
import { runForcedToolCall } from "./ai-forced-call";

interface AiCreds {
  apiKey: string;
  model: string;
}

/** Run one forced propose_allocations tool call and return the parsed result
 *  (`{cells, truncated}` — see `parseAllocationProposal`'s doc comment for
 *  why `truncated` must be read from HERE, not only from the later
 *  grounding step). Throws AiHttpError(status, errorType?, safeMessage?) on a
 *  non-OK response and Error("parse") on absent/malformed tool output. The
 *  api key is NEVER included in the thrown error — only the status + safe
 *  body tokens. */
export async function runAllocProposal(
  context: string,
  ai: AiCreds,
  instruction: string,
  signal?: AbortSignal,
): Promise<ParsedAllocationProposal> {
  // The context digest is `#`/newline-formatted data; the instruction is free
  // user text. A labeled separator keeps the two visually distinct for
  // readability — it is NOT the security boundary. That boundary is
  // downstream: groundAllocationCells refuses any resourceId/periodKey that
  // isn't real, and nothing is written without per-cell human confirmation.
  const userMessage = `${context}\n\n---\nUSER REQUEST: ${instruction}`;

  const input = await runForcedToolCall({
    apiKey: ai.apiKey,
    model: ai.model,
    system: buildAllocSystemPrompt(),
    tools: [PROPOSE_ALLOCATIONS_TOOL],
    toolName: PROPOSE_ALLOCATIONS_TOOL.name,
    messages: [{ role: "user", content: userMessage }],
    // A worst-case MAX_ALLOC_CELLS=200 proposal serializes to roughly
    // 2,900-3,300 tokens of tool-use JSON alone; 4096 left too little
    // headroom for a broad request and a truncated response surfaced as an
    // undifferentiated Error("parse"). 8192 gives real room; the system
    // prompt also asks the model to prioritise rather than enumerate
    // exhaustively when a request is very broad.
    maxTokens: 8192,
    signal,
  });
  const parsed = parseAllocationProposal(input);
  if (!parsed) throw new Error("parse");
  return parsed;
}
