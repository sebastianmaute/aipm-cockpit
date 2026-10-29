// Non-hook forced-tool Anthropic call for insight recommendations, NO agentic loop.
// One call through the shared envelope, and a second with a larger budget when the
// first reply is cut (mirrors scheduled-job-analysis.ts). Inside the envelope a call
// can be several requests: a model that refuses a forced tool_choice is asked with
// `auto`, and a reply that breaks the schema is re-asked strict.
// Grounding happens in parseRecommendation; the api key/body are NEVER logged
// (the shared runForcedToolCallWithStop envelope guarantees it). Thrown errors carry
// only the HTTP status (AiHttpError) or the token "parse".
import { runForcedToolCallWithRetry } from "../ai-forced-call";
import type { AiConsentLevel } from "../ai-consent";
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
  /** The user's guides for this action (§701), from `actionGuideText`. */
  guideText?: string;
  /** Cache the guide prefix: set by the recommendation runner, which works
   *  through several insights in one tick (`runForcedToolCall`'s `cacheGuides`). */
  cacheGuides?: boolean;
  /** The consent each request needs: the background runner passes `background`; a click passes nothing
   *  (interactive). */
  level?: AiConsentLevel;
}

// §763 — a model asked with `auto` tool choice (one that refuses a forced choice) thinks first, on the
// same output budget, so up to five proposed calls could overrun 2048; a reply cut there carries `{}` or
// only its first calls, and the latter grounds and parses. As `scheduled-job-analysis.ts`: 4096, a cut
// reply asked for once more with 8192, and a cut reply never read. A cut costs two billed replies; see
// report-call.ts.
const MAX_TOKENS = 4096;
const RETRY_MAX_TOKENS = 8192;

/** Run one forced propose_insight_actions tool call (two when the first reply is
 *  cut) and return the grounded recommendation. Throws AiHttpError(status,
 *  errorType?, safeMessage?) on a non-OK response and Error("parse") on
 *  absent/malformed/ungrounded tool output, or when the retry is cut too. The
 *  api key is NEVER included in the thrown error — only the status + safe body
 *  tokens. */
export async function runInsightRecommendation(
  args: RecommendCallArgs,
): Promise<InsightRecommendation> {
  const reply = await runForcedToolCallWithRetry(
    {
      apiKey: args.apiKey,
      model: args.model,
      system: buildRecommendSystemPrompt(),
      guideText: args.guideText,
      cacheGuides: args.cacheGuides,
      level: args.level,
      tools: [RECOMMEND_TOOL],
      toolName: RECOMMEND_TOOL.name,
      messages: [{ role: "user", content: args.context }],
      maxTokens: MAX_TOKENS,
      signal: args.signal,
    },
    RETRY_MAX_TOKENS,
  );
  const parsed = reply.stopReason === "max_tokens" ? null : parseRecommendation(reply.input, args.index);
  if (!parsed) throw new Error("parse");
  return { ...parsed, generatedAt: args.today };
}
