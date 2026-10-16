// src/app/gantt-reveal.ts — scroll a span of the Gantt into the part of the
// scroll container that sticky chrome does not cover (§715 project D).
//
// `scrollIntoView({ inline: "nearest" })` counts an element as visible once it
// is inside the scrollport, but the Gantt's scrollport carries a sticky name
// column on the left, a sticky header on top and a sticky footer at the bottom.
// A milestone handle moved under the name column was "in view" to the browser
// and hidden from the user (WCAG 2.4.11). This computes the offset against the
// uncovered window instead.

/** One axis of the reveal: positions are in content coordinates (scroll included). */
export interface RevealAxis {
  /** Current scroll offset. */
  scroll: number;
  /** Visible length of the scrollport (clientWidth / clientHeight). */
  viewport: number;
  /** Start and end of the span to reveal. */
  start: number;
  end: number;
  /** Length covered by sticky chrome at the start / end of the scrollport. */
  insetStart: number;
  insetEnd: number;
}

/**
 * The scroll offset that brings [start, end] inside the uncovered window,
 * moving as little as possible; the current offset when it already is. A span
 * longer than the window aligns its start. Never negative.
 */
export function revealScroll({ scroll, viewport, start, end, insetStart, insetEnd }: RevealAxis): number {
  const windowStart = scroll + insetStart;
  const windowEnd = scroll + viewport - insetEnd;
  let next = scroll;
  if (start < windowStart || end - start > windowEnd - windowStart) next = start - insetStart;
  else if (end > windowEnd) next = end - viewport + insetEnd;
  return Math.max(0, next);
}

/**
 * Scroll `container` so every element in `targets` sits inside the window the
 * sticky chrome leaves uncovered. Only writes an axis that has to move.
 */
export function revealInGantt(
  container: HTMLElement,
  targets: readonly HTMLElement[],
  insets: { left: number; top: number; bottom: number },
): void {
  if (targets.length === 0) return;
  const box = container.getBoundingClientRect();
  const originX = box.left + container.clientLeft - container.scrollLeft;
  const originY = box.top + container.clientTop - container.scrollTop;
  const rects = targets.map((el) => el.getBoundingClientRect());
  const left = Math.min(...rects.map((r) => r.left)) - originX;
  const right = Math.max(...rects.map((r) => r.right)) - originX;
  const top = Math.min(...rects.map((r) => r.top)) - originY;
  const bottom = Math.max(...rects.map((r) => r.bottom)) - originY;
  const x = revealScroll({
    scroll: container.scrollLeft, viewport: container.clientWidth,
    start: left, end: right, insetStart: insets.left, insetEnd: 0,
  });
  const y = revealScroll({
    scroll: container.scrollTop, viewport: container.clientHeight,
    start: top, end: bottom, insetStart: insets.top, insetEnd: insets.bottom,
  });
  if (x !== container.scrollLeft) container.scrollLeft = x;
  if (y !== container.scrollTop) container.scrollTop = y;
}
