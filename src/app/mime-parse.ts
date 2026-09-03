// src/app/mime-parse.ts — RFC 5322 / 2045 parser for .eml, .mhtml and .mht.
//
// Pure and node-testable: text in, headers plus a flat part list out. No DOM,
// no fetch, no throwing — a malformed message yields partial results plus
// diagnostics, because a corrupt attachment must never lose the whole mail.
//
// Every dimension a hostile message could grow is bounded: nesting depth
// (MAX_MIME_DEPTH), header count and header-block size (MAX_HEADERS /
// MAX_HEADER_BYTES), total part count across the whole tree (MAX_PARTS,
// container nodes included — this is what stops a shallow-but-wide or a
// wide-at-every-level "MIME bomb" that the depth cap alone cannot catch),
// and decoded output (MAX_TOTAL_OUTPUT_BYTES bounds both the running total
// AND any single part — a part whose raw body is already longer than the
// remaining budget is dropped rather than decoded, so no one part can blow
// the cap even on its own). All boundary/part splitting uses
// String.prototype.indexOf on a literal marker, never a backtracking regex,
// so it stays linear in input size — and RFC 2046 §5.1.1 anchored: a
// delimiter must be a whole line (preceded by a line break, followed by a
// line break or "--"), so boundary text appearing mid-line — accidentally
// in quoted text, or deliberately to forge a part with attacker-chosen
// headers — is not treated as a split point.
//
// A "line break" here is CRLF or a bare LF, matched independently on each
// side of the delimiter — the same "\r?\n" the header splitter already
// accepts. RFC 5322 mandates CRLF on the wire, but LF-only .eml is what
// Unix mail stores, mbox exports, git send-email and any text-mode tool
// produce, and a message whose headers and body carry DIFFERENT endings is
// a real hazard rather than a contrived one. Accepting both widens the
// ANCHOR, never weakens it: a "--boundary" that does not begin a line is
// still rejected under either ending, so the forgery this guard exists to
// stop remains impossible.

const LF = "\n";
const textEncoder = new TextEncoder();

export const MAX_MIME_DEPTH = 10;
export const MAX_HEADERS = 512;
export const MAX_HEADER_BYTES = 64 * 1024;
/** Total nodes (containers + leaves) visited across the whole message. */
export const MAX_PARTS = 1000;
/** Bounds the running total AND any single part's decoded byte count. */
export const MAX_TOTAL_OUTPUT_BYTES = 20 * 1024 * 1024;

export type MimePart = {
  mimeType: string;
  fileName: string | null;
  /** Decoded text, for a textual part. */
  text: string;
  /** Decoded bytes, for any part. */
  bytes: Uint8Array;
  /** True when the part is itself a message (message/rfc822). */
  isMessage: boolean;
};

export type MimeMessage = {
  headers: Map<string, string>;
  parts: MimePart[];
  diagnostics: string[];
};

/** Shared, mutable budget threaded through the recursive walk. */
type Budget = {
  partsLeft: number;
  bytesLeft: number;
  notedReasons: Set<string>;
};

function noteOnce(budget: Budget, key: string, diagnostics: string[], message: string): void {
  if (budget.notedReasons.has(key)) return;
  budget.notedReasons.add(key);
  diagnostics.push(message);
}

/**
 * Never throws. On a malformed input (bad alphabet, wrong padding, a stray
 * character), decodes the largest valid prefix instead of returning nothing
 * — a single mangled byte must not drop an entire attachment.
 */
function decodeBase64(s: string): { bytes: Uint8Array; malformed: boolean } {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, "");
  const attempt = (input: string): Uint8Array | null => {
    if (input.length === 0) return new Uint8Array(0);
    const aligned = input.slice(0, input.length - (input.length % 4));
    if (aligned.length === 0) return null;
    try {
      const bin = atob(aligned);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch {
      return null;
    }
  };

  const primary = attempt(clean);
  if (primary !== null) {
    return { bytes: primary, malformed: clean.length % 4 !== 0 };
  }
  // The 4-aligned prefix itself failed (e.g. a stray "=" mid-string, not just
  // at the end). Retry once with every padding character stripped, rather
  // than giving up and returning nothing.
  const fallback = attempt(clean.replace(/=+/g, ""));
  return { bytes: fallback ?? new Uint8Array(0), malformed: true };
}

