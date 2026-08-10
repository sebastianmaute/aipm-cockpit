import { describe, it, expect, vi, afterEach } from "vitest";
import { useRef } from "react";
import { render, act } from "@testing-library/react";
import { AUTOSCROLL_ZONE_PX, autoscrollDelta, useDragAutoscroll } from "./use-drag-autoscroll";

// ★★ Native HTML5 DnD gives no pointer events, so a drag can only be steered by
// `dragover` — and the browser's own edge auto-scroll effectively only serves
// the DOCUMENT scroller. Every scroller in this app is a nested div under a
// `h-screen overflow-hidden` shell, so nothing scrolls during a drag unless we
// do it. That is why this exists at all; see `reports.tsx`.

describe("autoscrollDelta", () => {
  // Container occupying y 100..500 (400px tall), zone 48px.
  const TOP = 100, BOTTOM = 500;
  const d = (y: number) => autoscrollDelta(y, TOP, BOTTOM);

  it("is zero in the middle, where the user is not asking to scroll", () => {
    expect(d(300)).toBe(0);
  });

  it("scrolls UP (negative) near the top edge and DOWN (positive) near the bottom", () => {
    expect(d(TOP + 10)).toBeLessThan(0);
    expect(d(BOTTOM - 10)).toBeGreaterThan(0);
  });

  // ★ A flat speed makes the list bolt away the instant you enter the zone. The
  // ramp is what makes it steerable: deeper into the zone is faster.
  it("ramps with depth into the zone", () => {
    expect(Math.abs(d(TOP + 4))).toBeGreaterThan(Math.abs(d(TOP + 40)));
    expect(d(BOTTOM - 4)).toBeGreaterThan(d(BOTTOM - 40));
  });

  it("is zero exactly at the zone boundary, so the ramp starts from rest", () => {
    expect(d(TOP + AUTOSCROLL_ZONE_PX)).toBe(0);
    expect(d(BOTTOM - AUTOSCROLL_ZONE_PX)).toBe(0);
  });

  it("is zero for a pointer outside the container", () => {
    expect(d(TOP - 1)).toBe(0);
    expect(d(BOTTOM + 1)).toBe(0);
  });

  // ★★ Without this the two zones OVERLAP on a short container and the pointer
  // satisfies both tests at once — the top branch wins and a drag near the
  // BOTTOM of a short list scrolls the wrong way. Clamping the zone to a third
  // of the height keeps them disjoint at every size.
  it("keeps the two zones disjoint on a container shorter than two zones", () => {
    const shortTop = 0, shortBottom = 60; // 60px tall, zone would be 48
    expect(autoscrollDelta(55, shortTop, shortBottom)).toBeGreaterThan(0);
    expect(autoscrollDelta(5, shortTop, shortBottom)).toBeLessThan(0);
  });

  it("returns zero for a zero-height container instead of dividing by it", () => {
    expect(autoscrollDelta(0, 200, 200)).toBe(0);
  });
});

describe("useDragAutoscroll", () => {
  const RECT = { top: 100, bottom: 500, left: 0, right: 300, width: 300, height: 400, x: 0, y: 100 } as DOMRect;

  function Harness({ active }: { active: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    useDragAutoscroll(ref, active);
    return <div ref={ref} data-testid="scroller" />;
  }

  afterEach(() => { vi.restoreAllMocks(); });

  // ★★★ `fireEvent.dragOver(el, { clientY })` SILENTLY DROPS THE COORDINATE in
  // jsdom — measured, not assumed: a listener reading `e.clientY` off it gets
  // `undefined`. A hook driven by cursor position then looks broken in tests
  // while working in the browser, where `DragEvent extends MouseEvent` and the
  // coordinate is always there. Dispatching a real `MouseEvent` named
  // "dragover" is the faithful stand-in: same interface the hook reads, same
  // event type it listens for.
  const dragOverAt = (el: HTMLElement, clientY: number) =>
    el.dispatchEvent(new MouseEvent("dragover", { clientY, bubbles: true }));
  const dragLeave = (el: HTMLElement) =>
    el.dispatchEvent(new MouseEvent("dragleave", { bubbles: true }));

  /** Drive exactly ONE animation frame: jsdom's rAF is real, so a test that
   *  waited for it would be a timing race. */
  function oneFrame(): () => void {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frames.push(cb);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    return () => act(() => { frames.shift()?.(performance.now()); });
  }

  it("scrolls the container while the pointer sits in the bottom zone", () => {
    const tick = oneFrame();
    const { getByTestId } = render(<Harness active />);
    const el = getByTestId("scroller");
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue(RECT);
    dragOverAt(el, 495);
    tick();
    expect(el.scrollTop).toBeGreaterThan(0);
  });

  it("does nothing while no drag is in flight", () => {
    const tick = oneFrame();
    const { getByTestId } = render(<Harness active={false} />);
    const el = getByTestId("scroller");
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue(RECT);
    dragOverAt(el, 495);
    tick();
    expect(el.scrollTop).toBe(0);
  });

  // ★ A stale pointer keeps the list scrolling after the cursor has left, which
  // reads as a runaway panel.
  it("stops when the pointer leaves the container", () => {
    const tick = oneFrame();
    const { getByTestId } = render(<Harness active />);
    const el = getByTestId("scroller");
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue(RECT);
    dragOverAt(el, 495);
    tick();
    const afterOne = el.scrollTop;
    dragLeave(el);
    tick();
    expect(el.scrollTop).toBe(afterOne);
  });
});
