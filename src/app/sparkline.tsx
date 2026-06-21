import type { CompletionPoint } from "./completion-trend";

const W = 240;
const H = 40;
const PAD = 3;

interface SparklineProps {
  points: readonly CompletionPoint[];
  className?: string;
}

/** Minimal axis-less SVG line of a completion-% series. Decorative: the SVG is
 *  aria-hidden and the meaning is carried by the parent wrapper's aria-label
 *  (the line must never become the accessible name). Renders nothing for fewer
 *  than two points. */
export function Sparkline({ points, className }: SparklineProps) {
  if (points.length < 2) return null;
  const values = points.map((p) => p.percent);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const n = points.length;
  const xAt = (i: number) => PAD + (i * (W - 2 * PAD)) / (n - 1);
  const yAt = (v: number) =>
    max <= min ? H / 2 : PAD + (1 - (v - min) / (max - min)) * (H - 2 * PAD);
  const coords = points.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.percent).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`w-full ${className ?? ""}`} aria-hidden="true" preserveAspectRatio="none">
      <polyline points={coords} fill="none" className="stroke-AIPM-dark-blue" strokeWidth={2}
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
