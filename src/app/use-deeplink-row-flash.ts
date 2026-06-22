import { useEffect, useRef, useState } from "react";
import { useWorkspaceTab } from "./workspace-tab-context";
import type { AppView } from "./nav-config";

export const DEEPLINK_FLASH_MS = 1800;
const FLASH_CLASS = "outline outline-2 -outline-offset-2 outline-AIPM-green";

/** Outline classes for the transiently-flashed row; "" otherwise. */
export function flashOutlineClass(isFlashed: boolean): string {
  return isFlashed ? FLASH_CLASS : "";
}

/**
 * When a `requestOpen(view, id)` deep-link lands on this panel, scroll the row
 * carrying `data-deeplink-row="<id>"` into view (centered) and flash `flashId`
 * for DEEPLINK_FLASH_MS. Does NOT clear pendingOpen — the panel's own
 * editor-open effect still does. Graceful no-op when the row isn't in the DOM.
 */
/** The deep-link target id for this `view`, or null when the pending request is
 *  for another view / a sentinel (id < 0) / nothing pending. */
function targetIdFor(
  pendingOpen: { view: AppView; id: number } | null,
  view: AppView,
): number | null {
  if (pendingOpen?.view !== view) return null;
  return pendingOpen.id < 0 ? null : pendingOpen.id;
}

export function useDeepLinkRowFlash(view: AppView): {
  flashId: number | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
} {
  const { pendingOpen, pendingFlash, clearPendingFlash } = useWorkspaceTab();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [flashId, setFlashId] = useState<number | null>(null);
  // Monotonic nonce: bumped on every fresh matching request so the side-effect
  // re-runs (re-scroll + re-arm the clear timer) even when the SAME id is
  // re-requested within the flash window — `setFlashId(sameValue)` would bail the
  // state update and leave a `[flashId]`-only effect dormant (no re-scroll, stale
  // timer). When the timer sets `flashId=null`, flashSeq is unchanged but flashId
  // changed → effect re-runs → early-returns. No infinite loop: bumping flashSeq
  // does not change `pendingOpen`/`handled`, so the reconcile only fires per request.
  const [flashSeq, setFlashSeq] = useState(0);
  // Render-time reconcile (NOT a useEffect — set-state-in-effect is banned): when
  // a new matching deep-link lands, sync flashId during render. `handled` tracks
  // the last pendingOpen object reference we acted on so we fire exactly once per
  // request and never re-fire on an unrelated re-render.
  const [handled, setHandled] = useState<
    { view: AppView; id: number } | null | undefined
  >(undefined);
  const targetId = targetIdFor(pendingOpen, view);
  if (pendingOpen !== handled) {
    setHandled(pendingOpen);
    if (targetId !== null) {
      setFlashId(targetId);
      setFlashSeq((s) => s + 1);
    }
  }

  // Parallel reconcile for the FLASH-ONLY signal: same render-time pattern, but
  // this source carries no editor-open/tab-switch, so the hook itself consumes
  // (clears) pendingFlash once handled. Seeded `undefined` so a fresh mount that
  // already sees pendingFlash still fires (do NOT seed from the live prop).
  const [handledFlash, setHandledFlash] = useState<
    { view: AppView; id: number } | null | undefined
  >(undefined);
  if (pendingFlash !== handledFlash) {
    setHandledFlash(pendingFlash);
    const flashTarget = targetIdFor(pendingFlash, view);
    if (flashTarget !== null) {
      setFlashId(flashTarget);
      setFlashSeq((s) => s + 1);
      clearPendingFlash();
    }
  }

  // Keyed on flashId, NOT pendingOpen: the destination panel clears pendingOpen
  // (object→null) almost immediately after a deep-link lands, and a pendingOpen
  // dep would tear this effect down — cancelling the rAF scroll before it fires
  // and the auto-clear timer (leaving the outline stuck on forever). flashId only
  // changes when a new request lands or the timer clears it, so the scroll +
  // auto-clear survive the pendingOpen clear.
  useEffect(() => {
    if (flashId === null) return;
    const raf = requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector(`[data-deeplink-row="${flashId}"]`)
        ?.scrollIntoView({ block: "center", behavior: "auto" });
    });
    const timer = setTimeout(() => setFlashId(null), DEEPLINK_FLASH_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [flashId, flashSeq]);

  return { flashId, containerRef };
}
