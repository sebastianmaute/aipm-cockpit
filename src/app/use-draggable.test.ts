import { describe, expect, test, beforeEach } from "vitest";
import { renderHook, act, render } from "@testing-library/react";
import { createElement as h } from "react";
import { clampOffset, reconcileOffset, useDraggable } from "./use-draggable";

describe("clampOffset", () => {
  // viewport 1000x800; panel rect at left=300 top=100 w=400 h=500.
  const vp = { w: 1000, h: 800 };
  const rect = { left: 300, top: 100, width: 400, height: 500 };

  test("passes through an offset that keeps the panel on-screen", () => {
    expect(clampOffset({ x: 50, y: 50 }, rect, vp)).toEqual({ x: 50, y: 50 });
  });

  test("clamps leftward drag so the panel's right edge keeps a margin on screen", () => {
    const out = clampOffset({ x: -10000, y: 0 }, rect, vp);
    expect(rect.left + out.x).toBeLessThan(0); // moved left
    expect(rect.left + rect.width + out.x).toBeGreaterThanOrEqual(24); // still grabbable
  });

  test("clamps upward drag so the header stays at least a margin below the top edge", () => {
    const out = clampOffset({ x: 0, y: -10000 }, rect, vp);
    expect(rect.top + out.y).toBeGreaterThanOrEqual(24);
  });

  test("clamps downward drag so the header stays above the bottom edge", () => {
    const out = clampOffset({ x: 0, y: 10000 }, rect, vp);
    expect(rect.top + out.y).toBeLessThanOrEqual(vp.h - 24);
  });
});

describe("reconcileOffset (restored-offset viewport re-clamp)", () => {
  test("returns an on-screen offset unchanged (idempotent no-op)", () => {
    // Panel visible at left=300 top=100 with a +50,+50 offset already applied.
    const panelRect = { left: 300, top: 100, width: 400, height: 500 };
    expect(
      reconcileOffset({ x: 50, y: 50 }, panelRect, { w: 1000, h: 800 }),
    ).toEqual({ x: 50, y: 50 });
  });

  test("pulls a panel stranded off the right edge back into view", () => {
    // Stale offset from a wide screen: panel currently sits at left=1400 in a
    // 1000px-wide viewport (base left = 1400 - 900 = 500).
    const vp = { w: 1000, h: 800 };
    const panelRect = { left: 1400, top: 100, width: 400, height: 500 };
    const out = reconcileOffset({ x: 900, y: 0 }, panelRect, vp);
    const baseLeft = panelRect.left - 900;
    expect(baseLeft + out.x).toBeLessThanOrEqual(vp.w - 24); // right edge reachable
    expect(out.x).toBeLessThan(900); // was clamped inward
  });

  test("pulls a panel stranded below the bottom edge back into view", () => {
    const vp = { w: 1000, h: 800 };
    const panelRect = { left: 300, top: 1200, width: 400, height: 500 };
    const out = reconcileOffset({ x: 0, y: 1100 }, panelRect, vp);
    const baseTop = panelRect.top - 1100;
    expect(baseTop + out.y).toBeLessThanOrEqual(vp.h - 24); // header stays on-screen
    expect(out.y).toBeLessThan(1100);
  });
});

describe("useDraggable persistence (storageKey)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("initializes the offset from a valid persisted value", () => {
    window.localStorage.setItem("k", JSON.stringify({ x: 12, y: 34 }));
    const { result } = renderHook(() => useDraggable(true, "k"));
    expect(result.current.offset).toEqual({ x: 12, y: 34 });
  });

  test("falls back to {0,0} for missing or garbage storage", () => {
    window.localStorage.setItem("bad", "not json");
    const { result } = renderHook(() => useDraggable(true, "bad"));
    expect(result.current.offset).toEqual({ x: 0, y: 0 });
  });

  test("reset recenters and clears the persisted entry", () => {
    window.localStorage.setItem("k", JSON.stringify({ x: 5, y: 5 }));
    const { result } = renderHook(() => useDraggable(true, "k"));
    act(() => result.current.reset());
    expect(result.current.offset).toEqual({ x: 0, y: 0 });
    expect(window.localStorage.getItem("k")).toBeNull();
  });

  test("without a storageKey the offset stays {0,0} and nothing persists", () => {
    const { result } = renderHook(() => useDraggable(true));
    expect(result.current.offset).toEqual({ x: 0, y: 0 });
    act(() => result.current.reset());
    expect(result.current.offset).toEqual({ x: 0, y: 0 });
    expect(window.localStorage.length).toBe(0);
  });
});

describe("useDraggable viewport re-clamp on open (layout path)", () => {
  beforeEach(() => window.localStorage.clear());

  // Mounts a real panel (with the same transform the modals apply) + header
  // handle so the hook's handle ref resolves and the layout effect can measure
  // the panel. jsdom returns a zero rect, so getBoundingClientRect is stubbed to
  // model a fixed BASE position plus the live translate — exactly how a real
  // browser reports a transformed element (this is what makes the clamp a fixed
  // point: base stays constant as the offset changes).
  function Harness({ storageKey }: { storageKey: string }) {
    const { offset, handleProps } = useDraggable(true, storageKey);
    return h(
      "div",
      { "data-modal-panel": "", style: { transform: `translate(${offset.x}px, ${offset.y}px)` } },
      h("header", { ...handleProps }, "h"),
      h("span", { "data-testid": "ox" }, String(offset.x)),
    );
  }

  const BASE = { left: 500, top: 100, width: 400, height: 500 };

  test("pulls a restored off-screen offset back in-memory without clobbering storage", () => {
    const origRect = HTMLElement.prototype.getBoundingClientRect;
    const origW = Object.getOwnPropertyDescriptor(window, "innerWidth");
    try {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
      HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
        if (!this.hasAttribute("data-modal-panel")) {
          return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
        }
        const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(this.style.transform);
        const dx = m ? Number(m[1]) : 0;
        const dy = m ? Number(m[2]) : 0;
        const left = BASE.left + dx;
        const top = BASE.top + dy;
        return { left, top, width: BASE.width, height: BASE.height, right: left + BASE.width, bottom: top + BASE.height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
      };
      // Restored offset +900 puts the panel at left=1400 in a 1000px viewport.
      // maxX = 1000 - 24 - base(500) = 476.
      window.localStorage.setItem("off", JSON.stringify({ x: 900, y: 0 }));
      const { getByTestId } = render(h(Harness, { storageKey: "off" }));
      expect(Number(getByTestId("ox").textContent)).toBe(476);
      // Stored value is left untouched (view-time safety, not a persisted edit).
      expect(JSON.parse(window.localStorage.getItem("off")!)).toEqual({ x: 900, y: 0 });
    } finally {
      HTMLElement.prototype.getBoundingClientRect = origRect;
      if (origW) Object.defineProperty(window, "innerWidth", origW);
    }
  });
});
