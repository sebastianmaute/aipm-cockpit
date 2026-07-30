// ONE forced tool call for "Suggest RACI". Mirrors task-dedup-call.ts: no
// agentic loop, and the api key goes to the shared never-log envelope only —
// it is a request HEADER there and is never logged or echoed.
import { runForcedToolCall } from "./ai-forced-call";
import {
  parseRaciProposal,
  RACI_SUGGEST_TOOL,
  type ProposedCell,
} from "./raci-suggest/raci-suggest";

const MAX_TOKENS = 4096;

const SYSTEM =
  "You assign RACI roles for project milestones. Use the stakeholder's title, " +
  "organization, category, influence and interest to decide. Exactly one " +
  "Accountable per milestone. Prefer omitting a cell to guessing. Do not " +
  "restate assignments that already exist.";

export async function runRaciSuggestion(
  context: { text: string; truncated: boolean },
  ai: { apiKey: string; model: string },
  signal?: AbortSignal,
): Promise<{ cells: ProposedCell[]; truncated: boolean }> {
  const raw = await runForcedToolCall({
    apiKey: ai.apiKey,
    model: ai.model,
    system: SYSTEM,
    tools: [RACI_SUGGEST_TOOL],
    toolName: RACI_SUGGEST_TOOL.name,
    messages: [{ role: "user", content: context.text }],
    maxTokens: MAX_TOKENS,
    signal,
  });
  return parseRaciProposal(raw);
}
