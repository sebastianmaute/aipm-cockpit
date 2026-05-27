import { describe, expect, test } from "vitest";
import { clampOffset } from "./use-draggable";

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

  test("clamps upward drag so the header stays below the top edge", () => {
    const out = clampOffset({ x: 0, y: -10000 }, rect, vp);
    expect(rect.top + out.y).toBeGreaterThanOrEqual(0);
  });

  test("clamps downward drag so the header stays above the bottom edge", () => {
    const out = clampOffset({ x: 0, y: 10000 }, rect, vp);
    expect(rect.top + out.y).toBeLessThanOrEqual(vp.h - 24);
  });
});
