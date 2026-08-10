"use client";
import { useEffect, type RefObject } from "react";

/**
 * Edge auto-scroll for a NATIVE HTML5 drag inside a scrollable element.
 *
 * ★★★ WHY THIS HAS TO EXIST. Browsers do auto-scroll during a drag, but that
 * serves the DOCUMENT scroller, and the app's two main-window layouts have
 * none: `modern-shell.tsx`'s root is `flex h-screen w-full overflow-hidden`,
 * and the classic root is an `h-screen` flex column whose `<main>` owns the
 * scroll. Every pane therefore scrolls in a nested div (for reports,
 * `report-table.tsx`'s `min-h-0 flex-1 overflow-y-auto` inside `ReportCard`), so
 * a drag could not reach a drop target below the fold: the list stayed put and
 * the card had nowhere to go.
 * ★★ POPOUT WINDOWS ARE THE EXCEPTION and are not a bug — `task-manager.tsx`
 * gives them the plain document-scrolling flow deliberately, so the browser's
 * own auto-scroll works there and this hook is a harmless no-op. `"reports"` is
 * in `REPORT_POPOUT_TABS`, so the very surface this was written for has both
 * behaviours depending on the window it is in.
 * ★ Reported against Reports; other native-DnD surfaces here are unwired. Do
 * not trust a list in a comment for which — enumerate them with
 * `grep -rn "draggable" src/app --include=*.tsx | grep -v '\.test\.'`.
 *
 * ★★ Native DnD emits no `mousemove`/`pointermove` while a drag is in flight.
 * The cursor signals it DOES emit are all `DragEvent`s, which extend
 * `MouseEvent` and so carry `clientY`: `drag` at the SOURCE node, and
 * `dragenter`/`dragover`/`dragleave` at the target. `dragover` is chosen over
 * `drag` because it fires on the element under the cursor and bubbles to the
 * scroller, so the source does not have to stay mounted. The position is
 * captured there and consumed by a separate rAF loop: scrolling directly inside
 * the handler would tie speed to the event rate, which the browser throttles
 * and which the spec only guarantees to re-fire every 350ms when the cursor
 * holds still — the one moment the user most wants smooth scrolling.
 */

/** Depth of the hot zone at each edge, in px. */
export const AUTOSCROLL_ZONE_PX = 48;
/** Speed at the very edge, in px per animation frame (~14px @60fps ≈ 840px/s). */
export const AUTOSCROLL_MAX_PX_PER_FRAME = 14;

/**
 * Scroll delta for one frame: negative scrolls up, positive down, `0` idles.
 * Pure — the geometry is passed in, so this is testable without layout.
 */
export function autoscrollDelta(
  pointerY: number,
  top: number,
  bottom: number,
  zonePx: number = AUTOSCROLL_ZONE_PX,
  maxPx: number = AUTOSCROLL_MAX_PX_PER_FRAME,
): number {
  const height = bottom - top;
  if (height <= 0) return 0;
  // ★★ Clamp the zone to a third of the height. At the full 48px the two zones
  // OVERLAP on anything shorter than 96px, the pointer satisfies both tests at
  // once, and whichever branch is written first wins — so a drag near the bottom
  // of a short list scrolls UP. A third keeps them disjoint at every size.
  const zone = Math.min(zonePx, height / 3);
  const fromTop = pointerY - top;
  const fromBottom = bottom - pointerY;
  if (fromTop < 0 || fromBottom < 0) return 0; // pointer outside the container
  if (fromTop < zone) return -Math.ceil(((zone - fromTop) / zone) * maxPx);
  if (fromBottom < zone) return Math.ceil(((zone - fromBottom) / zone) * maxPx);
  return 0;
}

/**
 * While `active`, scroll `ref`'s element whenever the drag cursor sits near its
 * top or bottom edge. No-op when inactive, so the rAF loop only runs during a
 * real drag.
 */
export function useDragAutoscroll(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    // ★★ `el` is captured for the LISTENERS only. The frame loop re-reads
    // `ref.current` instead, because a ref object is permanently stable and is
    // therefore inert as a dependency: if the scroller is swapped while a drag
    // is in flight, an effect keyed on `[ref, active]` never re-runs and a
    // captured element would go on being scrolled after it left the document —
    // silently, with no signal. Cheap enough to re-read every frame.
    let pointerY: number | null = null;
    let frame = 0;
    // `dragover` also fires on descendants and bubbles up to here, which is what
    // we want: the cursor is over a report card, not the scroller's own padding.
    const onDragOver = (e: DragEvent) => { pointerY = e.clientY; };
    // ★ Clearing on leave matters — a retained pointerY keeps the list scrolling
    // after the cursor has gone, which reads as a runaway panel.
    // ★★ Guarded on `relatedTarget`, because `dragleave` also fires every time
    // the cursor crosses from one CHILD to the next inside the scroller. An
    // unguarded clear therefore drops the position on every card boundary and
    // the scroll stutters as the next `dragover` restores it.
    const onDragLeave = (e: DragEvent) => {
      const to = e.relatedTarget as Node | null;
      if (to && el.contains(to)) return;
      pointerY = null;
    };
    const tick = () => {
      const live = ref.current;
      if (live && pointerY !== null) {
        const r = live.getBoundingClientRect();
        const delta = autoscrollDelta(pointerY, r.top, r.bottom);
        if (delta !== 0) live.scrollTop += delta;
      }
      frame = window.requestAnimationFrame(tick);
    };
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    frame = window.requestAnimationFrame(tick);
    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      window.cancelAnimationFrame(frame);
    };
  }, [ref, active]);
}
