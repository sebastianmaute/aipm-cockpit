// src/app/document-asset-images.ts
//
// Resolves `<img data-asset-id>` inside an ALREADY-RENDERED subtree to blob
// object URLs.
//
// ★★★ IMPERATIVE ON PURPOSE, TWICE OVER. First, the preview hands one HTML
// string to dangerouslySetInnerHTML, so there is no React element to give a
// src to. Second, `react-hooks/set-state-in-effect` is banned and fatal — this
// needs no state at all, so it cannot trip it.
//
// ★★ NEVER INLINE BASE64. Ten images would put ~67 MB into that one string.

import { isAllowedAssetMime, safeBase64ToBytes } from "./document-asset-upload";

export type AssetByteLoader = (id: string) => Promise<string | null>;

/** Optional: resolves an asset id to its stored MIME type, so the Blob this
 *  mints carries the real type instead of leaving rendering to content
 *  sniffing. Absent (or a miss) falls back to no type at all — the browser's
 *  existing behaviour, not a regression. A mime OUTSIDE the upload allowlist
 *  is the third outcome: that asset is DECLINED, not rendered untyped. */
export type AssetMimeLookup = (id: string) => string | undefined;

/** Optional: asked ONCE, after the fetches settle and BEFORE any DOM write,
 *  whether this run is still the current one. Returning false makes the run
 *  revoke its own URLs and touch nothing. See the ★★★ at the write loop. */
export type AssetApplyGuard = () => boolean;

/** Clears the missing-asset marker from every `<img data-asset-id>` in a
 *  subtree, without touching `src`.
 *
 *  ★★ FOR THE CALLER THAT DECIDES NOT TO RESOLVE AT ALL. A previous run may
 *  already have stamped markers; if asset storage then goes away (a mode
 *  switch, Safe Mode) the caller bails and those markers would otherwise stay,
 *  showing the dashed red "this image is missing" frame for exactly the state
 *  the bail exists to stop claiming. `src` is deliberately left alone — the
 *  caller's own teardown revokes the URLs, and a dead `src` is the browser's
 *  problem, not a false assertion about the user's data. */
export function clearAssetMissingMarkers(rootEl: HTMLElement): void {
  for (const img of rootEl.querySelectorAll<HTMLImageElement>("img[data-asset-missing]")) {
    img.removeAttribute("data-asset-missing");
  }
}

