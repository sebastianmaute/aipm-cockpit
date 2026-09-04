// src/app/mail-extract.ts — the normalised mail type and its Markdown renderer.
//
// ★★★ THIS MODULE MUST NOT IMPORT attachment-ingest.ts. The recursion is
// INVERTED on purpose: ParsedMail.attachments carries raw, unprocessed bytes
// and the orchestrator (attachment-ingest.ts) drives the tree walk that turns
// each one into its own extraction, in a later task. Calling back the other
// way creates an import cycle and makes every mail parser impure and
// untestable in isolation.
//
// Hostile-input surface: a ParsedMail can be built from an untrusted .eml or
// .msg file — see eml-extract.ts and msg-extract.ts. This renderer therefore bounds
// every field it prints, not just the body — `date` excepted, taken on the
// parser's ISO-or-empty contract. mime-parse.ts's MAX_HEADER_BYTES
// allows a single raw header up to 64KB, which would otherwise render as one
// huge unbroken Markdown line (a subject, a From address, or one To/Cc
// entry). eml-extract.ts already caps how many addresses and attachments
// reach a ParsedMail at all, but this renderer is a public function any
// future mail parser can feed, so it re-bounds attachments and diagnostics
// independently rather than trusting the caller.

import { parseMimeMessage } from "./mime-parse";
import { emlToParsedMail } from "./eml-extract";
import { readCfbfTree } from "./cfbf";
import { msgToParsedMail } from "./msg-extract";

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

/** Exported so any caller assembling its OWN Markdown from `ParsedMail`
 *  fields (attachment-ingest.ts's diagnostic notes included) gets the same
 *  per-field bound this renderer holds itself to — see the header comment's
 *  "bounds every field it prints" claim. Truncating an attacker-controlled
 *  filename before it reaches a diagnostic string is exactly what this
 *  guards; a diagnostic is not exempt just because it isn't a header. */
export function truncateField(s: string, max: number = MAX_HEADER_FIELD_CHARS): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** The three independently-sized pieces of a rendered mail, in the order
 *  they're meant to be concatenated: `prefix` (headers + attachment-list
 *  summary) is the only one safe to trim under further budget pressure — it
 *  is a SUMMARY, not the thread's own words. `diagnostics` and `body` are
 *  each already bounded on their own terms (diagnostics by
 *  MAX_DIAGNOSTICS_RENDERED + truncateField per entry; body by
 *  `bodyBudget`), so a caller enforcing some larger ceiling should shrink
 *  `prefix` to make room for them rather than truncating the concatenated
 *  whole from the tail — cutting from the tail risks cutting the body, or
 *  worse, a diagnostic explaining that something else was already cut.
 *  `renderMailMarkdown` below is the simple, non-budget-aware caller: it
 *  just concatenates all three and applies MAIL_MARKDOWN_HARD_CAP as a flat
 *  backstop. attachment-ingest.ts's `ingestNode` is the budget-aware one. */
export type RenderedMailParts = {
  prefix: string;
  diagnostics: string;
  body: string;
};

