// One decode for stored asset bytes, shared by the document preview's
// `attachAssetImages` and the asset preview lightbox.
//
// ★★★ THE MIME TEST IS TRUTHY, NOT `!== undefined`, AND THE DIFFERENCE BREAKS
// WORKING IMAGES. `sanitizeDocumentAsset` requires only an `id`; its mime is
// `sanitizeText(...)`, which yields "" for anything non-string — so a missing,
// blank or non-string mime survives every load path as "", and such an asset
// has always rendered by content-sniffing. Declining it would stamp a repair
// marker on an image that works.
// Both come from ONE module. `safeBase64ToBytes` (not `base64ToBytes`) is the
// variant `document-asset-images.ts` already uses: it returns null for a
// malformed row AND for an empty one, so no try/catch is needed here.
import { isBlockedAssetMime, safeBase64ToBytes } from "./document-asset-upload";

export type AssetObjectUrl =
  | { kind: "ok"; url: string }
  /** Metadata says a format we refuse to render (e.g. image/svg+xml). */
  | { kind: "blocked" }
  /** Bytes absent or undecodable — the dangling case. */
  | { kind: "unavailable" };

export function assetBytesToObjectUrl(base64: string, mime: string | undefined): AssetObjectUrl {
  if (isBlockedAssetMime(mime)) return { kind: "blocked" };
  const decoded = safeBase64ToBytes(base64);
  if (decoded === null) return { kind: "unavailable" };
  // Re-wrap onto a fresh, non-shared ArrayBuffer: the decoder returns
  // `Uint8Array<ArrayBufferLike>`, which admits SharedArrayBuffer and so does
  // not satisfy BlobPart on its own (mirrors use-document-assets.ts).
  const bytes = new Uint8Array(decoded);
  const blob = mime ? new Blob([bytes], { type: mime }) : new Blob([bytes]);
  return { kind: "ok", url: URL.createObjectURL(blob) };
}
