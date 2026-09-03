// src/app/mail-extract.ts — the normalised mail type and its Markdown renderer.
//
// ★★★ THIS MODULE MUST NOT IMPORT attachment-ingest.ts. The recursion is
// INVERTED on purpose: ParsedMail.attachments carries raw, unprocessed bytes
// and the orchestrator (attachment-ingest.ts) drives the tree walk that turns
// each one into its own extraction, in a later task. Calling back the other
// way creates an import cycle and makes every mail parser impure and
// untestable in isolation.
//
// Hostile-input surface: a ParsedMail can be built from an untrusted .eml (or
// later .msg) file — see eml-extract.ts. This renderer therefore bounds
// every field it prints, not just the body: mime-parse.ts's MAX_HEADER_BYTES
// allows a single raw header up to 64KB, which would otherwise render as one
// huge unbroken Markdown line (a subject, a From address, or one To/Cc
// entry). eml-extract.ts already caps how many addresses and attachments
// reach a ParsedMail at all, but this renderer is a public function any
// future mail parser can feed, so it re-bounds attachments and diagnostics
// independently rather than trusting the caller.

import { parseMimeMessage } from "./mime-parse";
import { emlToParsedMail } from "./eml-extract";

export type ParsedMail = {
  headers: {
    from: string;
    to: readonly string[];
    cc: readonly string[];
    subject: string;
    /** ISO 8601, or "" when unparseable — never a fabricated date. */
    date: string;
  };
  body: { kind: "html" | "text" | "rtf-degraded"; content: string };
  attachments: readonly { fileName: string; mimeType: string; bytes: Uint8Array }[];
  diagnostics: readonly string[];
};

/** Minimum body characters a mail keeps even under budget pressure, so a long
 *  thread can never starve its own attachments and vice versa. */
export const MAIL_BODY_FLOOR = 20_000;

/** Cap on a single rendered header field (subject, from, or one to/cc
 *  entry). A real value is a handful of words; anything past this is either
 *  a malformed header or a hostile one padded to inflate the rendered
 *  output. */
export const MAX_HEADER_FIELD_CHARS = 500;

/** Cap on a rendered attachment's MIME type — shorter than
 *  MAX_HEADER_FIELD_CHARS because a real MIME type is a handful of
 *  characters and mime-parse.ts derives it from an unbounded prefix of the
 *  Content-Type header when no ";" is present. */
export const MAX_MIME_TYPE_CHARS = 100;

/** Cap on attachments listed in the rendered summary. */
export const MAX_ATTACHMENTS_RENDERED = 200;

/** Cap on parser diagnostics echoed into the rendered output. */
export const MAX_DIAGNOSTICS_RENDERED = 20;

/** Absolute backstop on the whole rendered string, applied after every
 *  per-field cap above. Those bound each field individually; this bounds
 *  their sum, which a message with many long-but-individually-legal fields
 *  (e.g. close to MAX_ATTACHMENTS_RENDERED attachments each with a
 *  near-MAX_HEADER_FIELD_CHARS name) could still add up past. */
export const MAIL_MARKDOWN_HARD_CAP = 300_000;

function truncateField(s: string, max: number = MAX_HEADER_FIELD_CHARS): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function renderMailMarkdown(mail: ParsedMail, bodyBudget: number): string {
  const h = mail.headers;
  const lines: string[] = [];
  if (h.subject) lines.push(`**Subject:** ${truncateField(h.subject)}`);
  if (h.from) lines.push(`**From:** ${truncateField(h.from)}`);
  if (h.to.length > 0) lines.push(`**To:** ${h.to.map((a) => truncateField(a)).join(", ")}`);
  if (h.cc.length > 0) lines.push(`**Cc:** ${h.cc.map((a) => truncateField(a)).join(", ")}`);
  if (h.date) lines.push(`**Date:** ${h.date}`);

  if (mail.attachments.length > 0) {
    lines.push("");
    lines.push(`**Attachments (${mail.attachments.length}):**`);
    const shown = mail.attachments.slice(0, MAX_ATTACHMENTS_RENDERED);
    for (const a of shown) {
      lines.push(`- ${truncateField(a.fileName)} (${truncateField(a.mimeType, MAX_MIME_TYPE_CHARS)})`);
    }
    if (mail.attachments.length > shown.length) {
      lines.push(`- _(${mail.attachments.length - shown.length} more attachments not listed)_`);
    }
  }

  let body = mail.body.content;
  if (body.length > bodyBudget) {
    body = `${body.slice(0, bodyBudget)}\n\n_(truncated - mail body exceeded its share of the extraction budget)_`;
  }
  if (mail.body.kind === "rtf-degraded") {
    lines.push("");
    lines.push("_(formatting could not be recovered from this message; plain text follows)_");
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(body);

  const diagShown = mail.diagnostics.slice(0, MAX_DIAGNOSTICS_RENDERED);
  for (const d of diagShown) lines.push(`\n_(${d})_`);
  if (mail.diagnostics.length > diagShown.length) {
    lines.push(`\n_(${mail.diagnostics.length - diagShown.length} more parser diagnostics not shown)_`);
  }

  const rendered = lines.join("\n");
  if (rendered.length <= MAIL_MARKDOWN_HARD_CAP) return rendered;
  return `${rendered.slice(0, MAIL_MARKDOWN_HARD_CAP)}\n\n_(output exceeded the hard size cap and was cut)_`;
}

/** Detect a `.msg` compound file by its MS-CFB signature. A later task adds
 *  the msg branch; until then such a file reports an unsupported-format
 *  diagnostic rather than being silently (and destructively) parsed as MIME
 *  text — .msg is a binary compound-document format, not RFC 5322 text. */
const CFBF_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export function looksLikeCfbf(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && CFBF_SIGNATURE.every((v, i) => bytes[i] === v);
}

/** The one router from raw bytes to a `ParsedMail`, for every mail format
 *  `classifyAttachment` maps to "mail" — .eml, .mhtml, .mht today, and (once
 *  a future task adds a CFBF-aware parser) .msg. Kept in this module rather
 *  than the orchestrator so any future caller gets the same format
 *  detection `attachment-ingest.ts` uses, instead of reimplementing it. */
export function parseMail(bytes: Uint8Array): ParsedMail {
  if (looksLikeCfbf(bytes)) {
    return {
      headers: { from: "", to: [], cc: [], subject: "", date: "" },
      body: { kind: "text", content: "" },
      attachments: [],
      diagnostics: ["Outlook .msg support is not enabled in this build"],
    };
  }
  return emlToParsedMail(parseMimeMessage(new TextDecoder().decode(bytes)));
}
