// One decode for stored asset bytes, used by the asset preview lightbox.
//
// ★★★ IT IS NOT YET SHARED, AND AN EARLIER WORDING HERE SAID IT WAS.
// `attachAssetImages` (`document-asset-images.ts`) implements the SAME
// three-way rule inline and does NOT call this — grep it and you will find no
// import. So the two agree today by coincidence, not by construction, and a
// fix to one has no mechanism forcing the other to follow. Do not read this
// module as the single spelling until that call site is migrated.
// ★★ MIGRATING IT IS NOT A PURE REFACTOR, which is why it was not folded in
// here: this function tests the blocked mime BEFORE decoding, while
// `attachAssetImages` decodes first and tests after, so for bytes that are
// both undecodable AND blocked the two disagree — one reports blocked, the
// other dangling. Rewiring changes that shipping path's behaviour and needs
// its own change with its own tests.
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
