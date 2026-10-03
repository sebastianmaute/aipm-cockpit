"use client";
// src/app/asset-thumbnail.tsx — a small image preview for one asset-library row
// (open-followups §482).
//
// ★★ It reuses the preview lightbox's byte path, not a new one: the same
// injected `loadImage` loader and the same `assetBytesToObjectUrl` decode, so a
// thumbnail and the lightbox can never disagree on what an asset's bytes are.
//
// ★★ Two things bound the cost of fetching each asset's FULL bytes:
//   1. LAZY — nothing loads until the row scrolls into view (an
//      IntersectionObserver; with none available it loads at once). A long
//      library pays only for the rows a user actually sees.
//   2. CAPPED — every load goes through the library's shared `LoadLimiter`, so
//      a screenful of rows does not fire one request each at the same moment.
//
// ★ Decorative. The row already names the asset, so the image has `alt=""` and
// the box is `aria-hidden`; it adds no control and no name to the row.
//
// ★ Each object URL is revoked when its row unmounts or the asset changes, and
// one that arrives after the row went away is revoked on arrival.
import { useEffect, useRef, useState } from "react";
import { assetBytesToObjectUrl } from "./asset-object-url";
import { isBlockedAssetMime } from "./document-asset-upload";
import type { AssetByteLoader } from "./document-asset-images";
import type { LoadLimiter } from "./asset-load-limiter";
import { logDiag } from "./diagnostics";

interface AssetThumbnailProps {
  id: string;
  mime: string | undefined;
  loadImage: AssetByteLoader;
  limiter: LoadLimiter;
  /** Dangling bytes or a refused mime: render the empty box, fetch nothing. */
  unavailable: boolean;
}

export function AssetThumbnail({ id, mime, loadImage, limiter, unavailable: unavailableProp }: AssetThumbnailProps) {
  // A refused mime is never fetched — the lightbox asks the same question first,
  // so the bytes would only be paid for and thrown away.
  const unavailable = unavailableProp || isBlockedAssetMime(mime);
  const boxRef = useRef<HTMLSpanElement>(null);
  // No IntersectionObserver (an old browser) → treat the row as visible at once.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  // Tagged with the asset it was minted for, so a render after the id or mime
  // changed never shows the previous asset's (revoked) URL.
  const [shown, setShown] = useState<{ key: string; url: string } | null>(null);
  const key = `${id}|${mime ?? ""}`;

  // The loader is a function prop whose identity can churn on parent renders;
  // read it through a ref so a re-render does not refetch.
  const loadImageRef = useRef(loadImage);
  useEffect(() => { loadImageRef.current = loadImage; });

  useEffect(() => {
    if (visible || unavailable) return;
    const el = boxRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [visible, unavailable]);

  useEffect(() => {
    if (!visible || unavailable) return;
    let cancelled = false;
    let url: string | null = null;
    void limiter
      .run(async () => {
        // Queued behind other rows and unmounted meanwhile: give the slot back.
        if (cancelled) return null;
        return loadImageRef.current(id).catch((err: unknown) => {
          logDiag("error", "assetThumbnail.loadFailed", { message: err instanceof Error ? err.message : String(err) });
          return null;
        });
      })
      .then((base64) => {
        if (cancelled || base64 === null) return;
        const r = assetBytesToObjectUrl(base64, mime);
        if (r.kind !== "ok") return;
        url = r.url;
        setShown({ key, url: r.url });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [visible, unavailable, id, mime, key, limiter]);

  const src = !unavailable && shown?.key === key ? shown.url : null;
  return (
    <span
      ref={boxRef}
      aria-hidden="true"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border border-line bg-surface-muted"
    >
      {src && (
        // A blob: object URL — next/image cannot optimize it (there is no
        // remote src to fetch), so the native element is correct here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      )}
    </span>
  );
}
