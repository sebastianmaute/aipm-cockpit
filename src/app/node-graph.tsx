"use client";

import { useState } from "react";
import { FOCUS_RING } from "./interaction-styles";
import type { NodeGraphNode, NodeGraphEdge, NodeGraphZone, ViewBox } from "./node-graph-layout";

interface NodeGraphProps {
  viewBox: ViewBox;
  nodes: readonly NodeGraphNode[];
  edges: readonly NodeGraphEdge[];
  zones?: readonly NodeGraphZone[];
  /** Group/img accessible name. */
  ariaLabel: string;
  /** <desc> text for static (role=img) mode. */
  description?: string;
  /** px cap on the rendered width. */
  maxWidth?: number;
  /** Present ⇒ interactive (button overlay). Absent ⇒ static role=img. */
  onSelectNode?: (id: string) => void;
  /** Per-node button accessible name (interactive). Defaults to node.label. */
  nodeAriaLabel?: (node: NodeGraphNode) => string;
  /** Tooltip on each node button (interactive). */
  selectTitle?: string;
}

function ArrowDefs() {
  return (
    <defs>
      <marker id="ng-arrow-end" markerWidth={8} markerHeight={8} refX={6} refY={3} orient="auto">
        <path d="M0,0 L0,6 L8,3 z" className="fill-AIPM-medium-grey" />
      </marker>
      <marker id="ng-arrow-start" markerWidth={8} markerHeight={8} refX={2} refY={3} orient="auto-start-reverse">
        <path d="M0,0 L0,6 L8,3 z" className="fill-AIPM-medium-grey" />
      </marker>
    </defs>
  );
}

function ZoneShape({ zone }: { zone: NodeGraphZone }) {
  return (
    <g>
      <rect
        x={zone.x}
        y={zone.y}
        width={zone.w}
        height={zone.h}
        rx={10}
        fill="none"
        className="stroke-AIPM-medium-grey"
        strokeWidth={1}
        strokeDasharray="4 3"
      />
      <text
        x={zone.x + 10}
        y={zone.y + 12}
        fill={zone.color}
        fontSize={9}
        fontWeight={700}
        style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}
      >
        {zone.label}
      </text>
    </g>
  );
}

function NodeShape({
  node,
  isActive,
  isNeighbour,
  dim,
}: {
  node: NodeGraphNode;
  isActive: boolean;
  isNeighbour: boolean;
  dim: boolean;
}) {
  const hub = node.accent === "hub";
  const filled = hub || isActive;
  const fillClass = filled ? "fill-AIPM-dark-blue" : "fill-surface";
  const strokeClass = isNeighbour ? "stroke-AIPM-green" : node.accent === "green" ? "stroke-AIPM-green" : "stroke-AIPM-dark-blue";
  const titleClass = filled ? "text-white" : "text-foreground";
  const subClass = filled ? "text-AIPM-green" : "text-muted-foreground";
  const stripeClass = node.accent === "green" ? "fill-AIPM-green" : "fill-AIPM-dark-blue";
  return (
    <g opacity={dim ? 0.4 : 1}>
      <rect
        x={node.x}
        y={node.y}
        width={node.w}
        height={node.h}
        rx={7}
        className={`${fillClass} ${strokeClass}`}
        strokeWidth={hub ? 2 : 1.5}
      />
      {!filled && (
        <rect x={node.x} y={node.y} width={3} height={node.h} rx={1.5} className={stripeClass} />
      )}
      <text
        x={node.x + node.w / 2}
        y={node.y + (node.sub ? 18 : node.h / 2 + 4)}
        textAnchor="middle"
        fill="currentColor"
        className={titleClass}
        fontSize={10.5}
        fontWeight={600}
      >
        {node.label}
      </text>
      {node.sub && (
        <text
          x={node.x + node.w / 2}
          y={node.y + 33}
          textAnchor="middle"
          fill="currentColor"
          className={subClass}
          fontSize={8.5}
        >
          {node.sub}
        </text>
      )}
    </g>
  );
}

/** Reusable 2D node-graph. Static (role=img) when `onSelectNode` is absent;
 *  interactive (transparent button overlay over a decorative svg) when present.
 *  Presentational + i18n-free — callers pass already-translated strings. */
export function NodeGraph({
  viewBox,
  nodes,
  edges,
  zones,
  ariaLabel,
  description,
  maxWidth,
  onSelectNode,
  nodeAriaLabel,
  selectTitle,
}: NodeGraphProps) {
  const interactive = !!onSelectNode;
  const [active, setActive] = useState<string | null>(null);

  const neighbours = new Set<string>();
  if (active) {
    for (const e of edges) {
      if (e.a === active) neighbours.add(e.b);
      else if (e.b === active) neighbours.add(e.a);
    }
  }

  const inner = (
    <>
      {description && <desc>{description}</desc>}
      <ArrowDefs />
      {zones?.map((z, i) => (
        <ZoneShape key={`z${i}`} zone={z} />
      ))}
      {edges.map((e, i) => {
        const na = nodes.find((n) => n.id === e.a);
        const nb = nodes.find((n) => n.id === e.b);
        if (!na || !nb) return null;
        const incident = active === e.a || active === e.b;
        return (
          <line
            key={`e${i}`}
            x1={na.x + na.w / 2}
            y1={na.y + na.h / 2}
            x2={nb.x + nb.w / 2}
            y2={nb.y + nb.h / 2}
            className={incident ? "stroke-AIPM-dark-blue" : "stroke-line"}
            strokeWidth={incident ? 1.6 : 1.2}
            opacity={active && !incident ? 0.3 : 1}
            markerStart={e.arrow === "both" ? "url(#ng-arrow-start)" : undefined}
            markerEnd={e.arrow === "both" ? "url(#ng-arrow-end)" : undefined}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {nodes.map((n) => {
        const isActive = active === n.id;
        const isNeighbour = neighbours.has(n.id);
        return (
          <NodeShape
            key={n.id}
            node={n}
            isActive={isActive}
            isNeighbour={isNeighbour}
            dim={!!active && !isActive && !isNeighbour}
          />
        );
      })}
    </>
  );

  if (!interactive) {
    return (
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${viewBox.w} ${viewBox.h}`}
        width="100%"
        style={{ maxWidth }}
        xmlns="http://www.w3.org/2000/svg"
      >
        {inner}
      </svg>
    );
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="relative w-full"
      style={{ maxWidth, aspectRatio: `${viewBox.w} / ${viewBox.h}` }}
    >
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${viewBox.w} ${viewBox.h}`}
        className="absolute inset-0 h-full w-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        {inner}
      </svg>
      {nodes.map((n) => (
        <button
          key={n.id}
          type="button"
          data-active={active === n.id ? "true" : "false"}
          onClick={() => onSelectNode?.(n.id)}
          onMouseEnter={() => setActive(n.id)}
          onMouseLeave={() => setActive(null)}
          onFocus={() => setActive(n.id)}
          onBlur={() => setActive(null)}
          aria-label={nodeAriaLabel ? nodeAriaLabel(n) : n.label}
          title={selectTitle}
          className={`absolute rounded-md bg-transparent ${FOCUS_RING}`}
          style={{
            left: `${(n.x / viewBox.w) * 100}%`,
            top: `${(n.y / viewBox.h) * 100}%`,
            width: `${(n.w / viewBox.w) * 100}%`,
            height: `${(n.h / viewBox.h) * 100}%`,
          }}
        />
      ))}
    </div>
  );
}
