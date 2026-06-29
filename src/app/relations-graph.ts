// Pure, i18n-free layout engine for the Help relations map (SP3).
// Concepts become nodes in a deterministic vertical column; their mutual
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

export function buildRelationsGraph(entries: readonly HelpEntry[]): RelationsGraph {
  const concepts = entries.filter((e) => e.group === "concepts");
  const ids = new Set(concepts.map((c) => c.id));
  const n = concepts.length;

  // Vertical single-column layout: concepts stacked top→bottom at a fixed x.
  // Margins keep the first/last node clear of the container edges.
  const TOP = 0.08;
  const BOTTOM = 0.92;
  const COLUMN_X = 0.5;

  const nodes: GraphNode[] = concepts.map((c, i) => ({
    id: c.id,
    titleKey: c.titleKey,
    x: COLUMN_X,
    y: n <= 1 ? 0.5 : TOP + ((BOTTOM - TOP) * i) / (n - 1),
  }));

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
