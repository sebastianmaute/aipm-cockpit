"use client";

import { type Lang, t } from "./i18n";
import type { RelationsGraph } from "./relations-graph";
import { NodeGraph } from "./node-graph";
import type { NodeGraphNode, NodeGraphEdge } from "./node-graph-layout";

interface RelationsMapProps {
  graph: RelationsGraph;
  lang: Lang;
  onSelectConcept: (id: string) => void;
}

/** Interactive concept relations map (SP3). Renders the reusable NodeGraph in
 *  interactive mode: a transparent button overlay over a decorative diagram.
 *  Hover/focus highlights incident edges + neighbours; click jumps to the
 *  concept. Presentational — no context, no persistence. */
export function RelationsMap({ graph, lang, onSelectConcept }: RelationsMapProps) {
  const nodes: NodeGraphNode[] = graph.nodes.map((n) => ({
    id: n.id,
    label: t(lang, n.titleKey),
    accent: "blue",
    x: n.x,
    y: n.y,
    w: n.w,
    h: n.h,
  }));
  const edges: NodeGraphEdge[] = graph.edges.map((e) => ({ a: e.a, b: e.b }));

  return (
    <div className="rounded-md border border-line bg-surface-muted p-3">
      <NodeGraph
        viewBox={graph.viewBox}
        nodes={nodes}
        edges={edges}
        ariaLabel={t(lang, "helpRelationsMapLabel")}
        onSelectNode={onSelectConcept}
        selectTitle={t(lang, "helpRelationsOpenConcept")}
      />
    </div>
  );
}
