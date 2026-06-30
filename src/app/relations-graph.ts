// Pure, i18n-free layout for the Help relations map. Concepts become grid nodes;
// their mutual `relatedConcepts` references become deduped undirected edges.
// i18n-free: carries `titleKey`, not a translated label (the wrapper translates).
import type { HelpEntry } from "./help-content";
import type { TranslationKey } from "./i18n";
import { gridLayout, type ViewBox } from "./node-graph-layout";

export interface RelationsNode {
  id: string;
  titleKey: TranslationKey;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface RelationsEdge {
  a: string; // sorted: a < b
  b: string;
}
export interface RelationsGraph {
  nodes: readonly RelationsNode[];
  edges: readonly RelationsEdge[];
  viewBox: ViewBox;
}

export function buildRelationsGraph(entries: readonly HelpEntry[]): RelationsGraph {
  const concepts = entries.filter((e) => e.group === "concepts");
  const ids = new Set(concepts.map((c) => c.id));

  // Wider nodes than the default so the longest concept titles fit without
  // the component's compress-to-fit kicking in (EN "Budget & earned value",
  // DE "Ressourcen-Kapazitaet" are ~21 chars).
  const { nodes, viewBox } = gridLayout(
    concepts.map((c) => ({ id: c.id, titleKey: c.titleKey })),
    { nodeW: 160 },
  );

  const seen = new Set<string>();
  const edges: RelationsEdge[] = [];
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

  return { nodes, edges, viewBox };
}
