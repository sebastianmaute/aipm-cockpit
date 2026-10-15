import { describe, it, expect } from "vitest";
import { labelBox, placeLabels, polylineSegments, segmentHitsBox, type LabelRequest } from "./chart-label-placement";

const BOUNDS = { left: 0, top: 0, right: 200, bottom: 100 };

describe("labelBox", () => {
  it("spans the text's width on the anchor's side and the 8px text's height around the baseline", () => {
    expect(labelBox({ x: 50, baseline: 40 }, 30, "start")).toEqual({ left: 49, top: 32, right: 81, bottom: 43 });
    expect(labelBox({ x: 50, baseline: 40 }, 30, "end")).toEqual({ left: 19, top: 32, right: 51, bottom: 43 });
  });
});

describe("segmentHitsBox", () => {
  const box = { left: 10, top: 10, right: 20, bottom: 20 };
  it("is true for a segment crossing the box, ending inside it, or lying inside it", () => {
    expect(segmentHitsBox({ x1: 0, y1: 15, x2: 30, y2: 15 }, box)).toBe(true);
    expect(segmentHitsBox({ x1: 0, y1: 0, x2: 15, y2: 15 }, box)).toBe(true);
    expect(segmentHitsBox({ x1: 12, y1: 12, x2: 18, y2: 18 }, box)).toBe(true);
    expect(segmentHitsBox({ x1: 15, y1: 0, x2: 15, y2: 30 }, box)).toBe(true);
  });
  it("is false for a segment that passes beside the box or stops short of it", () => {
    expect(segmentHitsBox({ x1: 0, y1: 25, x2: 30, y2: 25 }, box)).toBe(false);
    expect(segmentHitsBox({ x1: 0, y1: 0, x2: 8, y2: 30 }, box)).toBe(false);
    expect(segmentHitsBox({ x1: 0, y1: 0, x2: 30, y2: 5 }, box)).toBe(false);
  });
});

describe("polylineSegments", () => {
  it("returns one segment per consecutive pair, and none for a single point", () => {
    expect(polylineSegments([{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }])).toEqual([
      { x1: 0, y1: 0, x2: 10, y2: 5 }, { x1: 10, y1: 5, x2: 20, y2: 0 },
    ]);
    expect(polylineSegments([{ x: 1, y: 1 }])).toEqual([]);
  });
});

describe("placeLabels", () => {
  const request = (over: Partial<LabelRequest> = {}): LabelRequest => ({
    width: 30, anchor: "end",
    near: [{ x: 100, baseline: 50 }],
    far: [{ x: 100, baseline: 38 }, { x: 100, baseline: 62 }],
    point: { x: 107, y: 57 },
    ...over,
  });

  it("keeps a clear label where it is, with no leader", () => {
    const [placed] = placeLabels([request()], [], BOUNDS);
    expect(placed).toMatchObject({ x: 100, baseline: 50, leader: null });
  });

  it("moves a label that a line crosses to the first clear spot and ties it back to its point with a leader", () => {
    const line = { x1: 0, y1: 46, x2: 200, y2: 46 }; // through the near spot's box (42..53)
    const [placed] = placeLabels([request()], [line], BOUNDS);
    expect(placed.baseline).toBe(38); // 30..41: clear of y=46
    expect(placed.leader).not.toBeNull();
    // From the point to the nearest edge of the label's box.
    expect(placed.leader).toEqual({ x1: 107, y1: 57, x2: 101, y2: 41 });
  });

  it("treats an earlier label as an obstacle for a later one", () => {
    const first = request({ far: [] });
    const second = request({ point: { x: 107, y: 58 } });
    const [a, b] = placeLabels([first, second], [], BOUNDS);
    expect(a.baseline).toBe(50);
    expect(b.baseline).toBe(38);
    expect(b.leader).not.toBeNull();
  });

  it("skips a spot that would leave the plot", () => {
    const req = request({ near: [{ x: 100, baseline: 4 }], far: [{ x: 100, baseline: 30 }] }); // near box top is -4
    const [placed] = placeLabels([req], [], BOUNDS);
    expect(placed.baseline).toBe(30);
  });

  it("tries every near spot before any far one, and draws no leader for a near spot", () => {
    const line = { x1: 0, y1: 46, x2: 200, y2: 46 };
    const req = request({ near: [{ x: 100, baseline: 50 }, { x: 100, baseline: 70 }] });
    const [placed] = placeLabels([req], [line], BOUNDS);
    expect(placed).toMatchObject({ baseline: 70, leader: null });
  });

  it("falls back to the spot crossing the fewest lines, the earliest on a tie, when none is clear", () => {
    const lines = [
      { x1: 0, y1: 46, x2: 200, y2: 46 }, { x1: 0, y1: 48, x2: 200, y2: 48 }, // two through the near spot
      { x1: 0, y1: 35, x2: 200, y2: 35 }, // one through the first far spot
      { x1: 0, y1: 58, x2: 200, y2: 58 }, // one through the second far spot
    ];
    const [placed] = placeLabels([request()], lines, BOUNDS);
    expect(placed.baseline).toBe(38);
  });

  it("draws no leader when the label has no point to tie back to", () => {
    const line = { x1: 0, y1: 46, x2: 200, y2: 46 };
    const [placed] = placeLabels([request({ point: null })], [line], BOUNDS);
    expect(placed).toMatchObject({ baseline: 38, leader: null });
  });
});
