import { describe, it, expect } from "vitest";
import { gridLayout } from "./node-graph-layout";

const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];

describe("gridLayout", () => {
  it("keeps every item, preserving id + order", () => {
    const { nodes } = gridLayout(items);
    expect(nodes.map((n) => n.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("derives cols = ceil(sqrt(n)) by default (5 → 3 cols)", () => {
    const { nodes } = gridLayout(items);
    // row 0 = a,b,c ; row 1 = d,e — so a.y === c.y and d.y > a.y
    expect(nodes[2].y).toBe(nodes[0].y);
    expect(nodes[3].y).toBeGreaterThan(nodes[0].y);
    // distinct x within a row
    expect(nodes[0].x).toBeLessThan(nodes[1].x);
  });

  it("honours an explicit cols override", () => {
    const { nodes } = gridLayout(items, { cols: 5 });
    const ys = new Set(nodes.map((n) => n.y));
    expect(ys.size).toBe(1); // one row
  });

  it("positions every node inside the returned viewBox", () => {
    const { nodes, viewBox } = gridLayout(items);
    for (const n of nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w).toBeLessThanOrEqual(viewBox.w);
      expect(n.y + n.h).toBeLessThanOrEqual(viewBox.h);
    }
  });

  it("carries the item payload through", () => {
    const { nodes } = gridLayout([{ id: "x", label: "Hello" }]);
    expect(nodes[0].label).toBe("Hello");
  });

  it("is deterministic", () => {
    expect(gridLayout(items)).toEqual(gridLayout(items));
  });

  it("handles a single item without dividing by zero", () => {
    const { nodes, viewBox } = gridLayout([{ id: "solo" }]);
    expect(nodes).toHaveLength(1);
    expect(viewBox.w).toBeGreaterThan(0);
    expect(viewBox.h).toBeGreaterThan(0);
  });
});
