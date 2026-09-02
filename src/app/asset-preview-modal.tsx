"use client";
// The asset preview lightbox: a draggable, resizable modal that shows ONE
// uploaded image at a time and steps through the list the caller handed it.
//
// ★★★ DISMISSAL IS THE SHARED `Modal`'S JOB, NOT OURS. It joins
// `dismissal-stack.ts`, so Escape routing and the Tab trap are already correct
// and already stack-aware for a nested layer. Do NOT add a `useDismissable`,
// a `useFocusTrap`, or a document-level Escape listener here — a second
// claimer for one layer is exactly the double-fire the stack exists to stop.
// `notes-window.tsx` DOES hand-roll a conditional Escape claim; that is
// correct THERE because it is non-modal and stays open while the user works
// elsewhere. Do NOT copy its drag wiring either: it is `useDraggableWindow`'s
// mouse API, and `ModalHeader` takes only `useDraggable`'s pointer handlers.
// `task-form-modal.tsx` is the precedent for the window mechanics below.
//
// ★★ LIST-AGNOSTIC ON PURPOSE. "Next" means next in the list you opened this
// from — the library's current sort, or a document's visual order. A single
// global ordering would make "next" jump to an image that is not visible
// where the user clicked.
import { useCallback, useEffect, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import type { DocumentAsset } from "./document-asset";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { Button } from "./button";
import { useResizable } from "./use-resizable";
import { useDraggable } from "./use-draggable";
import { type AssetObjectUrl, assetBytesToObjectUrl } from "./asset-object-url";
import { logDiag } from "./diagnostics";

// ★ Neither key collides. Enumerate today's set rather than trusting a list
// written here — a quoted enumeration rots on the next modal:
//   grep -rhn "modal-size:\|modal-pos:" src/app --include=*.tsx --include=*.ts | grep -v test
const STORAGE_KEY_POS = "aipm-cockpit:modal-pos:asset-preview";
const STORAGE_KEY_SIZE = "aipm-cockpit:modal-size:asset-preview";

const TITLE_ID = "asset-preview-modal-title";

export interface AssetPreviewModalProps {
  lang: Lang;
  open: boolean;
  onClose: () => void;
  /** The caller's own order. Prev/next walk THIS list, and do not wrap. */
  assets: readonly DocumentAsset[];
  startIndex: number;
  /** Injected byte loader — never a TursoConfig. Keeps this component
   *  storage-agnostic, and Turso gating stays inherited from the call site. */
  loadImage: (id: string) => Promise<string | null>;
  /** ★★★ THE ONE SIGNAL NO OTHER PROP CARRIES: "the BYTES behind this id may
   *  have changed." Bump it and the open image reloads. Nothing else can say
   *  this — `id` and `mime` are metadata, and a §212 repair rewrites bytes
   *  over an existing id while writing NO metadata, so every other dependency
   *  this component has is unchanged across one. Without it the lightbox goes
   *  on showing "Data missing" while the pane behind it goes healthy in the
   *  same commit. Deliberately a plain counter, not the loader identity: the
   *  loader is a function prop whose identity churns on every parent render
   *  for reasons that have nothing to do with the bytes (see `loadImageRef`
   *  below). Optional — a caller with no such signal omits it. */
  reloadNonce?: number;
}

export function AssetPreviewModal({
  lang, open, onClose, assets, startIndex, loadImage, reloadNonce,
}: AssetPreviewModalProps) {
  const [index, setIndex] = useState(startIndex);
  // ★★ The decoded result, tagged with the id it was minted for. Declared
  // HERE, above the reconcile, only so the reconcile can clear it — see the
  // open→closed branch below.
  const [view, setView] = useState<{ forId: string; result: AssetObjectUrl } | null>(null);
  const { offset, reset: dragReset, handleProps } = useDraggable(open, STORAGE_KEY_POS);
  const { ref: sizeRef, reset: sizeReset } = useResizable(STORAGE_KEY_SIZE);

  // Re-seed on a `startIndex` change AND on the closed→open transition.
  // Render-time reconcile, NOT a useEffect — `react-hooks/set-state-in-effect`
  // is banned and fatal.
  //
  // ★★ Both call sites collapse `startIndex` to a fixed value (often 0) while
  // closed, so a `startIndex`-only reconcile misses the transition entirely:
  // open row 0 (index 0) → next (index 1) → close (startIndex settles back to
  // 0, already equal to `seenStart`, so nothing reseeds) → reopen row 0
  // (`startIndex` is still 0 === `seenStart`) → the modal shows the SECOND
  // image for a click that asked for the first. Tracking `open` alongside
  // `startIndex` closes that gap: any reopen re-arms the reconcile regardless
  // of what `startIndex` collapsed to while closed.
  const [seenStart, setSeenStart] = useState(startIndex);
  const [seenOpen, setSeenOpen] = useState(open);
  if (startIndex !== seenStart || open !== seenOpen) {
    setSeenStart(startIndex);
    setSeenOpen(open);
    // Only move the index on an actual OPEN — collapsing `startIndex` while
    // closed must not itself relocate the (invisible) index.
    if (open) setIndex(startIndex);
    // ★★★ CLEARING `view` ON CLOSE IS WHAT CLOSES THE REOPEN FLASH, AND THE
    // `forId` TAG BELOW DOES NOT. Closing revokes the URL (the load effect's
    // cleanup) but the effect BODY early-returns on `!open`, so it can never
    // clear the state that holds the now-dead URL. On reopen only `open` has
    // changed — the asset id has NOT — so a tag comparison still matches and
    // the render commits `<img src={revokedUrl}>` before the passive effect
    // can replace it. A first cut of this component shipped exactly that, with
    // a comment claiming the tag had fixed it; the tag earns its place on the
    // NAVIGATE and list-SHRINK paths, where the id genuinely changes, and on
    // this path it is inert. Clearing here is the fix.
    // ★★ This is a render-phase update on this same component, which is the
    // repo's prescribed alternative to `set-state-in-effect` — the same
    // mechanism `index` above uses, so it costs one extra render and settles.
    if (!open) setView(null);
  }

  const current = assets[index];
  const atFirst = index <= 0;
  const atLast = index >= assets.length - 1;
  const go = useCallback((delta: number) => {
    setIndex((i) => Math.min(Math.max(i + delta, 0), assets.length - 1));
  }, [assets.length]);

  // Holds the URL currently minted so cleanup revokes exactly one thing.
  const urlRef = useRef<string | null>(null);

  const release = useCallback(() => {
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
  }, []);

  // ★★ `loadImage` is a function PROP. The natural call site (Task 8) passes
  // an inline arrow, a new identity on every parent render — with `loadImage`
  // itself in the deps below, an incidental parent re-render while the modal
  // is open would fire this effect's cleanup and revoke the URL currently ON
  // SCREEN, for no navigate/close reason. A latest-ref sidesteps that: the
  // effect always calls the CURRENT loader without depending on its identity.
  // Declared BEFORE the loading effect so a render that changes `loadImage`
  // refreshes the ref before that effect can read it.
  const loadImageRef = useRef(loadImage);
  useEffect(() => { loadImageRef.current = loadImage; });

  // ★★★ REVOKE ON NAVIGATE **AND** ON CLOSE. This effect's cleanup covers
  // both: it runs when `id` changes (navigate) and on unmount/close. Revoking
  // only in a close handler leaks one URL per arrow-press for the whole
  // session, and nothing but a revokeObjectURL spy can see it.
  const id = current?.id;
  const currentMime = current?.mime;
  useEffect(() => {
    if (!open || !id) return;
    let cancelled = false;
    void (async () => {
      setView(null);
      const base64 = await loadImageRef.current(id).catch((err: unknown) => {
        logDiag("error", "assetPreview.loadFailed", { message: err instanceof Error ? err.message : String(err) });
        return null;
      });
      if (cancelled) return;
      if (base64 === null) { setView({ forId: id, result: { kind: "unavailable" } }); return; }
      const r = assetBytesToObjectUrl(base64, currentMime);
      if (cancelled) { if (r.kind === "ok") URL.revokeObjectURL(r.url); return; }
      if (r.kind === "ok") urlRef.current = r.url;
      setView({ forId: id, result: r });
    })();
    return () => { cancelled = true; release(); };
  }, [open, id, release, currentMime, reloadNonce]);

  // Only a result minted for the asset on screen may render. This covers the
  // NAVIGATE path (the render after `id` changes commits before the load
  // effect can replace the previous asset's result) and the list-SHRINK path
  // (`id` goes undefined, and the effect early-returns without clearing
  // anything, so nothing else would). It does NOT cover open→close→reopen,
  // where `id` is unchanged and this comparison still matches — the reconcile
  // above clears `view` on close for that.
  // ★★★ BOTH NULL CHECKS ARE LOAD-BEARING AND THE OBVIOUS SHORTENING CRASHES.
  // `view?.forId === id` reads as safe and is not: with no result yet AND no
  // current asset, it compares `undefined === undefined`, takes the TRUE
  // branch, and dereferences `view.result` on null. That is the ordinary
  // first render of a modal opened on an empty list — it threw in nine tests.
  // Compare the two things explicitly rather than leaning on optional
  // chaining, which narrows nothing here.
  const shown = view !== null && id !== undefined && view.forId === id ? view.result : null;

  return (
    // `ariaLabelledby` over `ariaLabel` so the dialog's accessible name IS the
    // heading a sighted user reads and the two cannot drift — the convention
    // `asset-library-modal.tsx` states at its own Modal.
    <Modal open={open} onClose={onClose} ariaLabelledby={TITLE_ID} align="center">
      <div
        ref={sizeRef}
        data-modal-panel
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        className="relative flex h-[720px] max-h-[95vh] min-h-[360px] w-[900px] min-w-[380px] max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader
          lang={lang}
          title={t(lang, "assetPreviewTitle", current?.name ?? "")}
          titleId={TITLE_ID}
          onClose={onClose}
          dragHandleProps={handleProps}
          onResetLayout={() => { dragReset(); sizeReset(); }}
        />
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          {shown?.kind === "ok" && (
            // A blob: object URL — next/image cannot optimize it (there is no
            // remote src to fetch), so the native element is correct here.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown.url} alt={current?.name ?? ""} className="min-h-0 flex-1 object-contain" />
          )}
          {shown?.kind === "unavailable" && (
            <p className="flex-1 p-4 text-sm text-muted-foreground">{t(lang, "assetPreviewUnavailable")}</p>
          )}
          {shown?.kind === "blocked" && (
            <p className="flex-1 p-4 text-sm text-muted-foreground">{t(lang, "assetPreviewBlocked")}</p>
          )}
          <div className="flex items-center justify-between gap-2">
            <Button variant="secondary" size="sm" onClick={() => go(-1)} disabled={atFirst}
              aria-label={t(lang, "assetPreviewPrev")}>
              {t(lang, "assetPreviewPrev")}
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground">
              {t(lang, "assetPreviewPosition", index + 1, assets.length)}
            </span>
            <Button variant="secondary" size="sm" onClick={() => go(1)} disabled={atLast}
              aria-label={t(lang, "assetPreviewNext")}>
              {t(lang, "assetPreviewNext")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
