// src/app/eml-extract.ts — MimeMessage -> ParsedMail. Pure, value to value.
//
// Hostile-input surface: headers and parts come from an untrusted .eml file.
// mime-parse.ts already bounds raw header byte size (MAX_HEADER_BYTES),
// header count (MAX_HEADERS) and total MIME part count across the whole
// tree (MAX_PARTS), but two things it does NOT bound are re-bounded here:
//
//   - An address-list header ("To: a@x,b@x,...") can still pack tens of
//     thousands of short entries into a single 64KB header.
//   - MAX_PARTS (1000) still allows up to 1000 attachments on one message,
//     which is a lot to carry into a ParsedMail and render.
//
// Both are truncated, not silently — a diagnostic records what was dropped
// so the loss is visible in the rendered output (see mail-extract.ts).

import { extractHtmlMarkdown } from "./html-extract";
import type { MimeMessage } from "./mime-parse";
import type { ParsedMail } from "./mail-extract";

/** Cap on entries kept from a single To/Cc header. A real message rarely
 *  addresses more than a few dozen recipients; beyond this it is either a
 *  mailing-list blast or a header padded to inflate the parsed output. */
export const MAX_ADDRESSES_PER_LIST = 100;

/** Cap on attachments carried into ParsedMail, tighter than mime-parse.ts's
 *  own MAX_PARTS so a single message's attachment listing (and the
 *  Markdown rendered from it) stays bounded well within that budget. */
export const MAX_ATTACHMENTS = 200;

function addressList(v: string | undefined, diagnostics: string[], label: string): string[] {
  if (!v) return [];
  const all = v.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (all.length <= MAX_ADDRESSES_PER_LIST) return all;
  diagnostics.push(`${label} header truncated at ${MAX_ADDRESSES_PER_LIST} addresses (${all.length} present)`);
  return all.slice(0, MAX_ADDRESSES_PER_LIST);
}

function isoDate(v: string | undefined): string {
  if (!v) return "";
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
}

export function emlToParsedMail(m: MimeMessage): ParsedMail {
  const diagnostics: string[] = [...m.diagnostics];

  // ★★★ `isAttachment`, NEVER `!p.fileName`. These two lines and the filter
  // below used to disagree about the empty string: `!p.fileName` accepted it
  // as "no name, so this is body content" while `p.fileName !== null` kept
  // the same part in the attachment list. A sender who made a filename
  // sanitise away — one control character does it — therefore got their
  // attachment promoted to BE the mail body, discarding the real one, and
  // listed as an attachment at the same time. See MimePart.isAttachment.
  const html = m.parts.find((p) => p.mimeType === "text/html" && !p.isAttachment);
  const plain = m.parts.find((p) => p.mimeType === "text/plain" && !p.isAttachment);
  const body = html
    ? { kind: "html" as const, content: extractHtmlMarkdown(html.text) }
    : { kind: "text" as const, content: plain?.text ?? "" };

  const attachmentParts = m.parts.filter((p) => p.isAttachment || p.isMessage);
  const keptAttachments = attachmentParts.slice(0, MAX_ATTACHMENTS);
  if (attachmentParts.length > keptAttachments.length) {
    diagnostics.push(
      `attachment list truncated at ${MAX_ATTACHMENTS} (${attachmentParts.length} present)`,
    );
  }
  const attachments = keptAttachments.map((p) => ({
    // A declared attachment whose name sanitised away still needs SOME label
    // to be listed and classified under; it no longer inherits the nested
    // message name, which would have mislabelled it as an .eml.
    fileName: p.fileName ?? (p.isMessage ? "attached-message.eml" : "attachment"),
    mimeType: p.isMessage ? "message/rfc822" : p.mimeType,
    bytes: p.bytes,
  }));

  return {
    headers: {
      from: m.headers.get("from") ?? "",
      to: addressList(m.headers.get("to"), diagnostics, "To"),
      cc: addressList(m.headers.get("cc"), diagnostics, "Cc"),
      subject: m.headers.get("subject") ?? "",
      date: isoDate(m.headers.get("date")),
    },
    body,
    attachments,
    diagnostics,
  };
}
