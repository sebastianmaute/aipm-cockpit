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
