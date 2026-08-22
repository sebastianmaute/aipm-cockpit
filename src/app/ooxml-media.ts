// src/app/ooxml-media.ts — OOXML media-part naming and geometry.
//
// ★★ DOM-FREE BY CONTRACT: pure arithmetic and string building. No DOMParser,
// no Blob, no atob. Both OOXML renderers import it, and keeping the browser out
// means its tests are plain unit tests with no environment setup.
//
// ★★ It is its own file rather than living in either primitives module because
// BOTH need it, and because ooxml-docx-primitives.ts and ooxml-pptx-primitives.ts
// are both close enough to the 800-line ratchet that neither can absorb it.

/** EMUs (English Metric Units) per inch — the OOXML coordinate unit. */
export const EMU_PER_INCH = 914400;

/** CSS pixels are 96 to the inch by definition, and the stored asset
 *  dimensions ARE CSS pixels: they are captured from the downscale canvas. */
const PX_PER_INCH = 96;

export function emuFromPx(px: number): number {
  return Math.round((px * EMU_PER_INCH) / PX_PER_INCH);
}

export type MediaExtension = "png" | "jpeg" | "webp";

/** mime → the extension used by BOTH the part name and the
 *  `[Content_Types].xml` `Default` entry.
 *
 *  ★ Returns null outside `ASSET_MIME_ALLOWED` rather than guessing. A part
 *  whose declared type is wrong is a file Word refuses to open, which is worse
 *  than the placeholder the caller falls back to. The mapping is deliberately
 *  a literal switch and not a `mime.split("/")[1]`: that would happily mint
 *  `svg+xml` as an extension for the one type the upload path excludes.
 *
 *  ★★ Every member is also spelled `image/<ext>`, which the `Default` entry in
 *  both package builders relies on — see `contentTypeFor`. */
export function mediaExtension(mime: string): MediaExtension | null {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpeg";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}

/** The `[Content_Types].xml` ContentType for an extension this module minted. */
export function contentTypeFor(ext: MediaExtension): string {
  return `image/${ext}`;
}

export type Extent = { cxEmu: number; cyEmu: number };

/** A dimension the OOXML geometry can actually use. */
function positiveFinite(n: number | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/**
 * Aspect-preserving fit of a pixel dimension pair into an EMU box.
 *
 * ★★★ RETURNS NULL WHEN EITHER DIMENSION IS ABSENT, and that is a real case,
 * not defensive noise: `DocumentAsset.width` and `.height` are declared
 * OPTIONAL in `document-asset.ts`, whose own header explains why (the module
 * is mime-generic by contract so the same table can serve a later non-image
 * asset type). OOXML needs a concrete extent, and the only ways to invent one
 * are to guess an aspect ratio — a silent visual corruption — or to decode the
 * bytes, which the stored dimensions exist to avoid. The caller falls back to
 * the placeholder.
 */
export function fitExtent(
  dim: { width?: number; height?: number },
  maxWidthEmu: number,
  maxHeightEmu: number,
): Extent | null {
  const { width, height } = dim;
  // ★★ Number.isFinite, not truthiness: `!width` catches undefined/0/NaN and
  // `width <= 0` catches negatives, but NEITHER catches Infinity — which
  // produces scale 0, then NaN * 0, and emits cx="NaN" into the drawing XML.
  // A malformed extent is a file Word refuses to open, which is the exact
  // failure this module's null return exists to avoid. The load path's own
  // sanitizer already rejects all four (document-asset.ts `dim()` admits only
  // Number.isFinite(n) && n > 0), so this is defence at the boundary, not a
  // live bug — but this function is exported and its callers grow.
  if (!positiveFinite(width) || !positiveFinite(height)) return null;
  // ★★★ A BOX UNDER 1 EMU CANNOT HOLD AN IMAGE, and without this the clamp
  // below returns an extent that EXCEEDS the bound it was given: at
  // maxWidthEmu 0 the scale is 0, both dimensions round to 0, and Math.max(1,…)
  // lifts them back to 1. Not reachable from today's two call sites (both pass
  // module constants in the millions) — it becomes reachable the moment a
  // pagination pass hands in REMAINING space. Rejecting is right: the caller's
  // fallback is the placeholder, which is honest, where a 1-EMU picture is not.
  if (!(maxWidthEmu >= 1) || !(maxHeightEmu >= 1)) return null;
  const naturalCx = emuFromPx(width);
  const naturalCy = emuFromPx(height);
  const scale = Math.min(1, maxWidthEmu / naturalCx, maxHeightEmu / naturalCy);
  const cxEmu = Math.round(naturalCx * scale);
  const cyEmu = Math.round(naturalCy * scale);
  // ★★★ A SUB-1-EMU RESULT IS REJECTED, NOT CLAMPED, and the clamp that used to
  // sit here is why. `Math.max(1, …)` violated this function's own postcondition:
  // at a bound below 1 EMU it returned an extent WIDER than the box it was asked
  // to fit into. The bound guard above closes that case — but the clamp stayed
  // reachable by a second route, a sub-pixel SOURCE dimension: width 1e-5 makes
  // `naturalCx` round to 0, `maxWidthEmu / 0` is Infinity, scale is 1, and the
  // clamp lifts a zero extent back to 1. That emits a picture the reader cannot
  // see, where the caller's fallback — the placeholder — at least says something
  // is there. Deleting the clamp alone would be worse still: `cx="0"` is a
  // zero-area frame Word and PowerPoint render broken.
  //
  // ★★ The payoff is that the return is now TOTAL in one direction: either a
  // usable extent, with both dimensions >= 1 AND within both bounds, or null.
  // There is no third shape for a caller to handle.
  if (cxEmu < 1 || cyEmu < 1) return null;
  return { cxEmu, cyEmu };
}

/** One embedded image, as both package builders consume it. */
export type MediaPart = {
  /** Full path inside the package, e.g. `word/media/image1.png`. */
  path: string;
  data: Uint8Array;
  extension: MediaExtension;
  /** Relationship id the drawing references via `r:embed`. */
  relId: string;
};
