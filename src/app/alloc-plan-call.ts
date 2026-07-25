// src/app/alloc-plan-call.ts
//
// Non-hook single forced-tool Anthropic call for AI allocation planning.
// Mirrors task-dedup-call.ts: ONE request, tool_choice forced, NO agentic loop.
// Returns the RAW parsed cells — grounding against the live workspace happens
// in the caller (groundAllocationCells), never here.
//
// SECURITY: the shared runForcedToolCall envelope never logs or echoes the api
// key or the raw response body. Thrown errors carry only the HTTP status
// (AiHttpError, message status-only) or the token "parse" for malformed output.
import {
  PROPOSE_ALLOCATIONS_TOOL,
  buildAllocSystemPrompt,
  parseAllocationProposal,
  type RawAllocCell,
} from "./alloc-plan/alloc-plan";
import { runForcedToolCall } from "./ai-forced-call";

interface AiCreds {
  apiKey: string;
  model: string;
}

/** Run one forced propose_allocations tool call and return the raw parsed
 *  cells. Throws AiHttpError(status, errorType?, safeMessage?) on a non-OK
 *  response and Error("parse") on absent/malformed tool output. The api key is
 *  NEVER included in the thrown error — only the status + safe body tokens. */
export async function runAllocProposal(
  context: string,
  ai: AiCreds,
  instruction: string,
  signal?: AbortSignal,
): Promise<RawAllocCell[]> {
  // The context digest is `#`/newline-formatted data; the instruction is free
  // user text. Delimiting them with a labeled separator (rather than simple
  // concatenation) keeps the model from reading the instruction as another
  // digest line or the digest as part of the request.
  const userMessage = `${context}\n\n---\nUSER REQUEST: ${instruction}`;

  const input = await runForcedToolCall({
    apiKey: ai.apiKey,
    model: ai.model,
    system: buildAllocSystemPrompt(),
    tools: [PROPOSE_ALLOCATIONS_TOOL],
    toolName: PROPOSE_ALLOCATIONS_TOOL.name,
    messages: [{ role: "user", content: userMessage }],
    maxTokens: 4096,
    signal,
  });
  const parsed = parseAllocationProposal(input);
  if (!parsed) throw new Error("parse");
  return parsed;
}