/**
 * Preallocates its output (no per-byte JS array) and encodes a non-ASCII
 * literal run through TextEncoder rather than masking each char code to a
 * single byte, so a literal (non-escaped) multi-byte character round-trips
 * instead of being truncated to garbage.
 */
function decodeQuotedPrintable(s: string): Uint8Array {
  const joined = s.replace(/=\r?\n/g, "");           // soft line breaks
  // Worst-case UTF-8 expansion of a UTF-16 string is 3 bytes per code unit.
  const buf = new Uint8Array(joined.length * 3 + 16);
  let n = 0;
  let literalStart = 0;
  const flushLiteral = (end: number) => {
    if (end <= literalStart) return;
    const { written } = textEncoder.encodeInto(joined.slice(literalStart, end), buf.subarray(n));
    n += written;
  };
  let i = 0;
  while (i < joined.length) {
    if (joined[i] === "=" && i + 2 < joined.length) {
      const hex = joined.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        flushLiteral(i);
        buf[n++] = Number.parseInt(hex, 16);
        i += 3;
        literalStart = i;
        continue;
      }
    }
    i++;
  }
  flushLiteral(joined.length);
  return buf.subarray(0, n);
}

/** RFC 2047 encoded-words in a header value. */
export function decodeEncodedWords(v: string): string {
  return v.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (whole, charset: string, enc: string, data: string) => {
    try {
      const bytes = enc.toUpperCase() === "B"
        ? decodeBase64(data).bytes
        : decodeQuotedPrintable(data.replace(/_/g, " "));
      return new TextDecoder(charset.toLowerCase()).decode(bytes);
    } catch {
      return whole;
    }
  });
}

/** Strips control characters and reduces to a basename, closing off header/
 * log injection and path traversal that an RFC 2047 encoded-word can smuggle
 * into a filename invisibly (the raw header looks innocuous; only the
 * decoded value carries the attack). */
function sanitizeFileName(name: string): string {
  const noControl = name.replace(/[\x00-\x1F\x7F]/g, "").trim();
  const base = noControl.split(/[\\/]+/).pop();
  return base && base.length > 0 ? base : noControl;
}

// Anchored so a parameter name cannot be hijacked by a longer name sharing
// its suffix (xboundary vs boundary, xcharset vs charset, xfilename vs
// filename) — the char before the name must be ";", whitespace, or the
// start of the string.
function paramOf(headerValue: string, name: string): string | null {
  const re = new RegExp(`(?:^|[;\\s])${name}\\s*=\\s*("([^"]*)"|([^;\\s]+))`, "i");
  const m = re.exec(headerValue);
  return m ? (m[2] ?? m[3] ?? null) : null;
}

const FIRST_WINS_HEADERS = new Set(["content-type", "content-transfer-encoding"]);

function splitHeaders(raw: string): { headers: Map<string, string>; body: string; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const sep = /\r?\n\r?\n/.exec(raw);
  const headerText = sep ? raw.slice(0, sep.index) : raw;
  const bodyAfterSep = sep ? raw.slice(sep.index + sep[0].length) : "";
  const capped = headerText.length > MAX_HEADER_BYTES;
  if (capped) diagnostics.push("header block truncated at the size cap");
  const lines = (capped ? headerText.slice(0, MAX_HEADER_BYTES) : headerText).split(/\r?\n/);

  const headers = new Map<string, string>();
  let droppedHeader = false;
  let name = "", value = "";
  const commit = () => {
    if (name === "") return;
    const key = name.toLowerCase();
    if (headers.size >= MAX_HEADERS) { droppedHeader = true; return; }
    const decoded = decodeEncodedWords(value.trim());
    if (FIRST_WINS_HEADERS.has(key) && headers.has(key)) {
      diagnostics.push(`duplicate ${key} header ignored (kept the first)`);
      return;
    }
    headers.set(key, decoded);
  };
  for (const line of lines) {
    if (/^[ \t]/.test(line) && name !== "") { value += " " + line.trim(); continue; }
    commit();
    const colon = line.indexOf(":");
    if (colon <= 0) { name = ""; value = ""; continue; }
    name = line.slice(0, colon).trim();
    value = line.slice(colon + 1);
  }
  commit();
  if (droppedHeader) diagnostics.push("header count capped");

  if (headers.size === 0) {
    // Nothing here parsed as a real header — either there was no blank
    // line at all (a header-less body part, which RFC 2046 explicitly
    // permits), or every line lacked a ":" (this was never a header block
    // to begin with, e.g. free text with a coincidental blank line in it).
    // Either way, treat the WHOLE original chunk as body rather than
    // silently discarding content that merely failed to look like headers.
    return { headers, body: raw, diagnostics };
  }
  return { headers, body: bodyAfterSep, diagnostics };
}

