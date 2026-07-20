// Non-hook single forced-tool Anthropic call for insight recommendations.
// Mirrors task-dedup-call.ts: ONE request, tool_choice forced, NO agentic loop.
// Grounding happens in parseRecommendation; the api key/body are NEVER logged
// (the shared runForcedToolCall envelope guarantees it). Thrown errors carry
// only the HTTP status (AiHttpError) or the token "parse".
import { runForcedToolCall } from "../ai-forced-call";
import { RECOMMEND_TOOL, parseRecommendation } from "./recommend";
import { buildRecommendSystemPrompt } from "./recommend-context";
import type { GroundingIndex } from "../action-ai";
import type { InsightRecommendation } from "./insight";

export interface RecommendCallArgs {
  apiKey: string;
  model: string;
  context: string;
  index: GroundingIndex;
  today: string;
  signal?: AbortSignal;
}

/** Run one forced propose_insight_actions tool call and return the grounded
 *  recommendation. Throws AiHttpError(status, errorType?, safeMessage?) on a
 *  non-OK response and Error("parse") on absent/malformed/ungrounded tool
 *  output. The api key is NEVER included in the thrown error — only the
 *  status + safe body tokens. */
export async function runInsightRecommendation(
  args: RecommendCallArgs,
): Promise<InsightRecommendation> {
  const input = await runForcedToolCall({
    apiKey: args.apiKey,
    model: args.model,
    system: buildRecommendSystemPrompt(),
    tools: [RECOMMEND_TOOL],
    toolName: RECOMMEND_TOOL.name,
    messages: [{ role: "user", content: args.context }],
    maxTokens: 2048,
    signal: args.signal,
  });
  const parsed = parseRecommendation(input, args.index);
  if (!parsed) throw new Error("parse");
  return { ...parsed, generatedAt: args.today };
}
