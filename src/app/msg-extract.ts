// src/app/msg-extract.ts — CFBF stream tree -> ParsedMail.
//
// ★★★ RESOLVE PROPERTIES BY STORAGE PATH, NEVER BY STREAM NAME ALONE. Duplicate
// names across storages are normal: a real message carries a subject-shaped
// stream on the root storage AND inside __nameid_version1.0, and a message
// with attachments carries a subject stream per attachment too. A flattened
// (name-only) lookup attributed a __nameid_version1.0 stream to the message
// and reported an 8-byte body that did not exist on the root at all — that
// is the measured defect this module exists to not repeat. Root properties
// are the entries with NO "/" in their path; an attachment's properties live
// under its own `__attach_version1.0_#XXXXXXXX` storage.
//
// Hostile-input surface: `streams` can come straight from an untrusted .msg
// via cfbf.ts's readCfbfTree, which already clamps stream count
// (its directory-entry cap) and per-stream byte size (MAX_CFBF_STREAM_BYTES,
// 64MB) — but two things it does NOT bound are re-bounded here, the same
// shape as eml-extract.ts re-bounding what mime-parse.ts leaves open:
//
//   - The number of `__attach_version1.0*` storages walked into
//     ParsedMail.attachments (MAX_ATTACHMENTS).
//   - The bytes decoded per short text property — subject, sender, a
//     to/cc blob, an attachment filename or MIME tag — before TextDecoder
//     ever sees them (MAX_PROPERTY_BYTES). A crafted stream map can attach
//     a 64MB blob behind EVERY property on EVERY attachment; decoding each
//     one in full multiplies that single-stream ceiling by every property
//     on every attachment instead of paying it once.
//
// The plain/HTML body gets its own, larger ceiling (MAX_BODY_PROPERTY_BYTES)
// since a real body legitimately runs to tens of KB (measured: 2078B and
// 14420B plain bodies on two real messages). RTF is left to decompressRtf's
// own MAX_RAW_BYTES clamp in lzfu.ts, which already bounds the OUTPUT
// regardless of the compressed INPUT size, so it is not re-clamped here.
//
// This function does not recurse into an embedded-message attachment
// (PT_OBJECT, no PR_ATTACH_DATA_BIN stream) — it has no ATTACH_DATA and is
// silently skipped with a diagnostic, same as any other attachment storage
// missing its data stream. Recursion is the orchestrator's job
// (attachment-ingest.ts), never this parser's — see mail-extract.ts's header
// comment for why calling back the other way is a mistake.
//
// Property tags come from MS-OXPROPS. Tags are facts from a specification,
// not creative expression.

import { decompressRtf, rtfToPlainText } from "./lzfu";
import type { ParsedMail } from "./mail-extract";

const TAG = {
  SUBJECT: "0037001F",
  SENDER_NAME: "0C1A001F",
  SENDER_EMAIL: "0C1F001F",
  DISPLAY_TO: "0E04001F",
  DISPLAY_CC: "0E03001F",
  BODY_PLAIN: "1000001F",
  BODY_HTML: "10130102",
  BODY_RTF: "10090102",
  ATTACH_LONG_FILENAME: "3707001F",
  ATTACH_FILENAME: "3704001F",
  ATTACH_MIME_TAG: "370E001F",
  ATTACH_DATA: "37010102",
} as const;

/** Cap on `__attach_version1.0*` storages walked into ParsedMail.attachments,
 *  mirroring eml-extract.ts's MAX_ATTACHMENTS — a single message carrying
 *  more than this is either a mail bomb or a crafted directory tree, not a
 *  real attachment list. */
export const MAX_ATTACHMENTS = 200;

/** Cap on raw bytes decoded for a short text property (subject, sender, a
 *  to/cc blob, an attachment filename or MIME tag) before TextDecoder ever
 *  sees them. cfbf.ts already clamps a single STREAM to 64MB
 *  (MAX_CFBF_STREAM_BYTES); this is the per-PROPERTY re-bound — a crafted
 *  map can put that ceiling behind every one of these fields on every
 *  attachment, not just behind one stream. */
export const MAX_PROPERTY_BYTES = 64 * 1024;

/** Cap on raw bytes decoded for the plain-text or HTML body. Larger than
 *  MAX_PROPERTY_BYTES because a real body legitimately runs to tens of KB;
 *  this is generous headroom above that, not a realistic body size. */
export const MAX_BODY_PROPERTY_BYTES = 4 * 1024 * 1024;

/** Cap on entries kept from a decoded To/Cc blob, mirroring
 *  eml-extract.ts's MAX_ADDRESSES_PER_LIST. */
export const MAX_ADDRESSES_PER_LIST = 100;

/** Minimum HTML byte length worth treating as a real body rather than a
 *  degenerate placeholder stream. */
const MIN_HTML_BODY_BYTES = 32;

type DecodeBudget = { truncatedProperties: number };

function decodeUnicode(b: Uint8Array | undefined, cap: number, budget: DecodeBudget): string {
  if (!b || b.length === 0) return "";
  let slice = b;
  if (b.length > cap) {
    // Keep the clamp on an even byte boundary — a lone trailing byte of a
    // UTF-16LE code unit would otherwise decode as a replacement character
    // instead of simply dropping the truncated one.
    const evenCap = cap - (cap % 2);
    slice = b.subarray(0, evenCap);
    budget.truncatedProperties++;
  }
  return new TextDecoder("utf-16le").decode(slice).replace(/\0+$/, "");
}

