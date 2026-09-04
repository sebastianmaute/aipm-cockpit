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

import { extractHtmlMarkdown } from "./html-extract";
import { decompressRtf, rtfToPlainText } from "./lzfu";
import type { ParsedMail } from "./mail-extract";

/** The two TYPE suffixes a text property can be written with. A producer
 *  picks one per property and writes only that stream: PT_UNICODE is UTF-16LE
 *  by definition, PT_STRING8 is 8-bit bytes in the message's code page.
 *
 *  ★★ Reading only PT_UNICODE — what this did before — made an all-PT_STRING8
 *  message decode to an entirely empty mail: no subject, no sender, no body
 *  and no diagnostic saying anything had gone wrong. That is the
 *  silent-wrong-answer shape, not a crash, which is why BOTH the fallback and
 *  the `matchedAnyTag` diagnostic below exist. */
const PT_UNICODE = "001F";
const PT_STRING8 = "001E";

/** Property IDs (MS-OXPROPS) whose value is TEXT. Each is resolved as its
 *  PT_UNICODE stream first and its PT_STRING8 sibling second — see
 *  `pickText` for why that order and not the other. */
const TEXT_ID = {
  SUBJECT: "0037",
  SENDER_NAME: "0C1A",
  SENDER_EMAIL: "0C1F",
  DISPLAY_TO: "0E04",
  DISPLAY_CC: "0E03",
  BODY_PLAIN: "1000",
  BODY_HTML: "1013",
  ATTACH_LONG_FILENAME: "3707",
  ATTACH_FILENAME: "3704",
  ATTACH_MIME_TAG: "370E",
} as const;

/** PT_BINARY (`…0102`) tags, spelled out in full: these carry bytes rather
 *  than characters, so there is no text-typed sibling to resolve against.
 *  PR_HTML's own charset problem is decodeHtmlBytes's, not this table's. */
const BIN_TAG = {
  BODY_HTML: "10130102",
  BODY_RTF: "10090102",
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

/** Bytes at the head of an HTML body scanned for a charset declaration. The
 *  HTML standard's own encoding pre-scan stops at 1024 bytes; a declaration
 *  further in than that is one no browser would honour either, and scanning
 *  the whole (up to MAX_BODY_PROPERTY_BYTES) body would pay a megabyte-scale
 *  cost for a header-shaped fact. */
const MAX_CHARSET_SNIFF_BYTES = 1024;

/** Matches BOTH declaration shapes in one pass — `<meta charset="utf-8">` and
 *  `<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">`.
 *  The gap is bounded (never `[^>]*`) so an unterminated "<meta" in hostile
 *  input cannot force a long backtracking scan, the same reasoning as
 *  html-extract.ts's MAX_TAG_SCAN_CHARS. */
const META_CHARSET_RE = /<meta[^>]{0,512}?charset\s*=\s*["']?\s*([A-Za-z0-9_.:-]+)/i;

/** The declared charset label, or "" when the body declares none. Scanned as
 *  latin1 so the window is byte-transparent and cannot itself throw or emit a
 *  replacement character — every byte a declaration can be written in is
 *  ASCII, so nothing a real label contains is lost by reading it that way. */
function sniffCharset(bytes: Uint8Array): string {
  const window = bytes.subarray(0, MAX_CHARSET_SNIFF_BYTES);
  const head = new TextDecoder("latin1").decode(window);
  return META_CHARSET_RE.exec(head)?.[1] ?? "";
}

/** Decode a PT_BINARY HTML body (PR_HTML) to text.
 *
 *  ★★ PR_HTML carries bytes in the message's internet code page
 *  (PR_INTERNET_CPID, 3FDE0003), which lives in the fixed-length
 *  `__properties_version1.0` stream this parser deliberately does not parse.
 *  Decoding as UTF-8 unconditionally — what this did before — turns every
 *  umlaut and eszett of a windows-1252 body into U+FFFD irrecoverably, which
 *  on a German or French tenant is the everyday case, not a hostile one.
 *  The deterministic substitute, in order:
 *
 *    1. a charset declared in the body's own head (sniffCharset). Honoured
 *       only when it names something OTHER than UTF-8, because a label of
 *       UTF-8 is exactly what a mislabelled legacy body carries — it goes to
 *       step 2 so it can still fall back.
 *    2. strict UTF-8. `fatal: true` throws on an invalid sequence instead of
 *       substituting U+FFFD, so a modern body decodes exactly and a legacy
 *       one is DETECTED rather than silently rotted.
 *    3. windows-1252, which cannot fail and is what a legacy Outlook body on
 *       a Western-European tenant actually is.
 *
 *  Steps 2 and 3 are decodeCodePageBytes, shared with every PT_STRING8
 *  property — those have the same code-page question and no step 1, since a
 *  bare property string carries no declaration to sniff. */
function decodeHtmlBytes(bytes: Uint8Array): string {
  const label = sniffCharset(bytes);
  if (label !== "") {
    try {
      const declared = new TextDecoder(label);
      // "replacement" is the Encoding Standard's deliberate dead end for
      // labels like iso-2022-kr: its decoder emits one U+FFFD for the whole
      // input.
      if (declared.encoding !== "utf-8" && declared.encoding !== "replacement") {
        return declared.decode(bytes);
      }
    } catch {
      // An unknown or malformed label is not a reason to fail — fall through
      // to the ladder, which always produces something.
    }
  }
  return decodeCodePageBytes(bytes);
}

/** Strict UTF-8, then windows-1252 — the lower two rungs of the charset
 *  ladder, for bytes whose code page this parser cannot know (PR_INTERNET_CPID
 *  lives in the fixed-length `__properties_version1.0` stream, which is not
 *  parsed here). `fatal: true` throws on an invalid sequence instead of
 *  substituting U+FFFD, so a modern value decodes exactly and a legacy one is
 *  DETECTED rather than silently rotted.
 *
 *  ★★ `stream: true` on the strict attempt is load-bearing, not incidental.
 *  Callers clamp at a byte cap, which can cut a multi-byte sequence in half;
 *  a non-streaming fatal decode THROWS on that truncated tail (measured) and
 *  would send an entire valid 4MB UTF-8 body down the windows-1252 branch —
 *  turning one lost character into whole-body mojibake. Streaming buffers an
 *  INCOMPLETE trailing sequence and drops it, while an invalid INTERIOR
 *  sequence still throws, so the fallback stays reachable (both measured). */
function decodeCodePageBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true });
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

