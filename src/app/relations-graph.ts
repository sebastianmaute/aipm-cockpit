// Pure, i18n-free layout engine for the Help relations map (SP3).
// Concepts become nodes on a deterministic radial layout; their mutual
// `relatedConcepts` references become deduped undirected edges. No DOM, no
// Date/Math.random — output is a pure function of the input entries.
import type { HelpEntry } from "./help-content";
import type { TranslationKey } from "./i18n";

export interface GraphNode {
  id: string;
  titleKey: TranslationKey;
  x: number; // ∈ [0,1]
  y: number; // ∈ [0,1]
}
export interface GraphEdge {
  a: string; // sorted: a < b
  b: string;
}
export interface RelationsGraph {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
}

/** Radius of the node circle within the unit box (leaves margin for the
 *  button chrome that overlays each node). */
const RADIUS = 0.42;

export function buildRelationsGraph(entries: readonly HelpEntry[]): RelationsGraph {
  const concepts = entries.filter((e) => e.group === "concepts");
  const ids = new Set(concepts.map((c) => c.id));
  const n = concepts.length;

  const nodes: GraphNode[] = concepts.map((c, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return {
      id: c.id,
      titleKey: c.titleKey,
      x: 0.5 + RADIUS * Math.cos(angle),
      y: 0.5 + RADIUS * Math.sin(angle),
    };
  });

  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const c of concepts) {
    for (const rid of c.relatedConcepts ?? []) {
      if (rid === c.id || !ids.has(rid)) continue;
      const [a, b] = c.id < rid ? [c.id, rid] : [rid, c.id];
      const key = `${a}|${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a, b });
    }
  }

  return { nodes, edges };
}
