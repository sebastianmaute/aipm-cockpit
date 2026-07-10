import { describe, expect, it } from "vitest";
import { clampToViewport, loadGeom, serializeGeom, type ModalGeom } from "./modal-geometry";

const VP = { width: 1000, height: 800 };
describe("clampToViewport", () => {
  it("keeps a fully-visible geom unchanged", () => {
    const g: ModalGeom = { x: 100, y: 80, w: 400, h: 300 };
    expect(clampToViewport(g, VP)).toEqual(g);
  });
  it("pulls an off-right/off-bottom panel back so it stays on screen", () => {
    const g: ModalGeom = { x: 900, y: 700, w: 400, h: 300 };
    const c = clampToViewport(g, VP);
    expect(c.x).toBeLessThanOrEqual(VP.width - 40);   // header stays grabbable
    expect(c.y).toBeGreaterThanOrEqual(0);
    expect(c.y).toBeLessThanOrEqual(VP.height - 40);
  });
  it("clamps width/height to the viewport", () => {
    const c = clampToViewport({ x: 0, y: 0, w: 5000, h: 5000 }, VP);
    expect(c.w).toBeLessThanOrEqual(VP.width);
    expect(c.h).toBeLessThanOrEqual(VP.height);
  });
});
describe("loadGeom", () => {
  it("returns null for missing/garbage and a valid object otherwise", () => {
    expect(loadGeom(null)).toBeNull();
    expect(loadGeom("not json")).toBeNull();
    expect(loadGeom(serializeGeom({ x: 1, y: 2, w: 300, h: 200 }))).toEqual({ x: 1, y: 2, w: 300, h: 200 });
    expect(loadGeom(JSON.stringify({ x: "a", y: 2, w: 3, h: 4 }))).toBeNull();
  });
});
