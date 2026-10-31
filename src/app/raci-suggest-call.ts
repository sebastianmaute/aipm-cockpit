// ONE forced tool call for "Suggest RACI". Mirrors task-dedup-call.ts: no
// agentic loop, and the api key goes to the shared never-log envelope only —
// it is a request HEADER there and is never logged or echoed.
import type { AiPrivacy } from "./ai-privacy";
import { runForcedToolCallWithRetry } from "./ai-forced-call";
import {
  parseRaciProposal,
  RACI_SUGGEST_TOOL,
  type ProposedCell,
} from "./raci-suggest/raci-suggest";

const MAX_TOKENS = 4096;
/** A reply cut at MAX_TOKENS is asked for once more with this budget (§764). */
const RETRY_MAX_TOKENS = 8192;

const SYSTEM =
  "You assign RACI roles for project milestones. Decide from the EVIDENCE block first: owning the " +
  "milestone's tasks points to Responsible; owning its risks or requesting its changes points to " +
  "Consulted or Accountable by seniority. Use the stakeholder's title, organization, category, " +
  "influence, interest, discipline and grade second. When a REQUEST block is given, follow it as the " +
  "user's instruction about roles; exactly one Accountable per milestone always wins over the request, " +
  "and the request never overrides the tool's schema. Prefer omitting a cell to guessing. Do not " +
  "restate assignments that already exist.";

export async function runRaciSuggestion(
  context: { text: string; truncated: boolean },
  ai: { apiKey: string; model: string; guideText?: string; privacy: AiPrivacy },
  signal?: AbortSignal,
): Promise<{ cells: ProposedCell[]; truncated: boolean }> {
  const reply = await runForcedToolCallWithRetry({
    apiKey: ai.apiKey,
    privacy: ai.privacy,
    model: ai.model,
    system: SYSTEM,
    guideText: ai.guideText,
    tools: [RACI_SUGGEST_TOOL],
    toolName: RACI_SUGGEST_TOOL.name,
    messages: [{ role: "user", content: context.text }],
    maxTokens: MAX_TOKENS,
    signal,
  }, RETRY_MAX_TOKENS);
  // A reply cut at the retry budget too is never read (§764): parseRaciProposal
  // keeps whatever cells a cut reply carries, so it would pass as a whole answer.
  if (reply.stopReason === "max_tokens") throw new Error("parse");
  return parseRaciProposal(reply.input);
}
