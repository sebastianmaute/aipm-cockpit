// src/app/base64.ts — shared bytes -> base64 codec.
//
// Pulled out of document-asset-upload.ts once attachment-ingest.ts needed the
// identical chunked encoder for a second, unrelated pipeline (AI attachments,
// which must never pull in that module's asset/Turso weight). Both import
// this instead of carrying their own copy — a hand duplication of exactly
// this function (same chunk size, same algorithm) is what this file exists
// to make impossible.

const B64_CHUNK = 0x8000;

/** Chunked: String.fromCharCode(...spread) overflows its argument limit on a
 *  multi-megabyte payload, which is the size both callers ship (asset
 *  uploads, file attachments). Emits RAW base64 — no `data:` prefix; callers
 *  that need one (or a decoded blob URL) build it themselves. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK));
  }
  return btoa(out);
}