export async function attachAssetImages(
  rootEl: HTMLElement, load: AssetByteLoader, mimeFor?: AssetMimeLookup,
  shouldApply?: AssetApplyGuard,
): Promise<() => void> {
  const imgs = Array.from(rootEl.querySelectorAll<HTMLImageElement>("img[data-asset-id]"));
  if (!imgs.length) return () => {};

  const ids = Array.from(new Set(imgs.map((i) => i.getAttribute("data-asset-id") ?? "")));
  const urls = new Map<string, string>();

  await Promise.all(ids.map(async (id) => {
    try {
      const b64 = await load(id);
      if (!b64) return;
      // ★★★ `safeBase64ToBytes`, NOT the raw `base64ToBytes`, and the CATCH
      // below is not a substitute for it. A whitespace-only stored row
      // ("\t\r\n ") decodes to ZERO bytes and raises NOTHING — `atob` strips
      // ASCII whitespace before decoding — so the catch never fires, a
      // zero-byte Blob gets an object URL, `url` is truthy, and the branch
      // below then STRIPS `data-asset-missing` off the very element the repair
      // affordance is drawn on. The reader is left with a bare broken-image
      // icon and no disclosure at all. Declining here routes it down the same
      // marker path the OOXML sinks already use.
      const decoded = safeBase64ToBytes(b64);
      if (!decoded) return;
      // `new Uint8Array(bytes)` re-wraps onto a fresh, non-shared ArrayBuffer —
      // the decoder's return type is `Uint8Array<ArrayBufferLike>`, which
      // admits SharedArrayBuffer and so does not satisfy BlobPart on its own
      // (mirrors the same re-wrap in use-document-assets.ts).
      const bytes = new Uint8Array(decoded);
      const mime = mimeFor?.(id);
      // ★★★ THE TEST IS TRUTHY, NOT `mime !== undefined`, AND THE DIFFERENCE
      // BREAKS WORKING IMAGES. FOUR cases reach this line, not three:
      //   (a) no `mimeFor` supplied at all      → undefined → fall through
      //   (b) lookup MISSED (no metadata row)   → undefined → fall through
      //   (c) lookup hit a DISALLOWED mime      → e.g. image/svg+xml → DECLINE
      //   (d) lookup hit a row whose mime is "" → fall through
      // (d) is the one `!== undefined` gets wrong. `sanitizeDocumentAsset`
      // requires only an `id`; its mime is `sanitizeText(o.mime, …)`, which
      // returns "" for anything non-string — so a missing, blank or non-string
      // mime SURVIVES sanitising as "" on every load path, and such an asset
      // has always rendered by content-sniffing. `isAllowedAssetMime("")` is
      // false, so `!== undefined` would decline it and stamp the repair marker
      // on an image that works. Truthy also mirrors the ternary immediately
      // below, so the two lines cannot disagree about what "no mime" means.
      // (§223 predicted this consumer: it reads a stored mime and builds a
      // Blob from it with no allowlist and no cast, so no search for
      // `ASSET_MIME_ALLOWED` could find it.)
      if (mime && !isAllowedAssetMime(mime)) return;
      const blob = mime ? new Blob([bytes], { type: mime }) : new Blob([bytes]);
      urls.set(id, URL.createObjectURL(blob));
    } catch {
      // Swallowed deliberately: a byte row that will not load IS the dangling
      // case, and the marker below is how the user is told. Propagating would
      // take down the whole preview for one missing image.
    }
  }));

  // ★★★ STALENESS IS CHECKED HERE, NOT BY THE CALLER, AND THE CALLER CANNOT DO
  // IT. Every write below is unconditional and lands AFTER an await, so two
  // overlapping runs over the SAME subtree race and the one that settles LAST
  // wins — regardless of which started first. That is not hypothetical: a §212
  // repair bumps `assetRepairGeneration` while a run over the OLD, broken bytes
  // is still in flight, and `html` has not changed, so React never replaces the
  // innerHTML and both runs hold the very same elements. The stale run then
  // stamps `data-asset-missing` back over the image the fresh run just
  // repaired, and it stays visibly broken until some unrelated dep changes.
  // A caller's own `cancelled` flag cannot prevent this — it can only skip the
  // caller's bookkeeping after these writes have already happened.
  // ★★ The two callers' teardown revokes only the run it belongs to, so a stale
  // run must revoke its OWN urls here or they leak; returning a no-op disposer
  // is then correct, since there is nothing left to release.
  if (shouldApply && !shouldApply()) {
    for (const url of urls.values()) URL.revokeObjectURL(url);
    return () => {};
  }

  for (const img of imgs) {
    const url = urls.get(img.getAttribute("data-asset-id") ?? "");
    // ★★★ CLEARING THE MARKER IS NOT SYMMETRY FOR ITS OWN SAKE. This function
    // is re-run over the SAME subtree whenever a §212 repair lands (the preview
    // effect's `assetRepairGeneration` dependency) — `html` has not changed, so
    // React never replaces the innerHTML and these are the very elements a
    // previous, failed run stamped. Setting `src` alone leaves
    // `data-asset-missing` behind, and `globals.css` draws a dashed red frame
    // plus a min-size box around `img[data-asset-missing]` regardless of `src`
    // (only the `::before` warning glyph drops out, because a replaced element
    // has no generated content). The repaired image would render inside a
    // broken-image frame.
    if (url) {
      img.setAttribute("src", url);
      img.removeAttribute("data-asset-missing");
    } else img.setAttribute("data-asset-missing", "true");
  }

  return () => { for (const url of urls.values()) URL.revokeObjectURL(url); };
}
