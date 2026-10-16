// src/app/use-gantt-milestone-focus.ts — keep a focused Gantt milestone handle
// visible and focused (§715 project D).
//
// Three moments move a focused handle where the user cannot see it:
//   1. arrow presses move its preview along the timeline;
//   2. the keyboard move ENDS — saved, so the diamond lands on the new date and
//      the rows re-sort, or cancelled with Escape, so it jumps back to where it
//      started, which can be a viewport away from where the presses took it;
//   3. Tab lands on a handle sitting under the sticky name column.
// None of them applies to the POINTER: a mouse press focuses the handle too,
// and a scroll then would slide the chart out from under the pointer for the
// whole drag. So a focus that follows a pointer press reveals nothing, and a
// keyboard move that ends because a pointer drag starts reveals nothing.
// "Follows" is a time window, not a flag kept until the next key press: a
// screen reader's browse mode moves focus without any key reaching the page,
// and a flag would leave it stuck on "pointer" after one click.
// Each is answered with `revealInGantt`, which scrolls clear of the sticky name
// column, header and footer (a plain `scrollIntoView` counts a handle under
// them as visible — WCAG 2.4.11).
//
// A fourth moment loses focus outright: another writer signs the milestone off
// while its handle has focus, and an achieved milestone renders no handle. The
// browser drops focus to <body>; this moves it to the row's name button, so
// the user keeps their place in the chart.
import { useEffect, useLayoutEffect, useRef } from "react";
import { HEADER_HEIGHT_PX } from "./gantt-engine";
import { revealInGantt } from "./gantt-reveal";
import type { MilestoneDragState } from "./use-gantt-milestone-drag";

/** A focus this soon after a pointer press is taken to be caused by it. */
export const POINTER_FOCUS_WINDOW_MS = 500;

/** The footer's height when it cannot be measured (jsdom): its `minHeight`. */
export const GANTT_FOOTER_MIN_PX = 22;

const HANDLE_ATTR = "data-gantt-milestone-handle";
const handleSelector = (id: number) => `[${HANDLE_ATTR}="${id}"]`;

/** Scroll milestone `id`'s handle, and its preview date when shown, into the uncovered window. */
function revealHandle(scroller: HTMLElement, id: number, nameColWidth: number, footer: HTMLElement | null) {
  const handle = scroller.querySelector<HTMLElement>(handleSelector(id));
  if (!handle) return;
  const preview = handle.parentElement?.querySelector<HTMLElement>("[data-gantt-milestone-preview]");
  revealInGantt(scroller, preview ? [handle, preview] : [handle], {
    left: nameColWidth,
    top: HEADER_HEIGHT_PX,
    bottom: footer?.offsetHeight || GANTT_FOOTER_MIN_PX,
  });
}

export interface GanttMilestoneFocusOptions {
  scrollRef: React.RefObject<HTMLElement | null>;
  footerRef: React.RefObject<HTMLElement | null>;
  nameColWidth: number;
  milestoneDrag: MilestoneDragState | null;
}

/** Handlers for the scroll container: `onFocus`/`onBlur` bubble up from the handles. */
export interface GanttMilestoneFocus {
  onFocus: (e: React.FocusEvent<HTMLElement>) => void;
  onBlur: (e: React.FocusEvent<HTMLElement>) => void;
}

function handleId(target: EventTarget | null): number | null {
  if (!(target instanceof HTMLElement)) return null;
  const raw = target.getAttribute(HANDLE_ATTR);
  return raw === null ? null : Number(raw);
}

export function useGanttMilestoneFocus({
  scrollRef, footerRef, nameColWidth, milestoneDrag,
}: GanttMilestoneFocusOptions): GanttMilestoneFocus {
  const keyMoveId = milestoneDrag?.mode === "keys" ? milestoneDrag.milestoneId : null;
  const keyMoveDays = milestoneDrag?.mode === "keys" ? milestoneDrag.deltaDays : 0;
  const pointerDragging = milestoneDrag?.mode === "pointer";
  // The milestone whose handle has focus. Set and cleared by focus/blur; NOT
  // cleared when the handle unmounts, because React reports no blur for a
  // removed node — which is exactly what the restore below relies on.
  const focusedRef = useRef<number | null>(null);
  // The keyboard move seen at the last commit, to notice the one that ended.
  const lastKeyMoveRef = useRef<number | null>(null);
  // When the last pointer press happened (`performance.now()`), anywhere:
  // a capture listener on the window sees it before the focus it causes.
  const lastPointerDownRef = useRef(Number.NEGATIVE_INFINITY);
  useEffect(() => {
    const onPointer = () => { lastPointerDownRef.current = performance.now(); };
    window.addEventListener("pointerdown", onPointer, true);
    return () => window.removeEventListener("pointerdown", onPointer, true);
  }, []);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const ended = lastKeyMoveRef.current;
    lastKeyMoveRef.current = keyMoveId;
    if (!scroller) return;
    if (keyMoveId !== null) {
      revealHandle(scroller, keyMoveId, nameColWidth, footerRef.current);
    } else if (ended !== null && focusedRef.current === ended && !pointerDragging) {
      revealHandle(scroller, ended, nameColWidth, footerRef.current);
    }
  }, [keyMoveId, keyMoveDays, pointerDragging, scrollRef, footerRef, nameColWidth]);

  // Every commit: a focused handle that is gone while its row remains (signed
  // off) hands focus to that row's name button. Cheap — one lookup, and only
  // while a handle has focus.
  useLayoutEffect(() => {
    const id = focusedRef.current;
    const scroller = scrollRef.current;
    if (id === null || !scroller || scroller.querySelector(handleSelector(id))) return;
    focusedRef.current = null;
    const active = scroller.ownerDocument.activeElement;
    if (active && active !== scroller.ownerDocument.body) return;
    scroller.querySelector<HTMLElement>(`[data-gantt-row="m-${id}"] button`)?.focus();
  });

  return {
    onFocus: (e) => {
      const id = handleId(e.target);
      if (id === null) return;
      focusedRef.current = id;
      const scroller = scrollRef.current;
      const byPointer = performance.now() - lastPointerDownRef.current < POINTER_FOCUS_WINDOW_MS;
      if (scroller && !byPointer) revealHandle(scroller, id, nameColWidth, footerRef.current);
    },
    onBlur: (e) => {
      if (handleId(e.target) !== null) focusedRef.current = null;
    },
  };
}