/** Root-level property: no "/" in the path. */
function rootProp(streams: Map<string, Uint8Array>, tag: string): Uint8Array | undefined {
  return streams.get(`__substg1.0_${tag}`);
}

function storageProp(
  streams: Map<string, Uint8Array>,
  storage: string,
  tag: string,
): Uint8Array | undefined {
  return streams.get(`${storage}/__substg1.0_${tag}`);
}

/** Top-level `__attach_version1.0*` storages, sorted for a deterministic
 *  attachment order. An attachment storage two levels deep (an embedded
 *  message's own attachment) is attributed to its OUTER attachment's
 *  storage, never enumerated as a second top-level entry, because `head`
 *  is only a path's first segment. */
function attachmentStorages(streams: Map<string, Uint8Array>): string[] {
  const found = new Set<string>();
  for (const path of streams.keys()) {
    const slash = path.indexOf("/");
    if (slash < 0) continue;
    const head = path.slice(0, slash);
    if (head.startsWith("__attach_version1.0")) found.add(head);
  }
  return [...found].sort();
}

function addressList(v: string, diagnostics: string[], label: string): string[] {
  const all = v.split(/[;,]/).map((s) => s.trim()).filter((s) => s.length > 0);
  if (all.length <= MAX_ADDRESSES_PER_LIST) return all;
  diagnostics.push(`${label} truncated at ${MAX_ADDRESSES_PER_LIST} addresses (${all.length} present)`);
  return all.slice(0, MAX_ADDRESSES_PER_LIST);
}

export function msgToParsedMail(streams: Map<string, Uint8Array>): ParsedMail {
  const diagnostics: string[] = [];
  const budget: DecodeBudget = { truncatedProperties: 0 };

  const dec = (b: Uint8Array | undefined): string => decodeUnicode(b, MAX_PROPERTY_BYTES, budget);
  const decBody = (b: Uint8Array | undefined): string => decodeUnicode(b, MAX_BODY_PROPERTY_BYTES, budget);

  const plain = decBody(rootProp(streams, TAG.BODY_PLAIN));
  const htmlBytes = rootProp(streams, TAG.BODY_HTML);
  const rtfBytes = rootProp(streams, TAG.BODY_RTF);

  let body: ParsedMail["body"];
  if (htmlBytes && htmlBytes.length > MIN_HTML_BODY_BYTES) {
    const clamped = htmlBytes.length > MAX_BODY_PROPERTY_BYTES;
    const htmlSlice = clamped ? htmlBytes.subarray(0, MAX_BODY_PROPERTY_BYTES) : htmlBytes;
    if (clamped) budget.truncatedProperties++;
    body = { kind: "html", content: new TextDecoder("utf-8").decode(htmlSlice) };
  } else if (rtfBytes && rtfBytes.length > 0) {
    const raw = decompressRtf(rtfBytes);
    const text = rtfToPlainText(new TextDecoder("latin1").decode(raw));
    if (text.length > 0) {
      body = { kind: "rtf-degraded", content: text };
    } else {
      diagnostics.push("the message body could not be decompressed; plain text follows");
      body = { kind: "text", content: plain };
    }
  } else {
    body = { kind: "text", content: plain };
  }

  const allAttachmentStorages = attachmentStorages(streams);
  const keptStorages = allAttachmentStorages.slice(0, MAX_ATTACHMENTS);
  if (allAttachmentStorages.length > keptStorages.length) {
    diagnostics.push(
      `attachment list truncated at ${MAX_ATTACHMENTS} (${allAttachmentStorages.length} present)`,
    );
  }

  const attachments = keptStorages.flatMap((storage) => {
    const bytes = storageProp(streams, storage, TAG.ATTACH_DATA);
    if (!bytes) {
      diagnostics.push(`an attachment in ${storage} carried no data and was skipped`);
      return [];
    }
    const fileName =
      dec(storageProp(streams, storage, TAG.ATTACH_LONG_FILENAME)) ||
      dec(storageProp(streams, storage, TAG.ATTACH_FILENAME)) ||
      "attachment";
    const mimeType =
      dec(storageProp(streams, storage, TAG.ATTACH_MIME_TAG)) || "application/octet-stream";
    return [{ fileName, mimeType, bytes }];
  });

  // ★ Headers are decoded BEFORE the truncatedProperties check below, not
  //  inline in the return statement — decoding them as part of the return
  //  object literal would run AFTER that check reads budget.truncatedProperties,
  //  silently dropping the diagnostic for a truncated subject/sender/to/cc.
  const headers = {
    from: dec(rootProp(streams, TAG.SENDER_NAME)) || dec(rootProp(streams, TAG.SENDER_EMAIL)),
    to: addressList(dec(rootProp(streams, TAG.DISPLAY_TO)), diagnostics, "To"),
    cc: addressList(dec(rootProp(streams, TAG.DISPLAY_CC)), diagnostics, "Cc"),
    subject: dec(rootProp(streams, TAG.SUBJECT)),
    date: "",
  };

  if (budget.truncatedProperties > 0) {
    diagnostics.push(`${budget.truncatedProperties} property value(s) truncated to their byte cap`);
  }

  return { headers, body, attachments, diagnostics };
}
