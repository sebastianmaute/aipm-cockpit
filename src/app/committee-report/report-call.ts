// One forced-tool Anthropic call producing a steering-committee status report.
// Mirrors digest/digest-narrative.ts EXACTLY for security: a DIRECT fetch (not
// chat-api's callClaude, which embeds the response body in its thrown message and
// would leak it); the api key and response body are NEVER logged or echoed —
// thrown errors carry only the HTTP status (as digits) or the token "parse".
import type { Lang } from "../i18n";
import type { DashboardModel } from "../dashboard";
import { REPORT_TOOL, buildMeetingReportPrompt, parseMeetingReport } from "./report-draft";

const ANTHROPIC_VERSION = "2023-06-01";

interface ToolUseBlock {
  type: string;
  name?: string;
  input?: unknown;
}

export interface MeetingReportCtx {
  apiKey: string;
  model: string;
  lang: Lang;
}

/** Run one forced write_status_report tool call and return the parsed HTML body.
 *  Throws Error(status) on a non-OK response and Error("parse") on malformed or
 *  empty tool output. The api key and response body are NEVER included in the
 *  thrown message. */
export async function runMeetingReport(
  model: DashboardModel,
  agenda: string,
  ctx: MeetingReportCtx,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ctx.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ctx.model,
      max_tokens: 2048,
      messages: [{ role: "user", content: buildMeetingReportPrompt(model, agenda, ctx.lang) }],
      tools: [REPORT_TOOL],
      tool_choice: { type: "tool", name: "write_status_report" },
    }),
    signal,
  });
  if (!res.ok) throw new Error(String(res.status)); // status only — never echo key/body
  const json = (await res.json()) as { content?: ToolUseBlock[] };
  const toolUse = (json.content ?? []).find(
    (b) => b.type === "tool_use" && b.name === "write_status_report",
  );
  const input = toolUse?.input as { html?: unknown } | undefined;
  const html = parseMeetingReport(input?.html);
  if (html === null) throw new Error("parse");
  return html;
}
