"use client";

import { useState } from "react";
import { type Lang, t } from "./i18n";
import type { RelationsGraph } from "./relations-graph";
import { INTERACTIVE } from "./interaction-styles";

interface RelationsMapProps {
  graph: RelationsGraph;
  lang: Lang;
  onSelectConcept: (id: string) => void;
}

/** Interactive concept relations map (SP3). A decorative aria-hidden SVG draws
 *  the edges; real absolutely-positioned HTML buttons are the keyboard-native,
 *  axe-clean interactive nodes. Hover/focus highlights a node's incident edges
 *  and neighbours. Presentational — no context, no persistence. */
export function RelationsMap({ graph, lang, onSelectConcept }: RelationsMapProps) {
  const [active, setActive] = useState<string | null>(null);

  const neighbours = new Set<string>();
  if (active) {
    for (const e of graph.edges) {
      if (e.a === active) neighbours.add(e.b);
      else if (e.b === active) neighbours.add(e.a);
    }
  }

  return (
    <div
      role="group"
      aria-label={t(lang, "helpRelationsMapLabel")}
      className="relative aspect-[3/2] max-h-80 w-full rounded-md border border-line bg-surface-muted"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
      >
        {graph.edges.map((e) => {
          const na = graph.nodes.find((n) => n.id === e.a);
          const nb = graph.nodes.find((n) => n.id === e.b);
          if (!na || !nb) return null;
          const incident = active === e.a || active === e.b;
          return (
            <line
              key={`${e.a}|${e.b}`}
              x1={na.x * 100}
              y1={na.y * 100}
              x2={nb.x * 100}
              y2={nb.y * 100}
              className={incident ? "stroke-AIPM-dark-blue" : "stroke-line"}
              strokeWidth={incident ? 0.8 : 0.4}
              opacity={active && !incident ? 0.3 : 1}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {graph.nodes.map((n) => (
          <circle key={n.id} cx={n.x * 100} cy={n.y * 100} r={0.8} className="fill-AIPM-dark-blue" />
        ))}
      </svg>

      {graph.nodes.map((n) => {
        const isActive = active === n.id;
        const isNeighbour = neighbours.has(n.id);
        const dim = active && !isActive && !isNeighbour;
        return (
          <button
            key={n.id}
            type="button"
            data-active={isActive ? "true" : "false"}
            onClick={() => onSelectConcept(n.id)}
            onMouseEnter={() => setActive(n.id)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(n.id)}
            onBlur={() => setActive(null)}
            title={t(lang, "helpRelationsOpenConcept")}
            style={{ left: `${n.x * 100}%`, top: `${n.y * 100}%` }}
            className={`absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border bg-surface px-2 py-1 text-xs font-medium text-foreground ${
              isActive || isNeighbour ? "border-AIPM-dark-blue" : "border-line"
            } ${dim ? "opacity-40" : "opacity-100"} ${INTERACTIVE}`}
          >
            {t(lang, n.titleKey)}
          </button>
        );
      })}
    </div>
  );
}
