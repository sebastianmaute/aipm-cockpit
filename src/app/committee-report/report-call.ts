// The steering-committee status report: one call through the shared forced-tool envelope, and a second
// with a larger budget when the first reply is cut. Mirrors scheduled-job-analysis.ts. Each call can be
// several requests inside the envelope: a model that refuses a forced tool_choice is asked with `auto`,
// and an auto reply that breaks the schema WITHOUT being cut is re-asked strict.
// Routes through the shared runForcedToolCallWithRetry envelope (a DIRECT one-shot fetch,
// NOT chat-api's callClaude, which embeds the response body in its thrown message
// and would leak it); the api key and response body are NEVER logged or echoed —
// thrown errors carry only the HTTP status (AiHttpError, message status-only) or
// the token "parse".
import { PRIVACY_NOT_YET_THREADED } from "../ai-privacy";
import type { Lang } from "../i18n";
import type { DashboardModel } from "../dashboard";
import { runForcedToolCallWithRetry } from "../ai-forced-call";
import { REPORT_TOOL, buildMeetingReportPrompt, parseMeetingReport } from "./report-draft";

export interface MeetingReportCtx {
  apiKey: string;
  model: string;
  lang: Lang;
  /** The user's guides for this action (§701), from `actionGuideText`. This
   *  call has no fixed system prompt, so the guides are the whole of it. */
  guideText?: string;
}

// §763 — the report is about 1.8–2.0k tokens, and a model asked with `auto` tool choice (one that refuses a
// forced choice) thinks first, on the same budget: at 2048 two of three plain replies stopped at max_tokens
// with the tool input `{}`. As `scheduled-job-analysis.ts`: 4096, and a cut reply is asked for once more
// with 8192. ★ A cut costs at least two billed replies (4096, then 8192): since §764 the envelope returns a cut
// reply as it is, never re-asking it strict (`runForcedToolCallWithRetry`, ai-forced-call.ts). On an `auto`
// model the 8192 reply can still come back whole but off-schema and be re-asked strict, a third. Billing
// counts the tokens each reply used.
const MAX_TOKENS = 4096;
const RETRY_MAX_TOKENS = 8192;

/** Run one forced write_status_report tool call and return the parsed HTML body.
 *  A reply cut at the output budget is never read (its html may be a half report
 *  that still parses); it is asked for once more with RETRY_MAX_TOKENS.
 *  Throws AiHttpError(status) on a non-OK response (message status-only) and
 *  Error("parse") on absent/malformed tool output, or when the retry is cut too.
 *  The api key and response body are NEVER included in the thrown message. */
export async function runMeetingReport(
  model: DashboardModel,
  agenda: string,
  ctx: MeetingReportCtx,
  signal?: AbortSignal,
): Promise<string> {
  const content = buildMeetingReportPrompt(model, agenda, ctx.lang);
  const reply = await runForcedToolCallWithRetry(
    {
      apiKey: ctx.apiKey,
      privacy: PRIVACY_NOT_YET_THREADED,
      model: ctx.model,
      guideText: ctx.guideText,
      tools: [REPORT_TOOL],
      toolName: "write_status_report",
      messages: [{ role: "user", content }],
      maxTokens: MAX_TOKENS,
      signal,
    },
    RETRY_MAX_TOKENS,
  );
  const html =
    reply.stopReason === "max_tokens" ? null : parseMeetingReport((reply.input as { html?: unknown }).html);
  if (html === null) throw new Error("parse");
  return html;
}
