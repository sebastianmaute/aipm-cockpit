// §742 review round — a task bar's handle reached with Tab under the sticky name column is scrolled into the
// uncovered window, as a milestone handle is (WCAG 2.4.11); one focused by a pointer press is not. jsdom has no
// layout, so the scroller's and the handle's geometry is set by hand.
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import type React from "react";
import { useGanttMilestoneFocus } from "./use-gantt-milestone-focus";

const NAME_COL = 240;

function setup() {
  const scroller = document.createElement("div");
  const handle = document.createElement("div");
  handle.setAttribute("data-gantt-bar-handle", "7");
  handle.tabIndex = 0;
  scroller.appendChild(handle);
  document.body.appendChild(scroller);
  Object.defineProperty(scroller, "clientWidth", { value: 800 });
  Object.defineProperty(scroller, "clientHeight", { value: 600 });
  scroller.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) });
  // 100px from the scroller's left edge: under the 240px sticky name column.
  handle.getBoundingClientRect = () => ({ left: 100, top: 200, right: 106, bottom: 220, width: 6, height: 20, x: 100, y: 200, toJSON: () => ({}) });
  scroller.scrollLeft = 500;
  const scrollRef = { current: scroller } as React.RefObject<HTMLElement | null>;
  const footerRef = { current: null } as React.RefObject<HTMLElement | null>;
  const { result, rerender } = renderHook(
    ({ barKeyMove }: { barKeyMove: string | null }) => useGanttMilestoneFocus({ scrollRef, footerRef, nameColWidth: NAME_COL, milestoneDrag: null, barKeyMove }),
    { initialProps: { barKeyMove: null as string | null } },
  );
  const focus = () => result.current.onFocus({ target: handle } as unknown as React.FocusEvent<HTMLElement>);
  return { scroller, handle, focus, rerender };
}

describe("useGanttMilestoneFocus — task bar handles (§742)", () => {
  it("scrolls a Tab-focused bar handle out from under the sticky name column", () => {
    const { scroller, focus } = setup();
    focus();
    // The handle's content offset is 600 (100 + 500 scrolled); the uncovered window starts NAME_COL in.
    expect(scroller.scrollLeft).toBe(600 - NAME_COL);
  });

  it("keeps the focused handle in view after each key press of a pending keyboard edit", () => {
    const { scroller, handle, rerender } = setup();
    handle.focus();
    rerender({ barKeyMove: "7:move:1" });
    expect(scroller.scrollLeft).toBe(600 - NAME_COL);
  });

  it("does nothing on a pending edit when the focused element is not a bar handle", () => {
    const { scroller, rerender } = setup();
    (document.activeElement as HTMLElement | null)?.blur();
    rerender({ barKeyMove: "7:move:1" });
    expect(scroller.scrollLeft).toBe(500);
  });

  it("leaves the chart where it is when a pointer press caused the focus", () => {
    const { scroller, focus } = setup();
    window.dispatchEvent(new Event("pointerdown"));
    focus();
    expect(scroller.scrollLeft).toBe(500);
  });
});