function decodePartBody(body: string, encoding: string, charset: string): { text: string; bytes: Uint8Array; diagnostics: string[] } {
  const partDiagnostics: string[] = [];
  const enc = encoding.trim().toLowerCase();
  let bytes: Uint8Array;
  if (enc === "base64") {
    const decoded = decodeBase64(body);
    bytes = decoded.bytes;
    if (decoded.malformed) partDiagnostics.push("part had malformed base64; decoded the largest valid prefix");
  } else if (enc === "quoted-printable") {
    bytes = decodeQuotedPrintable(body);
  } else {
    bytes = textEncoder.encode(body);
  }
  let text = "";
  try {
    text = new TextDecoder(charset.toLowerCase() || "utf-8").decode(bytes);
  } catch {
    text = new TextDecoder().decode(bytes);
  }
  return { text, bytes, diagnostics: partDiagnostics };
}

function walkNode(headers: Map<string, string>, body: string, depth: number, out: MimePart[], diagnostics: string[], budget: Budget): void {
  // Every node — container or leaf — spends one unit of the shared part
  // budget BEFORE the depth check, not after: otherwise a node past the
  // depth cap costs nothing, and an attacker can hang arbitrarily many
  // over-depth children off one multipart for free.
  if (budget.partsLeft <= 0) {
    noteOnce(budget, "parts", diagnostics, "part count exceeded the cap");
    return;
  }
  budget.partsLeft--;

  if (depth > MAX_MIME_DEPTH) {
    noteOnce(budget, "depth", diagnostics, "multipart nesting exceeded the depth cap");
    return;
  }

  const ctype = headers.get("content-type") ?? "text/plain";
  const mimeType = ctype.split(";")[0].trim().toLowerCase();
  const boundary = paramOf(ctype, "boundary");

  if (mimeType.startsWith("multipart/") && boundary) {
    walkMultipartChildren(body, boundary, depth, out, diagnostics, budget);
    return;
  }

  const disp = headers.get("content-disposition") ?? "";
  const rawFileName = paramOf(disp, "filename") ?? paramOf(ctype, "name");

  // A part whose raw (still-encoded) body is already longer than what
  // remains of the output budget cannot possibly decode to fit inside it —
  // skip it without decoding, so the cap bounds a single oversized part,
  // not only the running total across many smaller ones.
  if (body.length > budget.bytesLeft) {
    noteOnce(budget, "bytes", diagnostics, "output size exceeded the cap");
    return;
  }

  const { text, bytes, diagnostics: bodyDiagnostics } = decodePartBody(
    body,
    headers.get("content-transfer-encoding") ?? "",
    paramOf(ctype, "charset") ?? "utf-8",
  );
  diagnostics.push(...bodyDiagnostics);
  budget.bytesLeft -= bytes.byteLength;
  out.push({
    mimeType,
    fileName: rawFileName ? sanitizeFileName(decodeEncodedWords(rawFileName)) : null,
    text,
    bytes,
    isMessage: mimeType === "message/rfc822",
  });
}

/**
 * RFC 2046 §5.1.1: a delimiter is a line break, then "--boundary", then
 * either another line break (a part follows) or "--" (terminator) —
 * optionally with linear whitespace before it. A line break is CRLF or a
 * bare LF, matched independently on each side, so an LF-only message — and
 * one that mixes the two — splits exactly like a CRLF one, while a match
 * that does not begin a line is still rejected. The line break preceding a
 * delimiter belongs to the delimiter, not to the part before it, so it is
 * trimmed off that part's raw text whichever form it took. Scanned with indexOf (never a
 * backtracking regex) on the literal marker text, so it stays linear even
 * over a body engineered to contain many near-miss occurrences: a rejected
 * (mid-line) match advances the search position by exactly one character,
 * and the search position only ever moves forward, so the total work across
 * every indexOf call is bounded by the body length once, not once per
 * rejection.
 */
