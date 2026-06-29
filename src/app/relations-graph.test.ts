import { describe, it, expect } from "vitest";
import { buildRelationsGraph } from "./relations-graph";
import { HELP_ENTRIES } from "./help-content";

describe("buildRelationsGraph", () => {
  const concepts = HELP_ENTRIES.filter((e) => e.group === "concepts");
  const graph = buildRelationsGraph(HELP_ENTRIES);

  it("has one node per concept entry, in order", () => {
    expect(graph.nodes.map((n) => n.id)).toEqual(concepts.map((c) => c.id));
  });

  it("places every node inside the unit box", () => {
    for (const n of graph.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(1);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(1);
    }
  });

  it("only emits edges between real concept nodes, deduped, no self-loops", () => {
    const ids = new Set(graph.nodes.map((n) => n.id));
    const seen = new Set<string>();
    for (const e of graph.edges) {
      expect(ids.has(e.a)).toBe(true);
      expect(ids.has(e.b)).toBe(true);
      expect(e.a).not.toBe(e.b);
      expect(e.a < e.b).toBe(true); // sorted key
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

describe("buildRelationsGraph vertical layout", () => {
  it("lays concept nodes in a single vertical column (shared x, increasing y)", () => {
    const g = buildRelationsGraph(HELP_ENTRIES);
    expect(g.nodes.length).toBeGreaterThan(1);
    const xs = new Set(g.nodes.map((n) => Number(n.x.toFixed(4))));
    expect(xs.size).toBe(1); // one column
    const ys = g.nodes.map((n) => n.y);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
    for (const n of g.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(1);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(1);
    }
  });

  it("keeps edges deduped + undirected (sorted a<b), no self-loops", () => {
    const g = buildRelationsGraph(HELP_ENTRIES);
    const keys = g.edges.map((e) => `${e.a}|${e.b}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of g.edges) {
      expect(e.a < e.b).toBe(true);
      expect(e.a).not.toBe(e.b);
    }
  });
});
