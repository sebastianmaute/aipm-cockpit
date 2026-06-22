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
  const { pendingOpen } = useWorkspaceTab();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [flashId, setFlashId] = useState<number | null>(null);
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
    if (targetId !== null) setFlashId(targetId);
  }

  useEffect(() => {
    const id = targetIdFor(pendingOpen, view);
    if (id === null) return;
    const raf = requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector(`[data-deeplink-row="${id}"]`)
        ?.scrollIntoView({ block: "center", behavior: "auto" });
    });
    const timer = setTimeout(() => setFlashId(null), DEEPLINK_FLASH_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [pendingOpen, view]);

  return { flashId, containerRef };
}
