// One forced-tool Anthropic call producing a steering-committee status report.
// Routes through the shared runForcedToolCall envelope (a DIRECT one-shot fetch,
// NOT chat-api's callClaude, which embeds the response body in its thrown message
// and would leak it); the api key and response body are NEVER logged or echoed —
// thrown errors carry only the HTTP status (AiHttpError, message status-only) or
// the token "parse".
import type { Lang } from "../i18n";
import type { DashboardModel } from "../dashboard";
import { runForcedToolCall } from "../ai-forced-call";
import { REPORT_TOOL, buildMeetingReportPrompt, parseMeetingReport } from "./report-draft";

export interface MeetingReportCtx {
  apiKey: string;
  model: string;
  lang: Lang;
}

/** Run one forced write_status_report tool call and return the parsed HTML body.
 *  Throws AiHttpError(status) on a non-OK response (message status-only) and
 *  Error("parse") on absent/malformed tool output. The api key and response body
 *  are NEVER included in the thrown message. */
export async function runMeetingReport(
  model: DashboardModel,
  agenda: string,
  ctx: MeetingReportCtx,
  signal?: AbortSignal,
): Promise<string> {
  const input = await runForcedToolCall({
    apiKey: ctx.apiKey,
    model: ctx.model,
    tools: [REPORT_TOOL],
    toolName: "write_status_report",
    messages: [{ role: "user", content: buildMeetingReportPrompt(model, agenda, ctx.lang) }],
    maxTokens: 2048,
    signal,
  });
  const html = parseMeetingReport((input as { html?: unknown }).html);
  if (html === null) throw new Error("parse");
  return html;
}
