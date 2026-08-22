// src/app/ooxml-media.ts — OOXML media-part naming and geometry.
//
// ★★ DOM-FREE BY CONTRACT: pure arithmetic and string building. No DOMParser,
// no Blob, no atob. Both OOXML renderers import it, and keeping the browser out
// means its tests are plain unit tests with no environment setup.
//
// ★★ It is its own file rather than living in either primitives module because
// BOTH need it, and because ooxml-docx-primitives.ts and ooxml-pptx-primitives.ts
// are each within ~230 lines of the 800-line ratchet.

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
  if (!width || !height || width <= 0 || height <= 0) return null;
  const naturalCx = emuFromPx(width);
  const naturalCy = emuFromPx(height);
  const scale = Math.min(1, maxWidthEmu / naturalCx, maxHeightEmu / naturalCy);
  return {
    cxEmu: Math.max(1, Math.round(naturalCx * scale)),
    cyEmu: Math.max(1, Math.round(naturalCy * scale)),
  };
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
