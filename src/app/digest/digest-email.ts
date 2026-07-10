// Pure brand-inline HTML + subject for the Graph-sent digest email. Email
// clients ignore CSS vars → literal AIPM hex. All fact text HTML-escaped; no
// user free-text is injected unescaped.
import { t, type Lang } from "../i18n";
import type { Health } from "../health";
import type { DigestModel } from "./digest-model";

const RAG_HEX: Record<Health, string> = { R: "#d0021b", A: "#f5a623", G: "#417505" };
const DARK_BLUE = "#003c78";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ragLabel(lang: Lang, h: Health): string {
  return t(lang, h === "R" ? "healthRed" : h === "A" ? "healthAmber" : "healthGreen");
}

export function buildDigestEmailSubject(model: DigestModel, lang: Lang): string {
  return t(lang, "digestEmailSubject", ragLabel(lang, model.rag));
}

export function buildDigestEmailHtml(model: DigestModel, lang: Lang): string {
  const rows: string[] = [];
  rows.push(
    `<tr><td style="padding:4px 8px;color:${DARK_BLUE};font-weight:bold">${esc(t(lang, "digestRag"))}</td>` +
      `<td style="padding:4px 8px;color:${RAG_HEX[model.rag]};font-weight:bold">${esc(ragLabel(lang, model.rag))}</td></tr>`,
  );
  rows.push(
    `<tr><td style="padding:4px 8px">${esc(t(lang, "digestOverdue"))}</td>` +
      `<td style="padding:4px 8px">${model.overdue.count}</td></tr>`,
  );
  rows.push(
    `<tr><td style="padding:4px 8px">${esc(t(lang, "digestOpenRaid"))}</td>` +
      `<td style="padding:4px 8px">${model.openRaid.count} (${model.openRaid.high} ${esc(t(lang, "digestHigh"))})</td></tr>`,
  );
  const ms = model.milestonesDueSoon
    .map((m) => `<li>${esc(m.name)} — ${esc(m.date)}</li>`)
    .join("");
  const narrative = model.narrative
    ? `<p style="margin:0 0 12px 0">${esc(model.narrative)}</p>`
    : "";
  return (
    `<div style="font-family:Arial,sans-serif;color:#222;max-width:600px">` +
    `<h2 style="color:${DARK_BLUE};margin:0 0 12px 0">${esc(t(lang, "digestTitle"))}</h2>` +
    narrative +
    `<table style="border-collapse:collapse;margin-bottom:12px">${rows.join("")}</table>` +
    (ms
      ? `<h3 style="color:${DARK_BLUE};margin:0 0 4px 0">${esc(t(lang, "digestMilestonesDueSoon"))}</h3><ul style="margin:0 0 12px 18px;padding:0">${ms}</ul>`
      : "") +
    `</div>`
  );
}
