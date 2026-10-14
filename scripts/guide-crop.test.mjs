import { describe, expect, it } from "vitest";
import { cropClip } from "./guide-crop.mjs";

const view = { width: 1280, height: 800 };
const box = (x, y, width, height) => ({ x, y, width, height });

describe("cropClip (the guide screenshots' crop, §713)", () => {
  it("pads the region from `from`'s top to `to`'s bottom", () => {
    expect(cropClip({ from: box(100, 100, 50, 20), to: box(120, 300, 80, 20), view, pad: 16, padTop: 8 })).toEqual({
      x: 84,
      y: 92,
      width: 216 - 84,
      height: 336 - 92,
    });
  });

  it("takes the width from `across` alone, never its height", () => {
    const clip = cropClip({ from: box(300, 200, 10, 10), to: box(300, 400, 10, 10), across: [box(50, -500, 900, 2000)], view, pad: 0, padTop: 0 });
    expect(clip).toEqual({ x: 50, y: 200, width: 900, height: 210 });
  });

  it("clamps only the padding at the viewport's edges", () => {
    expect(cropClip({ from: box(4, 2, 100, 20), to: box(1180, 790, 100, 10), view, pad: 16, padTop: 8 })).toEqual({
      x: 0,
      y: 0,
      width: 1280,
      height: 800,
    });
  });

  it("throws when the region itself runs off the viewport, rather than cutting it", () => {
    expect(() => cropClip({ from: box(100, -209, 50, 20), to: box(100, 600, 50, 20), view, pad: 16, padTop: 8 })).toThrow(/runs past/);
    expect(() => cropClip({ from: box(100, 100, 50, 20), to: box(100, 790, 50, 20), view, pad: 16, padTop: 8 })).toThrow(/runs past/);
    expect(() => cropClip({ from: box(100, 100, 50, 20), to: box(100, 200, 50, 20), across: [box(0, 0, 1300, 10)], view, pad: 0, padTop: 0 })).toThrow(/runs past/);
  });

  it("allows half a pixel of slack, since bounding boxes are fractional", () => {
    expect(() => cropClip({ from: box(-0.4, 0, 10, 10), to: box(0, 790, 10, 10.4), view, pad: 0, padTop: 0 })).not.toThrow();
  });
});
