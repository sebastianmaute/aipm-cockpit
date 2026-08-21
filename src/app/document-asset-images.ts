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

import { base64ToBytes } from "./document-asset-upload";

export type AssetByteLoader = (id: string) => Promise<string | null>;

/** Optional: resolves an asset id to its stored MIME type, so the Blob this
 *  mints carries the real type instead of leaving rendering to content
 *  sniffing. Absent (or a miss) falls back to no type at all — the browser's
 *  existing behaviour, not a regression. */
export type AssetMimeLookup = (id: string) => string | undefined;

export async function attachAssetImages(
  rootEl: HTMLElement, load: AssetByteLoader, mimeFor?: AssetMimeLookup,
): Promise<() => void> {
  const imgs = Array.from(rootEl.querySelectorAll<HTMLImageElement>("img[data-asset-id]"));
  if (!imgs.length) return () => {};

  const ids = Array.from(new Set(imgs.map((i) => i.getAttribute("data-asset-id") ?? "")));
  const urls = new Map<string, string>();

  await Promise.all(ids.map(async (id) => {
    try {
      const b64 = await load(id);
      if (!b64) return;
      // `new Uint8Array(bytes)` re-wraps onto a fresh, non-shared ArrayBuffer —
      // `base64ToBytes`'s return type is `Uint8Array<ArrayBufferLike>`, which
      // admits SharedArrayBuffer and so does not satisfy BlobPart on its own
      // (mirrors the same re-wrap in use-document-assets.ts).
      const bytes = new Uint8Array(base64ToBytes(b64));
      const mime = mimeFor?.(id);
      const blob = mime ? new Blob([bytes], { type: mime }) : new Blob([bytes]);
      urls.set(id, URL.createObjectURL(blob));
    } catch {
      // Swallowed deliberately: a byte row that will not load IS the dangling
      // case, and the marker below is how the user is told. Propagating would
      // take down the whole preview for one missing image.
    }
  }));

  for (const img of imgs) {
    const url = urls.get(img.getAttribute("data-asset-id") ?? "");
    if (url) img.setAttribute("src", url);
    else img.setAttribute("data-asset-missing", "true");
  }

  return () => { for (const url of urls.values()) URL.revokeObjectURL(url); };
}
