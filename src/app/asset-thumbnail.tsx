"use client";
// src/app/asset-thumbnail.tsx — a small image preview for one asset-library row
// (open-followups §482).
//
// ★★ It reuses the preview lightbox's byte path, not a new one: the same
// injected `loadImage` loader and the same `assetBytesToObjectUrl` decode, so a
// thumbnail and the lightbox can never disagree on what an asset's bytes are.
//
// ★★ Three things bound the cost of fetching each asset's FULL bytes:
//   1. IN VIEW ONLY — an IntersectionObserver (100px rootMargin) loads a row as
//      it scrolls in and, staying connected, revokes its URL as it scrolls out;
//      it reloads on the way back. Live object URLs are therefore bounded by the
//      rows in view. With no observer available every row counts as in view.
//   2. CAPPED — every load goes through the library's shared `LoadLimiter`, so
//      a screenful of rows does not fire one request each at the same moment.
//   3. NO WASTED FETCH — a load still queued when its row leaves the view or
//      unmounts takes its turn as a no-op that fetches nothing and frees the
//      slot at once; a row that scrolls back in while its fetch is still
//      running reuses that fetch rather than starting a second one.
// ★ Remaining costs, recorded rather than fixed:
//   - Each visible thumbnail decodes the full stored image (up to
//     `ASSET_STORED_MAX_BYTES`) for a 32px box. A downscale step was considered
//     and not taken: jsdom cannot test it.
//   - The observer uses the default (viewport) root. The browser still clips
//     each row by its scrolling ancestors, so "in view" and the URL bound are
//     correct inside the library's modal or page scroller; only the 100px early
//     start applies at the viewport edge rather than the scroller's, so a row
//     can pop in empty there. Using the scroller as the root needs the element
//     that really scrolls vertically, which differs per mount: the table's own
//     `overflow-auto` wrapper has no height limit and scrolls only sideways, so
//     using it as the root would count every row as in view. jsdom has no
//     layout to test a choice like that (§482 review m4).
//
// ★ Decorative. The row already names the asset, so the image has `alt=""` and
// the box is `aria-hidden`; it adds no control and no name to the row.
//
// ★ Each object URL is revoked when its row unmounts, leaves the view, changes
// asset or turns unavailable; bytes that arrive after any of those are never
// minted into a URL at all.
//
// ★ No reload signal: a §212 repair that rewrites the bytes of a row that was
// never marked dangling keeps showing the old image until the library remounts.
// The library's own lightbox mount has the same gap (it passes no reloadNonce).
import { useEffect, useRef, useState } from "react";
import { assetBytesToObjectUrl } from "./asset-object-url";
import { isBlockedAssetMime } from "./document-asset-upload";
import type { AssetByteLoader } from "./document-asset-images";
import type { LoadLimiter } from "./asset-load-limiter";
import { logDiag } from "./diagnostics";

const THUMBNAIL_ROOT_MARGIN = "100px";

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
  // In view (within the observer's rootMargin). No IntersectionObserver (an
  // old browser) → treat the row as always in view.
  const [inView, setInView] = useState(() => typeof IntersectionObserver === "undefined");
  // The observer is disconnected while the row is unavailable, so the last
  // reported `inView` goes stale. Forget it, so a row that turns available again
  // while off-screen waits for the new observer's first report instead of
  // loading on the stale `true` (§482 review m3).
  if (unavailable && inView && typeof IntersectionObserver !== "undefined") setInView(false);
  // Tagged with the asset it was minted for, so a render after the id or mime
  // changed never shows the previous asset's (revoked) URL.
  const [shown, setShown] = useState<{ key: string; url: string } | null>(null);
  const key = `${id}|${mime ?? ""}`;
  // Render-time reconcile (the repo's alternative to set-state-in-effect). The
  // load effect's cleanup revokes the URL whenever the row turns unavailable,
  // leaves the view, or changes asset — so drop it here in each case too.
  // Otherwise a row that comes back under the SAME key (available again, in view
  // again, or an A→B→A mime change) would render the revoked URL until, or on a
  // failed reload instead of, a new one.
  if (shown !== null && (unavailable || !inView || shown.key !== key)) setShown(null);

  // The loader is a function prop whose identity can churn on parent renders;
  // read it through a ref so a re-render does not refetch.
  const loadImageRef = useRef(loadImage);
  useEffect(() => { loadImageRef.current = loadImage; });

  // The fetch currently running for this row, tagged with the asset it is for.
  // A row that scrolls out and back in while its fetch is still running reuses
  // that fetch instead of starting a second one (§482 review m1); only the
  // earlier effect run's result is discarded, never the bytes. The trade-off: a
  // fetch that never settles is never retried while the row stays mounted under
  // the same asset; scrolling out and back in no longer starts a fresh one.
  const inFlightRef = useRef<{ key: string; bytes: Promise<string | null> } | null>(null);

  // ★★ The observer STAYS connected (§482 review I2). A row that scrolls out
  // revokes its URL, and a load it still has queued fetches nothing; one that
  // scrolls back in reloads. So the
  // live object URLs — each the asset's FULL stored bytes — are bounded by the
  // rows in view, and a fast scroll does not leave every row it passed queued
  // ahead of the ones the user stopped on.
  useEffect(() => {
    if (unavailable) return;
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        // One target, so the latest entry is its current state.
        const latest = entries[entries.length - 1];
        if (latest) setInView(latest.isIntersecting);
      },
      // Start a little before the row scrolls in, so it rarely pops in empty.
      { rootMargin: THUMBNAIL_ROOT_MARGIN },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [unavailable]);

  useEffect(() => {
    if (!inView || unavailable) return;
    let cancelled = false;
    let url: string | null = null;
    const prior = inFlightRef.current;
    const bytes =
      prior && prior.key === key
        ? prior.bytes
        : limiter.run(async () => {
            // Queued behind other rows and gone (unmounted or scrolled out)
            // meanwhile: give the slot back without fetching.
            if (cancelled) return null;
            const fetched = loadImageRef.current(id).catch((err: unknown) => {
              logDiag("error", "assetThumbnail.loadFailed", { message: err instanceof Error ? err.message : String(err) });
              return null;
            });
            const entry = { key, bytes: fetched };
            inFlightRef.current = entry;
            void fetched.finally(() => {
              if (inFlightRef.current === entry) inFlightRef.current = null;
            });
            return fetched;
          });
    bytes
      .then((base64) => {
        if (cancelled || base64 === null) return;
        const r = assetBytesToObjectUrl(base64, mime);
        if (r.kind !== "ok") return;
        url = r.url;
        setShown({ key, url: r.url });
      })
      // Nothing above should throw, but a decode or Blob failure must not
      // surface as an unhandled rejection.
      .catch((err: unknown) => {
        logDiag("error", "assetThumbnail.decodeFailed", { message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [inView, unavailable, id, mime, key, limiter]);

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
