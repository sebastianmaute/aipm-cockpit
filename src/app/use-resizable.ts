// useResizable — give any DOM container a persistent, user-resizable size.
//
// Pattern: the element should carry `resize: both; overflow: auto` (i.e. Tailwind
// `resize overflow-auto`) plus class-based default `width`/`height` and reasonable
// min/max bounds. This hook then:
//
//   1. On mount, reads a saved `{ width, height }` from localStorage at
//      `storageKey` and writes them to the element's inline `style`. Inline
//      styles override CSS classes, so the user's last size wins.
//
//   2. Watches for `pointerdown` in the bottom-right ~CORNER_PX square of the
//      element — that's where the native CSS resize handle sits — and treats
//      that as the start of a drag. On the matching `pointerup` (anywhere),
//      it reads the resulting `getBoundingClientRect()` and persists the new
//      size. This deliberately ignores natural reflows (window resize, parent
//      flex changes), so only an explicit drag mutates the saved size.
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
 *  ★ `"x"` is for an element whose CSS is `resize-x`. Step 2 above arms on any
 *  pointerdown in the corner square and saves on the matching pointerup with no
 *  check that anything MOVED — which is harmless for a dimension the drag can
 *  change, and wrong for one it cannot: on an x-only element the recorded height
 *  is whatever the parent flex row had stretched the element to at that instant,
 *  and replaying it later pins the element to a stale height its container has
 *  since outgrown. `"x"` neither saves nor restores a height, so a stale entry
 *  written before the caller opted in is ignored too.
 *
 *  Default `"both"` — every existing call site keeps byte-identical behaviour,
 *  which is why this is a per-key option rather than a fix inside the drag
 *  bookkeeping. */
export type ResizableAxis = "both" | "x";

export interface ResizableOptions {
  axis?: ResizableAxis;
}

export function useResizable(storageKey: string, options?: ResizableOptions) {
  const axis: ResizableAxis = options?.axis ?? "both";
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

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
  }, [storageKey, axis]);

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
