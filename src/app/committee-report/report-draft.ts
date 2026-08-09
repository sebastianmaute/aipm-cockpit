// Optional AI steering-committee status report. Pure, i18n-free (English-only
// prompt). The Anthropic call itself lives in report-call.ts; this module holds
// the forced-tool schema, the output sanitizer, and the prompt builder. Mirrors
// digest/digest-narrative.ts for security: no key/body ever appears here.
import type { Lang } from "../i18n";
import { type DashboardModel, hasNoActiveScope } from "../dashboard";

// Shared control-char scrub (hex escapes — never literal control bytes).
const CONTROL_CHARS = /[\x00-\x1f]/g;
const MAX_REPORT = 100_000;

/** Forced tool: the model must return the report body as a single HTML string. */
export const REPORT_TOOL = {
  name: "write_status_report",
  description:
    "Return the steering-committee status report body as simple HTML (p/ul/li/strong/h2).",
  input_schema: {
    type: "object",
    properties: {
      html: { type: "string", description: "Report body as simple HTML (p/ul/li/strong/h2)." },
    },
    required: ["html"],
  },
} as const;

/** Sanitize untrusted model output: non-string → null; strip control chars,
 *  trim, empty → null, cap length. */
export function parseMeetingReport(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(CONTROL_CHARS, "").trim().slice(0, MAX_REPORT);
  return cleaned.length > 0 ? cleaned : null;
}

function ragLabel(h: "R" | "A" | "G"): string {
  return h === "R" ? "Red" : h === "A" ? "Amber" : "Green";
}

/** Build the English prose prompt instructing Claude to write a steering-committee
 *  status report as simple HTML, summarizing the dashboard model and weaving in
 *  the meeting agenda. */
export function buildMeetingReportPrompt(model: DashboardModel, agenda: string, lang: Lang): string {
  const rag = ragLabel(model.overall.effective);
  const changes =
    model.topChanges.map((c) => c.title).filter(Boolean).slice(0, 5).join("; ") || "none";
  const milestone = (list: DashboardModel["overdueMilestones"]): string =>
    list.map((m) => `${m.name} (${m.date})`).join("; ") || "none";
  const agendaLines =
    agenda
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => `  - ${l}`)
      .join("\n") || "  - (none provided)";

  return (
    `You are writing a concise steering-committee status report for a project manager.\n` +
    `Write the report body as SIMPLE HTML using only these tags: <h2>, <p>, <ul>, <li>, <strong>. ` +
    `Do NOT include <html>, <head>, <body>, inline styles, scripts, or markdown.\n` +
    `Output language: ${lang === "de" ? "German" : "English"}.\n\n` +
    `Structure the report with these <h2> sections, in order:\n` +
    `  1. Executive summary\n` +
    `  2. Progress\n` +
    `  3. Risks and issues\n` +
    `  4. Decisions needed\n` +
    `  5. Next steps\n\n` +
    `Base the report on these project facts:\n` +
    `- Overall RAG status: ${rag}\n` +
    // ★ An all-cancelled project is not "0% complete" — that reads as "not
    //   started yet", and the model can restate it in generated prose that a
    //   steering committee then reads (open-followups §64).
    (hasNoActiveScope(model.progress)
      ? `- Completion: no active scope — all ${model.progress.total} tasks are cancelled\n`
      // inScope, NOT total: this pair sits inside the same sentence as the
      // percentage, and a model handed 100% beside "5 of 10" will contradict itself.
      : `- Completion: ${model.progress.percent}% complete ` +
        `(${model.progress.completed} of ${model.progress.inScope} tasks done)\n`) +
    `- Overdue tasks: ${model.overdue.length}\n` +
    `- Tasks due soon: ${model.dueSoon.length}\n` +
    `- Open RAID items: ${model.openRaidCount}\n` +
    `- Change requests: ${model.changes.total} total ` +
    `(${model.changes.pending} pending, ${model.changes.approved} approved)\n` +
    `- Notable changes: ${changes}\n` +
    `- Overdue milestones: ${milestone(model.overdueMilestones)}\n` +
    `- At-risk milestones: ${milestone(model.atRiskMilestones)}\n` +
    `- Milestones due soon: ${milestone(model.dueSoonMilestones)}\n\n` +
    `The upcoming meeting agenda is:\n${agendaLines}\n\n` +
    `Weave the agenda topics into the relevant sections (especially "Decisions needed" and ` +
    `"Next steps"), grounding each point in the facts above. Be factual and specific; do not ` +
    `invent data not present in the facts. Return ONLY the HTML report body via the ` +
    `write_status_report tool.`
  );
}