type DecodeBudget = { truncatedProperties: number };

function decodeUnicode(b: Uint8Array, cap: number, budget: DecodeBudget): string {
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

/** PT_STRING8: one byte per code unit, so unlike decodeUnicode there is no
 *  code-unit alignment for the clamp to respect and it may land on any byte —
 *  decodeCodePageBytes's streaming strict decode is what keeps a cut UTF-8
 *  sequence from dragging the whole value onto the windows-1252 branch. */
function decodeString8(b: Uint8Array, cap: number, budget: DecodeBudget): string {
  let slice = b;
  if (b.length > cap) {
    slice = b.subarray(0, cap);
    budget.truncatedProperties++;
  }
  return decodeCodePageBytes(slice).replace(/\0+$/, "");
}

/** A resolved text property plus how to read its bytes: `wide` is PT_UNICODE
 *  (UTF-16LE), otherwise PT_STRING8 (code page). The two must not be merged —
 *  decoding either one's bytes with the other's decoder is mojibake. */
type TextValue = { bytes: Uint8Array; wide: boolean };

/** ★ PT_UNICODE wins over its PT_STRING8 sibling when both carry bytes: it is
 *  the lossless one, while a code-page byte string can only be guessed at.
 *  ★ An EMPTY PT_UNICODE stream does NOT win. Preferring a populated
 *  PT_STRING8 sibling there cannot lose a character — the winner carried
 *  none — and dropping the populated one would reproduce, per-property,
 *  exactly the silent-empty-field shape this whole branch exists to remove. */
function pickText(
  wide: Uint8Array | undefined,
  narrow: Uint8Array | undefined,
): TextValue | undefined {
  if (wide && wide.length > 0) return { bytes: wide, wide: true };
  if (narrow && narrow.length > 0) return { bytes: narrow, wide: false };
  return undefined;
}

function decodeText(v: TextValue | undefined, cap: number, budget: DecodeBudget): string {
  if (!v) return "";
  return v.wide ? decodeUnicode(v.bytes, cap, budget) : decodeString8(v.bytes, cap, budget);
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

  // ★ Records that a tag this parser KNOWS was present in the map — not that
  //  it carried a usable value. An empty stream still means the message was
  //  understood, so presence is set by the LOOKUP, before pickText discards
  //  an empty one. Every read below goes through one of these four helpers so
  //  that a tag added to the tables above is covered without a second edit.
  let matchedAnyTag = false;

  const rootText = (id: string): TextValue | undefined => {
    const wide = rootProp(streams, `${id}${PT_UNICODE}`);
    const narrow = rootProp(streams, `${id}${PT_STRING8}`);
    if (wide || narrow) matchedAnyTag = true;
    return pickText(wide, narrow);
  };
  const storageText = (storage: string, id: string): TextValue | undefined => {
    const wide = storageProp(streams, storage, `${id}${PT_UNICODE}`);
    const narrow = storageProp(streams, storage, `${id}${PT_STRING8}`);
    if (wide || narrow) matchedAnyTag = true;
    return pickText(wide, narrow);
  };
  const rootBin = (tag: string): Uint8Array | undefined => {
    const v = rootProp(streams, tag);
    if (v) matchedAnyTag = true;
    return v;
  };
  const storageBin = (storage: string, tag: string): Uint8Array | undefined => {
    const v = storageProp(streams, storage, tag);
    if (v) matchedAnyTag = true;
    return v;
  };

  const dec = (v: TextValue | undefined): string => decodeText(v, MAX_PROPERTY_BYTES, budget);
  const decBody = (v: TextValue | undefined): string => decodeText(v, MAX_BODY_PROPERTY_BYTES, budget);

  const plain = decBody(rootText(TEXT_ID.BODY_PLAIN));
  // ★★ PR_HTML is PT_BINARY (10130102) in MS-OXPROPS and that is what real
  //  Outlook writes, so it wins when both are present — but a text-typed
  //  variant (1013001F / 1013001E) is written by some producers and is just as
  //  much a real HTML body. Looking up only the binary tag reported a map
  //  carrying only the text-typed one as an EMPTY text body (measured). The
  //  two decode differently and must not be merged: the text-typed one is
  //  UTF-16LE or code-page per its own suffix, PT_BINARY is always code-page
  //  bytes with a declaration worth sniffing (see decodeHtmlBytes).
  const htmlBytes = rootBin(BIN_TAG.BODY_HTML);
  const htmlTextValue = rootText(TEXT_ID.BODY_HTML);
  const rtfBytes = rootBin(BIN_TAG.BODY_RTF);

  // ★★ The extracted body carries `kind: "html"` holding MARKDOWN, not
  //  markup — eml-extract.ts's convention exactly, because mail-extract.ts's
  //  renderMailParts prints body.content verbatim and nothing downstream
  //  post-processes it. Handing the model up to 4MB of raw `<div style=…>`
  //  is what this path did before.
  let body: ParsedMail["body"];
  if (htmlBytes && htmlBytes.length > MIN_HTML_BODY_BYTES) {
    const clamped = htmlBytes.length > MAX_BODY_PROPERTY_BYTES;
    const htmlSlice = clamped ? htmlBytes.subarray(0, MAX_BODY_PROPERTY_BYTES) : htmlBytes;
    if (clamped) budget.truncatedProperties++;
    body = { kind: "html", content: extractHtmlMarkdown(decodeHtmlBytes(htmlSlice)) };
  } else if (htmlTextValue && htmlTextValue.bytes.length > MIN_HTML_BODY_BYTES) {
    body = { kind: "html", content: extractHtmlMarkdown(decBody(htmlTextValue)) };
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
    const bytes = storageBin(storage, BIN_TAG.ATTACH_DATA);
    if (!bytes) {
      diagnostics.push(`an attachment in ${storage} carried no data and was skipped`);
      return [];
    }
    const fileName =
      dec(storageText(storage, TEXT_ID.ATTACH_LONG_FILENAME)) ||
      dec(storageText(storage, TEXT_ID.ATTACH_FILENAME)) ||
      "attachment";
    const mimeType =
      dec(storageText(storage, TEXT_ID.ATTACH_MIME_TAG)) || "application/octet-stream";
    return [{ fileName, mimeType, bytes }];
  });

  // ★ Headers are decoded BEFORE the truncatedProperties check below, not
  //  inline in the return statement — decoding them as part of the return
  //  object literal would run AFTER that check reads budget.truncatedProperties,
  //  silently dropping the diagnostic for a truncated subject/sender/to/cc.
  const headers = {
    from: dec(rootText(TEXT_ID.SENDER_NAME)) || dec(rootText(TEXT_ID.SENDER_EMAIL)),
    to: addressList(dec(rootText(TEXT_ID.DISPLAY_TO)), diagnostics, "To"),
    cc: addressList(dec(rootText(TEXT_ID.DISPLAY_CC)), diagnostics, "Cc"),
    subject: dec(rootText(TEXT_ID.SUBJECT)),
    date: "",
  };

  // ★★ THE SILENT-WRONG-ANSWER GUARD, and it must come after every lookup
  //  above. A map carrying only tags this parser does not read yields an empty
  //  subject, an empty sender and an empty body — byte-identical to what a
  //  genuinely empty message yields, so NOTHING in the returned value can tell
  //  the two apart and the reader is handed a mail block that quietly asserts
  //  the message said nothing. Say so once instead. Stream names stay OUT of
  //  the text: diagnostics are rendered for the reader and for the model, and
  //  a `__substg1.0_…` path is noise to both.
  if (streams.size > 0 && !matchedAnyTag) {
    diagnostics.push(
      "the message used an unrecognised property encoding; no fields could be read from it",
    );
  }

  if (budget.truncatedProperties > 0) {
    diagnostics.push(`${budget.truncatedProperties} property value(s) truncated to their byte cap`);
  }

  return { headers, body, attachments, diagnostics };
}