function walkMultipartChildren(body: string, boundary: string, depth: number, out: MimePart[], diagnostics: string[], budget: Budget): void {
  const marker = "--" + boundary;
  // Prepend a bare LF so the very first delimiter — which has no literal
  // leading line break in `body` — matches the same way as every later one.
  const scan = LF + body;
  let cursor = 0;
  let partStart = -1; // -1 while still in the preamble, before any delimiter.
  let sawTerminator = false;

  for (;;) {
    const idx = scan.indexOf(marker, cursor);
    if (idx === -1) break;

    // The delimiter must BEGIN a line: the character before it has to be the
    // LF of a CRLF or of a bare LF. This is the §5.1.1 anchoring — without
    // it, "--boundary" occurring mid-line in body content would split, and
    // an attacker could forge a sibling part with headers of their choosing.
    if (idx === 0 || scan[idx - 1] !== LF) {
      cursor = idx + 1;
      continue;
    }
    // That LF, plus a CR in front of it if present, is the delimiter's own
    // leading break — it is not part of the preceding part's body.
    const breakStart = idx >= 2 && scan[idx - 2] === "\r" ? idx - 2 : idx - 1;
    const afterMarker = idx + marker.length;

    let i = afterMarker;
    while (i < scan.length && (scan[i] === " " || scan[i] === "\t")) i++;
    const isTerminator = scan.startsWith("--", i);
    // Length of the trailing break, resolved independently of the leading
    // one so a message that mixes endings still splits.
    const trailingBreak = scan[i] === LF ? 1 : scan[i] === "\r" && scan[i + 1] === LF ? 2 : 0;
    const isDelimiter = isTerminator || trailingBreak > 0 || i === scan.length;
    if (!isDelimiter) {
      // Marker text mid-line — a coincidental match (or a forged part
      // attempt). Keep scanning forward past it rather than splitting here.
      cursor = idx + 1;
      continue;
    }

    if (partStart >= 0) {
      if (budget.partsLeft <= 0) {
        noteOnce(budget, "parts", diagnostics, "part count exceeded the cap");
        break;
      }
      const partRaw = scan.slice(partStart, breakStart);
      const { headers, body: partBody, diagnostics: hd } = splitHeaders(partRaw);
      diagnostics.push(...hd);
      walkNode(headers, partBody, depth + 1, out, diagnostics, budget);
    }

    if (isTerminator) { sawTerminator = true; break; }

    partStart = i + trailingBreak; // skip the line break that follows the delimiter
    cursor = partStart;
  }

  if (sawTerminator) return;

  diagnostics.push("multipart body had no closing boundary");
  if (partStart >= 0) {
    // Ran off the end mid-part: the trailing content is still a real part,
    // just never explicitly closed — emit it rather than losing it.
    if (budget.partsLeft <= 0) {
      noteOnce(budget, "parts", diagnostics, "part count exceeded the cap");
      return;
    }
    const partRaw = scan.slice(partStart);
    const { headers, body: partBody, diagnostics: hd } = splitHeaders(partRaw);
    diagnostics.push(...hd);
    walkNode(headers, partBody, depth + 1, out, diagnostics, budget);
  } else if (budget.partsLeft > 0) {
    // The declared boundary never appeared at all — not even once. Fall
    // back to the raw body as a single part instead of discarding it.
    walkNode(new Map(), body, depth + 1, out, diagnostics, budget);
  } else {
    noteOnce(budget, "parts", diagnostics, "part count exceeded the cap");
  }
}

export function parseMimeMessage(raw: string): MimeMessage {
  const parts: MimePart[] = [];
  const budget: Budget = { partsLeft: MAX_PARTS, bytesLeft: MAX_TOTAL_OUTPUT_BYTES, notedReasons: new Set() };
  const { headers, body, diagnostics } = splitHeaders(raw);
  walkNode(headers, body, 0, parts, diagnostics, budget);
  return { headers, parts, diagnostics };
}
