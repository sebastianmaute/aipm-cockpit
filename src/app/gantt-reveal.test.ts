import { describe, expect, it } from "vitest";
import { revealInGantt, revealScroll } from "./gantt-reveal";

const axis = { scroll: 400, viewport: 800, insetStart: 300, insetEnd: 0 };

describe("revealScroll", () => {
  it("stays put when the span is inside the uncovered window", () => {
    expect(revealScroll({ ...axis, start: 800, end: 820 })).toBe(400);
  });

  it("scrolls a span hidden under the start inset out from under it", () => {
    // 650 is inside the scrollport (400..1200) but under the 300px name column.
    expect(revealScroll({ ...axis, start: 650, end: 670 })).toBe(350);
  });

  it("scrolls a span past the end into view, honouring the end inset", () => {
    expect(revealScroll({ ...axis, insetEnd: 20, start: 1200, end: 1220 })).toBe(440);
  });

  it("aligns the start of a span longer than the window", () => {
    expect(revealScroll({ ...axis, start: 900, end: 1600 })).toBe(600);
  });

  it("never returns a negative offset", () => {
    expect(revealScroll({ ...axis, start: 100, end: 120 })).toBe(0);
  });
});

describe("revealInGantt", () => {
  function rect(left: number, top: number, width: number, height: number): DOMRect {
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
  }
  function container(scrollLeft: number, scrollTop: number) {
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { value: 800 });
    Object.defineProperty(el, "clientHeight", { value: 400 });
    el.scrollLeft = scrollLeft;
    el.scrollTop = scrollTop;
    el.getBoundingClientRect = () => rect(10, 20, 800, 400);
    return el;
  }
  function target(r: DOMRect) {
    const el = document.createElement("div");
    el.getBoundingClientRect = () => r;
    return el;
  }

  it("moves a handle out from under the sticky name column", () => {
    const c = container(400, 0);
    // Viewport x 110 = 100px into the scrollport, under a 300px name column.
    revealInGantt(c, [target(rect(110, 120, 20, 30))], { left: 300, top: 56, bottom: 22 });
    // Content x = 110 - 10 + 400 = 500; it must start at scroll + 300.
    expect(c.scrollLeft).toBe(200);
    expect(c.scrollTop).toBe(0);
  });

  it("reveals the union of the handle and its preview label", () => {
    const c = container(400, 0);
    const handle = target(rect(400, 120, 20, 30)); // clear of the column
    const label = target(rect(250, 120, 80, 30)); // under it
    revealInGantt(c, [handle, label], { left: 300, top: 56, bottom: 22 });
    expect(c.scrollLeft).toBe(340);
  });

  it("keeps a row clear of the sticky header", () => {
    const c = container(0, 200);
    // Viewport y 40 = 20px into the scrollport, under a 56px header.
    revealInGantt(c, [target(rect(500, 40, 20, 30))], { left: 300, top: 56, bottom: 22 });
    expect(c.scrollTop).toBe(164);
    expect(c.scrollLeft).toBe(0);
  });

  it("keeps a row clear of the sticky footer", () => {
    const c = container(0, 0);
    // Viewport y 395..425 = content 375..405, past a 400px port with a 22px footer.
    revealInGantt(c, [target(rect(500, 395, 20, 30))], { left: 300, top: 56, bottom: 22 });
    expect(c.scrollTop).toBe(405 - 400 + 22);
  });
});
