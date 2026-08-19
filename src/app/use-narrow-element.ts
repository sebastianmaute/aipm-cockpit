"use client";
import { useEffect, useState } from "react";

/**
 * Is the element this ref is attached to at or below `maxWidthPx` wide?
 *
 * ★★★ MEASURES THE ELEMENT, NOT THE VIEWPORT — which is the whole reason it
 *  exists. The Documents pane is user-resizable and has a popout path, so a
 *  desktop user reaches a narrow pane by DRAGGING, and a viewport media query
 *  (`use-media-query.ts`, still correct for its own consumers) cannot see that
 *  at all: it fired on device width, so dragging the pane narrow on a wide
 *  screen changed nothing and a phone-width viewport collapsed a full-width
 *  pane. The docstring on `document-editor.tsx` claimed pane width for a
 *  viewport query for the whole of the S3b slice.
 *
 * ★★★ THIS IS THE REPO'S FIRST ResizeObserver. `dashboard-grid.tsx` mentions
 *  one only to say it deliberately has none (its responsive clamp is pure
 *  Tailwind), so there is no in-repo shape to copy and both guards below had
 *  to be reasoned rather than inherited:
 *
 *  1. FEATURE GUARD. jsdom provides no `ResizeObserver` and `vitest.setup.ts`
 *     installs no polyfill, so an unguarded `new ResizeObserver(...)` throws in
 *     EVERY test that renders the consuming panel. Degrading to `false` (wide)
 *     is the safe default: the per-block layout works at any width, the docked
 *     one is the accommodation.
 *  2. ZERO-WIDTH GUARD. An unmeasured, hidden or detached element reports 0.
 *     Treating that as "<= maxWidthPx" would collapse the editor at mount,
 *     before any real measurement, and again whenever the pane is hidden.
 *
 * ★ The ref is a CALLBACK ref stored in STATE, not a `useRef`. The effect has
 *  to re-subscribe when the node changes, and a ref object's mutation does not
 *  re-run an effect — `react-hooks/refs` also bans reading one during render,
 *  so there would be no legal way to depend on it.
 *
 * ★ `setNarrow` is called from the OBSERVER CALLBACK, not from the effect
 *  body, so `react-hooks/set-state-in-effect` (fatal in CI) does not apply. If
 *  it ever flags this, the fix is to keep the call in the callback, never to
 *  disable the rule.
 */
export function useNarrowElement(maxWidthPx: number) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setNarrow(width > 0 && width <= maxWidthPx);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, maxWidthPx]);

  return { ref: setNode, narrow };
}
