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
// and total decoded output across every part (MAX_TOTAL_OUTPUT_BYTES). All
// boundary/part splitting uses String.prototype.split on a literal marker,
// never a backtracking regex, so it stays linear in input size.

export const MAX_MIME_DEPTH = 10;
export const MAX_HEADERS = 512;
export const MAX_HEADER_BYTES = 64 * 1024;
/** Total nodes (containers + leaves) visited across the whole message. */
export const MAX_PARTS = 1000;
/** Total decoded bytes summed across every leaf part in the message. */
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
  notedParts: boolean;
  notedBytes: boolean;
};

function noteOnce(budget: Budget, kind: "parts" | "bytes", diagnostics: string[], message: string): void {
  if (kind === "parts") {
    if (budget.notedParts) return;
    budget.notedParts = true;
  } else {
    if (budget.notedBytes) return;
    budget.notedBytes = true;
  }
  diagnostics.push(message);
}

function decodeBase64(s: string): Uint8Array {
  try {
    const clean = s.replace(/[^A-Za-z0-9+/=]/g, "");
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array(0);
  }
}

function decodeQuotedPrintable(s: string): Uint8Array {
  const joined = s.replace(/=\r?\n/g, "");             // soft line breaks
  const out: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === "=" && i + 2 < joined.length) {
      const hex = joined.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) { out.push(Number.parseInt(hex, 16)); i += 2; continue; }
    }
    out.push(joined.charCodeAt(i) & 0xff);
  }
  return new Uint8Array(out);
}

/** RFC 2047 encoded-words in a header value. */
export function decodeEncodedWords(v: string): string {
  return v.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (whole, charset: string, enc: string, data: string) => {
    try {
      const bytes = enc.toUpperCase() === "B"
        ? decodeBase64(data)
        : decodeQuotedPrintable(data.replace(/_/g, " "));
      return new TextDecoder(charset.toLowerCase()).decode(bytes);
    } catch {
      return whole;
    }
  });
}

function paramOf(headerValue: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|([^;\\s]+))`, "i");
  const m = re.exec(headerValue);
  return m ? (m[2] ?? m[3] ?? null) : null;
}

function splitHeaders(raw: string): { headers: Map<string, string>; body: string; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const sep = /\r?\n\r?\n/.exec(raw);
  const headerText = sep ? raw.slice(0, sep.index) : raw;
  const body = sep ? raw.slice(sep.index + sep[0].length) : "";
  const capped = headerText.length > MAX_HEADER_BYTES;
  if (capped) diagnostics.push("header block truncated at the size cap");
  const lines = (capped ? headerText.slice(0, MAX_HEADER_BYTES) : headerText).split(/\r?\n/);

  const headers = new Map<string, string>();
  let name = "", value = "";
  const commit = () => {
    if (name === "") return;
    if (headers.size >= MAX_HEADERS) return;
    headers.set(name.toLowerCase(), decodeEncodedWords(value.trim()));
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
  if (headers.size >= MAX_HEADERS) diagnostics.push("header count capped");
  return { headers, body, diagnostics };
}

function decodePartBody(body: string, encoding: string, charset: string): { text: string; bytes: Uint8Array } {
  const enc = encoding.trim().toLowerCase();
  const bytes = enc === "base64" ? decodeBase64(body)
    : enc === "quoted-printable" ? decodeQuotedPrintable(body)
    : new TextEncoder().encode(body);
  let text = "";
  try {
    text = new TextDecoder(charset.toLowerCase() || "utf-8").decode(bytes);
  } catch {
    text = new TextDecoder().decode(bytes);
  }
  return { text, bytes };
}

function walk(raw: string, depth: number, out: MimePart[], diagnostics: string[], budget: Budget): void {
  if (depth > MAX_MIME_DEPTH) {
    diagnostics.push("multipart nesting exceeded the depth cap");
    return;
  }
  // Every node — container or leaf — spends one unit of the shared part
  // budget. The multipart loop below checks it BEFORE recursing into each
  // child (and is the sole enforcement point — every call into walk() is
  // either this function's own initial invocation, whose budget always
  // starts positive, or a loop iteration gated on the same check), so this
  // bounds a wide-but-shallow multipart (thousands of sibling parts at depth
  // 1) as well as a wide-at-every-level tree (a few children per level, many
  // levels), neither of which the depth cap alone limits: depth stays small
  // while the total node count explodes.
  budget.partsLeft--;

  const { headers, body, diagnostics: hd } = splitHeaders(raw);
  diagnostics.push(...hd);
  const ctype = headers.get("content-type") ?? "text/plain";
  const mimeType = ctype.split(";")[0].trim().toLowerCase();
  const boundary = paramOf(ctype, "boundary");

  if (mimeType.startsWith("multipart/") && boundary) {
    const marker = `--${boundary}`;
    const chunks = body.split(marker);
    // chunks[0] is the preamble; a chunk starting with "--" is the terminator.
    let sawTerminator = false;
    for (const chunk of chunks.slice(1)) {
      if (budget.partsLeft <= 0) {
        noteOnce(budget, "parts", diagnostics, "part count exceeded the cap");
        break;
      }
      if (chunk.startsWith("--")) { sawTerminator = true; break; }
      walk(chunk.replace(/^\r?\n/, ""), depth + 1, out, diagnostics, budget);
    }
    if (!sawTerminator) diagnostics.push("multipart body had no closing boundary");
    return;
  }

  if (budget.bytesLeft <= 0) {
    noteOnce(budget, "bytes", diagnostics, "output size exceeded the cap");
    return;
  }

  const disp = headers.get("content-disposition") ?? "";
  const fileName = paramOf(disp, "filename") ?? paramOf(ctype, "name");
  const { text, bytes } = decodePartBody(
    body,
    headers.get("content-transfer-encoding") ?? "",
    paramOf(ctype, "charset") ?? "utf-8",
  );
  budget.bytesLeft -= bytes.byteLength;
  out.push({
    mimeType,
    fileName: fileName ? decodeEncodedWords(fileName) : null,
    text,
    bytes,
    isMessage: mimeType === "message/rfc822",
  });
}

export function parseMimeMessage(raw: string): MimeMessage {
  const { headers, diagnostics } = splitHeaders(raw);
  const parts: MimePart[] = [];
  const budget: Budget = { partsLeft: MAX_PARTS, bytesLeft: MAX_TOTAL_OUTPUT_BYTES, notedParts: false, notedBytes: false };
  walk(raw, 0, parts, diagnostics, budget);
  return { headers, parts, diagnostics };
}
