// useResizable — give any DOM container a persistent, user-resizable size.
//
// Pattern: the element should carry `resize: both; overflow: auto` (i.e. Tailwind
// `resize overflow-auto`) plus class-based default `width`/`height` and reasonable
// min/max bounds. This hook then:
//
//   1. On mount, reads a saved `{ width, height }` from localStorage at
//      `storageKey` and writes them to the element's inline `style`. Inline
//      styles override CSS classes, so the user's last size wins. (and again
//      every time `open` turns true — §338)
//
//   2. Watches for `pointerdown` in the bottom-right ~CORNER_PX square of the
//      element — that's where the native CSS resize handle sits — and treats
//      that as the start of a drag. On the matching `pointerup` (anywhere),
//      it reads the resulting `getBoundingClientRect()` and persists the new
//      size — but only when a dimension this key owns CHANGED since the
//      pointerdown. A click on the corner with no drag saves nothing, so it
//      cannot pin a content-sized element to the height it had that moment.
//      This deliberately ignores natural reflows (window resize, parent flex
//      changes), so only an explicit drag mutates the saved size.
//      ★ Near-exact, not exact: a reflow DURING a corner press still saves; a
//      drag that ends at its starting size saves nothing yet leaves the
//      browser's inline size on the element for the session; a saved size
//      larger than the CSS clamp, dragged back to the clamped size, is not
//      overwritten (reset clears it); and `pointercancel` is not handled, so a
//      cancelled drag stays armed until the next `pointerup`.
//
//   3. Returns a `reset()` callback that clears inline `width`/`height`
//      (letting the class-based defaults take over again) and removes the
//      saved entry from localStorage.
//
// The hook never sets size via React state, so React re-renders don't fight
// the live drag. Attach the returned `ref` to the resizable element.

import { useCallback, useEffect, useRef } from "react";

/** Size of the corner region (px) we treat as the resize handle. */
const CORNER_PX = 20;

type SavedSize = {
  width: number | null;
  height: number | null;
};

/** Which dimensions this key owns.
 *
 *  ★ `"x"` is for an element whose CSS is `resize-x`. A `"both"` key saves
 *  BOTH dimensions once either changed — harmless for a dimension the drag can
 *  change, and wrong for one it cannot: on an x-only element the recorded height
 *  is whatever the parent flex row had stretched the element to at that instant,
 *  and replaying it later pins the element to a stale height its container has
 *  since outgrown. `"x"` owns the width alone: it neither saves nor restores a
 *  height (a stale entry written before the caller opted in is ignored), and a
 *  height-only change is not a drag. The change check in step 2 does not make
 *  it redundant: a real width drag on an x-only element would still record the
 *  stretched height.
 *
 *  Default `"both"`. */
export type ResizableAxis = "both" | "x";

export interface ResizableOptions {
  axis?: ResizableAxis;
  /** §338 — false while the caller renders NOTHING (a modal that stays mounted
   *  while closed). The attach/restore effect re-runs on every false→true
   *  change, mirroring `useDraggable`'s open transition; without it the
   *  effect's only run found no element and bailed, so no size was ever
   *  restored or saved. Default `true` — an always-rendered caller is
   *  unchanged. */
  open?: boolean;
}

export function useResizable(storageKey: string, options?: ResizableOptions) {
  const axis: ResizableAxis = options?.axis ?? "both";
  const open = options?.open ?? true;
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!open || !el) return;

    // Restore saved size.
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SavedSize> | null;
        if (parsed && typeof parsed === "object") {
          if (typeof parsed.width === "number" && parsed.width > 0) {
            el.style.width = `${parsed.width}px`;
          }
          if (axis === "both" && typeof parsed.height === "number" && parsed.height > 0) {
            el.style.height = `${parsed.height}px`;
          }
        }
      }
    } catch {
      // Unparseable — ignore.
    }

    let dragging = false;
    // The size at pointerdown: pointerup saves only when it changed.
    let start = { width: 0, height: 0 };

    function onPointerDown(e: PointerEvent) {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (
        e.clientX >= rect.right - CORNER_PX &&
        e.clientX <= rect.right &&
        e.clientY >= rect.bottom - CORNER_PX &&
        e.clientY <= rect.bottom
      ) {
        dragging = true;
        start = { width: Math.round(rect.width), height: Math.round(rect.height) };
      }
    }

    function onPointerUp() {
      if (!dragging || !el) return;
      dragging = false;
      const rect = el.getBoundingClientRect();
      const size: SavedSize = {
        width: Math.round(rect.width),
        height: axis === "both" ? Math.round(rect.height) : null,
      };
      if (size.width === start.width && (size.height === null || size.height === start.height)) return;
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(size));
      } catch {
        // Storage may be unavailable — drop silently.
      }
    }

    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [storageKey, axis, open]);

  const reset = useCallback(() => {
    const el = ref.current;
    if (el) {
      el.style.width = "";
      el.style.height = "";
    }
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Same as save — non-fatal.
    }
  }, [storageKey]);

  return { ref, reset };
}
