// src/app/document-asset-upload.ts
//
// The upload pipeline for document assets. Pure and i18n-free — every rejection
// returns a REASON CODE that the surface translates. FORMAT POLICY LIVES HERE,
// not in the store: document-asset.ts is mime-generic on purpose so a later
// attachment slice reuses the table with no migration.

/** ★★ PNG + JPEG + WebP. WebP is admitted because browsers put WebP on the
 *  clipboard and paste is a shipping entry point — rejecting it would make the
 *  headline gesture fail on real screenshots. SVG is out permanently (XSS
 *  surface). GIF is out because downscaling re-encodes and would silently
 *  destroy animation. */
export const ASSET_MIME_ALLOWED = ["image/png", "image/jpeg", "image/webp"] as const;

/** Bounds what is read into memory at all, before any decode. */
export const ASSET_RAW_MAX_BYTES = 25 * 1024 * 1024;

/** ★★ Applied AFTER downscale. Checking the raw upload against this first would
 *  reject the photo that downscaling exists to rescue — the two rules would
 *  cancel out. Measured 2026-08-21: this rides ~6.7 MiB of base64 in a single
 *  Turso statement, against a ceiling not found below 32 MiB. */
export const ASSET_STORED_MAX_BYTES = 5 * 1024 * 1024;

/** Decompression-bomb guard, read from the HEADER and never by decoding: a
 *  50 KB PNG can expand to 30000x30000. Generous enough that no real camera or
 *  screenshot reaches it. */
export const ASSET_MAX_SOURCE_DIM = 8000;

export const ASSET_DOWNSCALE_W = 1920;
export const ASSET_DOWNSCALE_H = 1080;

/** Per DOCUMENT, distinct images. The only moment images are held together is a
 *  .docx/.pptx export assembled as one in-memory Blob. Per WORKSPACE there is
 *  deliberately no cap — disclosure without enforcement. */
export const ASSET_MAX_PER_DOCUMENT = 20;

export type UploadRejection =
  | "format" | "tooLargeRaw" | "tooLargeStored" | "dimensions" | "empty" | "decode";

export type CandidateResult =
  | { ok: true }
  | { ok: false; reason: UploadRejection };

/** Cheap pre-flight: mime and raw size only. Runs before a single byte is
 *  decoded, which is the whole point of the raw ceiling. */
export function checkUploadCandidate(file: Pick<File, "type" | "size">): CandidateResult {
  if (!(ASSET_MIME_ALLOWED as readonly string[]).includes(file.type)) {
    return { ok: false, reason: "format" };
  }
  if (file.size <= 0) return { ok: false, reason: "empty" };
  if (file.size > ASSET_RAW_MAX_BYTES) return { ok: false, reason: "tooLargeRaw" };
  return { ok: true };
}

export interface PixelSize { width: number; height: number }

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Dimensions from the file HEADER, without decoding a single pixel. Returns
 *  null when the header is truncated, the signature does not match, or the
 *  format is one this reader does not parse — the CALLER decides what null
 *  means, and checkHeaderDimensions treats it as a rejection. */
export function readHeaderDimensions(bytes: Uint8Array, mime: string): PixelSize | null {
  if (mime === "image/png") {
    if (bytes.length < 24) return null;
    if (!PNG_SIG.every((b, i) => bytes[i] === b)) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (mime === "image/jpeg") return readJpegDimensions(bytes);
  if (mime === "image/webp") return readWebpDimensions(bytes);
  return null;
}

// JPEG SOF markers that are frame headers vs. table-definition markers that
// happen to fall in the SOF numeric range but carry no frame dimensions.
const JPEG_SOF_EXCLUDED = new Set([0xc4, 0xc8, 0xcc]);

/** ★★★ Rewritten from scratch — the plan's original readJpegDimensions had two
 *  defects that would have shipped a wrong-but-plausible-looking parser:
 *
 *  1. It read a 2-byte length after EVERY marker byte. Several markers carry
 *     NO length field at all — SOI/EOI, RST0-RST7, and TEM (0x01) — so
 *     treating the bytes right after one of those as a length desynchronises
 *     the entire walk and can silently skip past (or misread) the real SOF.
 *  2. It did not skip 0xFF FILL bytes. A run of padding 0xFF bytes before a
 *     real marker (`FF FF FF C0 …`) is legal; treating the first 0xFF as the
 *     marker prefix and the second 0xFF as the marker BYTE misidentifies the
 *     marker entirely.
 *
 *  This walk: treats SOI/RST0-7/TEM as standalone (advance 2, no length);
 *  skips 0xFF fill runs so the marker byte is always the first non-0xFF after
 *  them; stops at SOS (0xDA) since entropy-coded scan data follows and must
 *  never be walked as markers; and never throws — every read is guarded by an
 *  explicit bounds check first, so a truncated or malformed stream returns
 *  null instead of indexing past the end. */
function readJpegDimensions(bytes: Uint8Array): PixelSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) return null; // desynchronised — malformed stream

    // Skip 0xFF fill bytes: p ends on the LAST 0xFF of the run, so bytes[p+1]
    // is the real marker byte.
    let p = i;
    while (p + 1 < bytes.length && bytes[p + 1] === 0xff) p++;
    if (p + 1 >= bytes.length) return null; // truncated: no marker byte follows
    const marker = bytes[p + 1];

    // Standalone markers carry no length field at all.
    if (marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i = p + 2;
      continue;
    }
    // SOS: entropy-coded scan data follows: stop walking markers.
    if (marker === 0xda) return null;

    // Every other marker carries a 2-byte big-endian length, counting itself,
    // at offset +2/+3 from the (last) 0xFF.
    if (p + 3 >= bytes.length) return null;
    const len = (bytes[p + 2] << 8) | bytes[p + 3];
    if (len < 2) return null;

    const isSof = marker >= 0xc0 && marker <= 0xcf && !JPEG_SOF_EXCLUDED.has(marker);
    if (isSof) {
      // Frame header: precision(1) height(2) width(2) starting right after
      // the length field — height at +5, width at +7 relative to the 0xFF.
      if (p + 8 >= bytes.length) return null; // truncated SOF segment
      const height = (bytes[p + 5] << 8) | bytes[p + 6];
      const width = (bytes[p + 7] << 8) | bytes[p + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }

    i = p + 2 + len; // skip the FF+marker pair, then the segment body (len
                      // already counts the length field itself)
  }
  return null;
}

