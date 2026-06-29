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
      className="relative w-full rounded-md border border-line bg-surface-muted p-3 pl-8"
    >
      {/* edge overlay in the left gutter (decorative) */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-y-3 left-1 w-6"
      >
        {graph.edges.map((e) => {
          const na = graph.nodes.find((n) => n.id === e.a);
          const nb = graph.nodes.find((n) => n.id === e.b);
          if (!na || !nb) return null;
          const incident = active === e.a || active === e.b;
          const y1 = na.y * 100;
          const y2 = nb.y * 100;
          // Clamp so the control-point x (12 - bow) stays inside the 0..24 viewBox.
          const bow = Math.min(11, 6 + Math.min(14, Math.abs(y2 - y1) / 4));
          return (
            <path
              key={`${e.a}|${e.b}`}
              d={`M12,${y1} C${12 - bow},${(y1 + y2) / 2} ${12 - bow},${(y1 + y2) / 2} 12,${y2}`}
              fill="none"
              className={incident ? "stroke-AIPM-dark-blue" : "stroke-line"}
              strokeWidth={incident ? 1.2 : 0.7}
              opacity={active && !incident ? 0.3 : 1}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>

      <ul className="flex flex-col gap-1.5">
        {graph.nodes.map((n) => {
          const isActive = active === n.id;
          const isNeighbour = neighbours.has(n.id);
          const dim = active && !isActive && !isNeighbour;
          return (
            <li key={n.id} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`h-2 w-2 shrink-0 rounded-full border-2 ${
                  isActive ? "border-AIPM-dark-blue bg-AIPM-dark-blue" : isNeighbour ? "border-AIPM-green bg-surface" : "border-AIPM-dark-blue bg-surface"
                }`}
              />
              <button
                type="button"
                data-active={isActive ? "true" : "false"}
                onClick={() => onSelectConcept(n.id)}
                onMouseEnter={() => setActive(n.id)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(n.id)}
                onBlur={() => setActive(null)}
                title={t(lang, "helpRelationsOpenConcept")}
                className={`flex-1 rounded-md border border-l-2 bg-surface px-2 py-1 text-left text-xs font-medium ${
                  isActive ? "border-AIPM-dark-blue bg-AIPM-dark-blue text-white" : isNeighbour ? "border-l-AIPM-green border-line text-AIPM-dark-blue dark:text-AIPM-light-grey" : "border-l-AIPM-dark-blue border-line text-foreground"
                } ${dim ? "opacity-40" : "opacity-100"} ${INTERACTIVE}`}
              >
                {t(lang, n.titleKey)}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
