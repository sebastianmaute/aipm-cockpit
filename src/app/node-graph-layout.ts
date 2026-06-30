// Pure, i18n-free model + layout for the reusable NodeGraph component.
// No React, no Date/Math.random — every output is a pure function of input.

export type NodeAccent = "blue" | "green" | "hub";

export interface ViewBox {
  w: number;
  h: number;
}

/** A positioned diagram node. Coordinates are in viewBox units. */
export interface NodeGraphNode {
  id: string;
  label: string;
  sub?: string;
  accent: NodeAccent;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An edge between two node ids. `arrow:"both"` draws a double-headed arrow. */
export interface NodeGraphEdge {
  a: string;
  b: string;
  arrow?: "none" | "both";
}

/** A dashed group rectangle with an uppercase label. `color` is a CSS color. */
export interface NodeGraphZone {
  label: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const NODE_W = 120;
const NODE_H = 30;
const GAP_X = 24;
const GAP_Y = 22;
const MARGIN = 12;

export interface GridConfig {
  cols?: number;
  nodeW?: number;
  nodeH?: number;
  gapX?: number;
  gapY?: number;
  margin?: number;
}

/** Lay items out row-major in a deterministic grid. Each output node carries
 *  the original item payload plus x/y/w/h in viewBox units. */
export function gridLayout<T extends { id: string }>(
  items: readonly T[],
  cfg: GridConfig = {},
): { nodes: (T & { x: number; y: number; w: number; h: number })[]; viewBox: ViewBox } {
  const nodeW = cfg.nodeW ?? NODE_W;
  const nodeH = cfg.nodeH ?? NODE_H;
  const gapX = cfg.gapX ?? GAP_X;
  const gapY = cfg.gapY ?? GAP_Y;
  const margin = cfg.margin ?? MARGIN;

  const n = items.length;
  const cols = Math.max(1, cfg.cols ?? Math.ceil(Math.sqrt(Math.max(1, n))));
  const rows = Math.max(1, Math.ceil(Math.max(1, n) / cols));

  const nodes = items.map((it, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    return {
      ...it,
      x: margin + c * (nodeW + gapX),
      y: margin + r * (nodeH + gapY),
      w: nodeW,
      h: nodeH,
    };
  });

  const viewBox: ViewBox = {
    w: margin * 2 + cols * nodeW + (cols - 1) * gapX,
    h: margin * 2 + rows * nodeH + (rows - 1) * gapY,
  };

  return { nodes, viewBox };
}
