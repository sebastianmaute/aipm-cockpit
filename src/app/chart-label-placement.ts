// §737 — places in-chart labels clear of every plotted line and of each other. Pure and
// i18n-free: the chart measures each label (`estimatedLabelWidth`), offers the spots it may
// take, and draws what comes back. A label keeps its usual spot whenever that is clear; when a
// line or an earlier label covers it, it moves to the first clear spot further away and a thin
// leader ties it back to the point it names.

export type Box = { left: number; top: number; right: number; bottom: number };
export type Segment = { x1: number; y1: number; x2: number; y2: number };
export type LabelSpot = { x: number; baseline: number };
export type LabelRequest = {
  width: number;
  anchor: "start" | "end";
  /** Spots beside the point or line the label names, tried first; none of them draws a leader. */
  near: readonly [LabelSpot, ...LabelSpot[]];
  /** Spots further away, tried in order after every near spot; one of them draws a leader to `point`. */
  far: readonly LabelSpot[];
  /** What the label names, for the leader; null for a label that runs along a line instead. */
  point: { x: number; y: number } | null;
};
export type PlacedLabel = LabelSpot & { box: Box; leader: Segment | null };

/** Above and below the baseline of the charts' 8px text, plus a 1px margin all round. */
const ASCENT = 7, DESCENT = 2, MARGIN = 1;

export function labelBox(spot: LabelSpot, width: number, anchor: "start" | "end"): Box {
  const left = anchor === "start" ? spot.x : spot.x - width;
  return { left: left - MARGIN, top: spot.baseline - ASCENT - MARGIN, right: left + width + MARGIN, bottom: spot.baseline + DESCENT + MARGIN };
}

/** Liang–Barsky: whether any part of the segment lies inside the box, edges included. */
export function segmentHitsBox(s: Segment, b: Box): boolean {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  let t0 = 0, t1 = 1;
  const edges: readonly [number, number][] = [[-dx, s.x1 - b.left], [dx, b.right - s.x1], [-dy, s.y1 - b.top], [dy, b.bottom - s.y1]];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return true;
}

export function polylineSegments(points: readonly { x: number; y: number }[]): Segment[] {
  return points.slice(1).map((p, i) => ({ x1: points[i].x, y1: points[i].y, x2: p.x, y2: p.y }));
}

const boxesOverlap = (a: Box, b: Box) => a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;
const inside = (a: Box, bounds: Box) =>
  a.left >= bounds.left && a.right <= bounds.right && a.top >= bounds.top && a.bottom <= bounds.bottom;

/**
 * Places the labels in order; each placed label, and its leader, is an obstacle for the ones after it. A spot is
 * clear when its box is inside `bounds` and meets no segment, no `taken` box and no earlier label. With no clear
 * spot the label takes the one meeting the fewest (leaving the plot counts as one), the earliest
 * on a tie, so it is never dropped.
 */
export function placeLabels(
  requests: readonly LabelRequest[], segments: readonly Segment[], bounds: Box, taken: readonly Box[] = [],
): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const lines = [...segments];
  for (const req of requests) {
    const spots = [...req.near.map((spot) => ({ spot, far: false })), ...req.far.map((spot) => ({ spot, far: true }))];
    let best: { spot: LabelSpot; far: boolean; box: Box; cost: number } | null = null;
    for (const { spot, far } of spots) {
      const box = labelBox(spot, req.width, req.anchor);
      const cost = (inside(box, bounds) ? 0 : 1)
        + lines.filter((s) => segmentHitsBox(s, box)).length
        + placed.filter((p) => boxesOverlap(p.box, box)).length
        + taken.filter((t) => boxesOverlap(t, box)).length;
      if (best === null || cost < best.cost) best = { spot, far, box, cost };
      if (cost === 0) break;
    }
    const { spot, far, box } = best!; // `near` is never empty, so a spot was always costed
    const leader = far && req.point
      ? {
        x1: req.point.x, y1: req.point.y,
        x2: Math.min(Math.max(req.point.x, box.left), box.right), y2: Math.min(Math.max(req.point.y, box.top), box.bottom),
      }
      : null;
    placed.push({ ...spot, box, leader });
    if (leader) lines.push(leader);
  }
  return placed;
}
