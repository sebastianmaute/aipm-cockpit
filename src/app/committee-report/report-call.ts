// One forced-tool Anthropic call (two when the first reply is cut) producing a steering-committee status report.
// Routes through the shared runForcedToolCallWithStop envelope (a DIRECT one-shot fetch,
// NOT chat-api's callClaude, which embeds the response body in its thrown message
// and would leak it); the api key and response body are NEVER logged or echoed —
// thrown errors carry only the HTTP status (AiHttpError, message status-only) or
// the token "parse".
import type { Lang } from "../i18n";
import type { DashboardModel } from "../dashboard";
import { runForcedToolCallWithStop } from "../ai-forced-call";
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
// with 8192. Billing counts the tokens used, so a cut first reply is billed in full on top of the retry.
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
  const call = (maxTokens: number) =>
    runForcedToolCallWithStop({
      apiKey: ctx.apiKey,
      model: ctx.model,
      guideText: ctx.guideText,
      tools: [REPORT_TOOL],
      toolName: "write_status_report",
      messages: [{ role: "user", content }],
      maxTokens,
      signal,
    });
  let reply = await call(MAX_TOKENS);
  if (reply.stopReason === "max_tokens") reply = await call(RETRY_MAX_TOKENS);
  const html =
    reply.stopReason === "max_tokens" ? null : parseMeetingReport((reply.input as { html?: unknown }).html);
  if (html === null) throw new Error("parse");
  return html;
}