export function renderMailParts(mail: ParsedMail, bodyBudget: number): RenderedMailParts {
  const h = mail.headers;
  const prefixLines: string[] = [];
  if (h.subject) prefixLines.push(`**Subject:** ${truncateField(h.subject)}`);
  if (h.from) prefixLines.push(`**From:** ${truncateField(h.from)}`);
  if (h.to.length > 0) prefixLines.push(`**To:** ${h.to.map((a) => truncateField(a)).join(", ")}`);
  if (h.cc.length > 0) prefixLines.push(`**Cc:** ${h.cc.map((a) => truncateField(a)).join(", ")}`);
  if (h.date) prefixLines.push(`**Date:** ${h.date}`);

  if (mail.attachments.length > 0) {
    prefixLines.push("");
    prefixLines.push(`**Attachments (${mail.attachments.length}):**`);
    const shown = mail.attachments.slice(0, MAX_ATTACHMENTS_RENDERED);
    for (const a of shown) {
      prefixLines.push(`- ${truncateField(a.fileName)} (${truncateField(a.mimeType, MAX_MIME_TYPE_CHARS)})`);
    }
    if (mail.attachments.length > shown.length) {
      prefixLines.push(`- _(${mail.attachments.length - shown.length} more attachments not listed)_`);
    }
  }

  // Diagnostics are rendered as their OWN piece — not appended after the
  // body — specifically so a caller enforcing a downstream ceiling can put
  // them ahead of the body in the final concatenation: a drop notice must
  // never be the thing a backstop truncation cuts.
  const diagShown = mail.diagnostics.slice(0, MAX_DIAGNOSTICS_RENDERED);
  const diagnosticsLines = diagShown.map((d) => `_(${truncateField(d)})_`);
  if (mail.diagnostics.length > diagShown.length) {
    diagnosticsLines.push(`_(${mail.diagnostics.length - diagShown.length} more parser diagnostics not shown)_`);
  }

  let body = mail.body.content;
  if (body.length > bodyBudget) {
    body = `${body.slice(0, bodyBudget)}\n\n_(truncated - mail body exceeded its share of the extraction budget)_`;
  }
  const bodyLines = ["---", ""];
  if (mail.body.kind === "rtf-degraded") {
    bodyLines.push("_(formatting could not be recovered from this message; plain text follows)_");
    bodyLines.push("");
  }
  bodyLines.push(body);

  return {
    prefix: prefixLines.join("\n"),
    diagnostics: diagnosticsLines.join("\n"),
    body: bodyLines.join("\n"),
  };
}

export function renderMailMarkdown(mail: ParsedMail, bodyBudget: number): string {
  const { prefix, diagnostics, body } = renderMailParts(mail, bodyBudget);
  const rendered = [prefix, diagnostics, body].filter((s) => s.length > 0).join("\n\n");
  if (rendered.length <= MAIL_MARKDOWN_HARD_CAP) return rendered;
  return `${rendered.slice(0, MAIL_MARKDOWN_HARD_CAP)}\n\n_(output exceeded the hard size cap and was cut)_`;
}

/** Detect a `.msg` compound file by its MS-CFB signature, so `parseMail`
 *  below can route it to the CFBF-aware reader instead of the MIME-text
 *  parser — .msg is a binary compound-document format, not RFC 5322 text,
 *  and decoding it as UTF-8 first would destroy the bytes `readCfbfTree`
 *  needs without ever throwing. */
const CFBF_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export function looksLikeCfbf(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && CFBF_SIGNATURE.every((v, i) => bytes[i] === v);
}

/** The one router from raw bytes to a `ParsedMail`, for every mail format
 *  `classifyAttachment` maps to "mail" — .eml, .mhtml, .mht as text, and
 *  .msg as a binary CFBF compound file. Kept in this module rather than the
 *  orchestrator so any future caller gets the same format detection
 *  `attachment-ingest.ts` uses, instead of reimplementing it.
 *
 *  ★★★ `bytes` MUST reach this function undecoded. The CFBF branch below
 *  reads `bytes` as raw binary (`readCfbfTree`/`msgToParsedMail`); only the
 *  text branch's own `TextDecoder().decode(bytes)` call turns it into a
 *  string, and only after `looksLikeCfbf` has already ruled out a compound
 *  file. A caller that decodes `bytes` to text before calling this — e.g.
 *  to reuse a text-reading code path — would silently corrupt every .msg
 *  before it ever reaches `readCfbfTree`. */
export function parseMail(bytes: Uint8Array): ParsedMail {
  if (looksLikeCfbf(bytes)) return msgToParsedMail(readCfbfTree(bytes));
  return emlToParsedMail(parseMimeMessage(new TextDecoder().decode(bytes)));
}
