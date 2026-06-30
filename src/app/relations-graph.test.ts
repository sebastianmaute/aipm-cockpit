import { describe, it, expect } from "vitest";
import { buildRelationsGraph } from "./relations-graph";
import { HELP_ENTRIES } from "./help-content";

describe("buildRelationsGraph", () => {
  const concepts = HELP_ENTRIES.filter((e) => e.group === "concepts");
  const graph = buildRelationsGraph(HELP_ENTRIES);

  it("has one node per concept entry, in order", () => {
    expect(graph.nodes.map((n) => n.id)).toEqual(concepts.map((c) => c.id));
  });

  it("positions every node inside the returned viewBox", () => {
    for (const n of graph.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w).toBeLessThanOrEqual(graph.viewBox.w);
      expect(n.y + n.h).toBeLessThanOrEqual(graph.viewBox.h);
    }
  });

  it("lays nodes in a multi-column grid (more than one distinct x)", () => {
    const xs = new Set(graph.nodes.map((n) => n.x));
    expect(xs.size).toBeGreaterThan(1);
  });

  it("only emits edges between real concept nodes, deduped, sorted a<b, no self-loops", () => {
    const ids = new Set(graph.nodes.map((n) => n.id));
    const seen = new Set<string>();
    for (const e of graph.edges) {
      expect(ids.has(e.a)).toBe(true);
      expect(ids.has(e.b)).toBe(true);
      expect(e.a).not.toBe(e.b);
      expect(e.a < e.b).toBe(true);
      const key = `${e.a}|${e.b}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("includes the milestone↔dependency relation", () => {
    const keys = graph.edges.map((e) => `${e.a}|${e.b}`);
    expect(keys).toContain("concept-dependency|concept-milestone");
  });

  it("is deterministic", () => {
    expect(buildRelationsGraph(HELP_ENTRIES)).toEqual(buildRelationsGraph(HELP_ENTRIES));
  });
});
