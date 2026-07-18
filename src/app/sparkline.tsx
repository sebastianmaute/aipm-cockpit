import type { CompletionPoint } from "./completion-trend";

const W = 240;
const H = 40;
const PAD = 3;

interface SparklineProps {
  points: readonly CompletionPoint[];
  className?: string;
  /** Accessible name for the graphic. When provided the SVG is exposed as
   *  `role="img"` with this label (a bare wrapper `aria-label` is NOT announced
   *  by screen readers). When omitted the SVG is decorative (`aria-hidden`) and
   *  the parent must carry the name on a labelled element. */
  ariaLabel?: string;
}

/** Minimal axis-less SVG line of a completion-% series. Renders nothing for
 *  fewer than two points. */
export function Sparkline({ points, className, ariaLabel }: SparklineProps) {
  if (points.length < 2) return null;
  const values = points.map((p) => p.percent);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const n = points.length;
  const xAt = (i: number) => PAD + (i * (W - 2 * PAD)) / (n - 1);
  const yAt = (v: number) =>
    max <= min ? H / 2 : PAD + (1 - (v - min) / (max - min)) * (H - 2 * PAD);
  const coords = points.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.percent).toFixed(1)}`).join(" ");
  const a11y = ariaLabel
    ? { role: "img" as const, "aria-label": ariaLabel }
    : { "aria-hidden": true as const };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`w-full ${className ?? ""}`} preserveAspectRatio="none" {...a11y}>
      <polyline points={coords} fill="none" className="stroke-ui-dark-blue" strokeWidth={2}
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