/** WebP: RIFF container. Offsets verified against RFC 6386 §9.1 (VP8 lossy
 *  frame header) and the WebP Lossless Bitstream Format spec (VP8L) — the
 *  30-byte floor covers every branch's furthest read regardless of which
 *  chunk is present, and the RIFF chunk-size field is deliberately unused
 *  (this reader only needs to reach the fixed-offset dimension fields). */
function readWebpDimensions(bytes: Uint8Array): PixelSize | null {
  if (bytes.length < 30) return null;
  const tag = String.fromCharCode(...bytes.slice(0, 4));
  const webp = String.fromCharCode(...bytes.slice(8, 12));
  if (tag !== "RIFF" || webp !== "WEBP") return null;
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (chunk === "VP8X") {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { width, height };
  }
  if (chunk === "VP8 ") {
    const width = view.getUint16(26, true) & 0x3fff;
    const height = view.getUint16(28, true) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (chunk === "VP8L") {
    const b = view.getUint32(21, true);
    const width = 1 + (b & 0x3fff);
    const height = 1 + ((b >> 14) & 0x3fff);
    return { width, height };
  }
  return null;
}

/** ★★ null is a REJECTION, not a pass. Treating an unreadable header as
 *  acceptable would make the bomb guard bypassable by corrupting one byte. */
export function checkHeaderDimensions(size: PixelSize | null): CandidateResult {
  if (!size) return { ok: false, reason: "decode" };
  if (size.width > ASSET_MAX_SOURCE_DIM || size.height > ASSET_MAX_SOURCE_DIM) {
    return { ok: false, reason: "dimensions" };
  }
  return { ok: true };
}

export interface EncodedImage { bytes: Uint8Array; mime: string }

/** Fit inside the downscale target, preserving aspect ratio. Never upscales, and
 *  never returns a zero dimension — a 20000x1 banner must still be one pixel
 *  tall, not zero, or the canvas call throws. */
export function targetSize(src: PixelSize): PixelSize {
  const scale = Math.min(ASSET_DOWNSCALE_W / src.width, ASSET_DOWNSCALE_H / src.height, 1);
  return {
    width: Math.max(1, Math.round(src.width * scale)),
    height: Math.max(1, Math.round(src.height * scale)),
  };
}

/** ★★ Ties keep the ORIGINAL. Re-encoding a photo to PNG can come out larger,
 *  and a re-encode that buys nothing is pure loss — it costs a generation of
 *  quality for zero bytes. */
export function pickSmaller(original: EncodedImage, reencoded: EncodedImage): EncodedImage {
  return reencoded.bytes.length < original.bytes.length ? reencoded : original;
}

export function checkStoredSize(bytes: number): CandidateResult {
  return bytes > ASSET_STORED_MAX_BYTES
    ? { ok: false, reason: "tooLargeStored" }
    : { ok: true };
}

/** The one browser-only step. Injected so the arithmetic above stays testable
 *  in jsdom, which has no canvas. Callers pass the real implementation from
 *  the surface; tests pass a stub. */
export type ImageEncoder = (bytes: Uint8Array, mime: string, size: PixelSize) => Promise<EncodedImage>;

export interface ProcessResult {
  ok: true; image: EncodedImage; size: PixelSize;
}

/** Full pipeline over already-read bytes: header guard, downscale, stored cap,
 *  keep-original. Returns a reason code on every rejection; throws nothing. */
export async function processUpload(
  bytes: Uint8Array, mime: string, encode: ImageEncoder,
): Promise<ProcessResult | { ok: false; reason: UploadRejection }> {
  const header = readHeaderDimensions(bytes, mime);
  const dimCheck = checkHeaderDimensions(header);
  if (!dimCheck.ok) return dimCheck;
  const src = header as PixelSize;
  const target = targetSize(src);

  let chosen: EncodedImage = { bytes, mime };
  let size = src;
  if (target.width !== src.width || target.height !== src.height) {
    const reencoded = await encode(bytes, mime, target);
    chosen = pickSmaller({ bytes, mime }, reencoded);
    // Dimensions are recorded POST-downscale — but only when the downscaled
    // encode was actually the one kept.
    size = chosen === reencoded ? target : src;
  }

  const sizeCheck = checkStoredSize(chosen.bytes.length);
  if (!sizeCheck.ok) return sizeCheck;
  return { ok: true, image: chosen, size };
}
