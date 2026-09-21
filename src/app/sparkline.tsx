import type { CompletionPoint } from "./completion-trend";

const W = 240;
const H = 40;
const PAD = 3;
const DAY_MS = 86_400_000;

interface SparklineProps {
  points: readonly CompletionPoint[];
  className?: string;
  /** Accessible name for the graphic. When provided the SVG is exposed as
   *  `role="img"` with this label (a bare wrapper `aria-label` is NOT announced
   *  by screen readers). When omitted the SVG is decorative (`aria-hidden`) and
   *  the parent must carry the name on a labelled element. */
  ariaLabel?: string;
}

/** Whole days from the first point's date, or null when a date will not parse. */
function dayOffsets(points: readonly CompletionPoint[]): number[] | null {
  const t0 = Date.parse(`${points[0].date}T00:00:00Z`);
  const out = points.map((p) => (Date.parse(`${p.date}T00:00:00Z`) - t0) / DAY_MS);
  return out.every(Number.isFinite) ? out : null;
}

/** Minimal axis-less SVG line of a completion-% series, with a dot on every
 *  data point. Renders nothing for fewer than two points.
 *
 *  ★ X IS TIME, NOT INDEX: points exist only for days with task activity, so
 *  they are placed by `date` and a three-week gap looks like three weeks. An
 *  unparseable date, or a series all on one day, falls back to even spacing.
 *  ★ Y IS A FIXED 0–100 SCALE, never stretched to the series' own min–max: a
 *  move from 40 % to 45 % must look like five points, not the whole height. The
 *  tile prints the end values beside the line for the detail.
 *  ★ The SVG is stretched non-uniformly (`preserveAspectRatio="none"`), so a
 *  `<circle>` would draw as an ellipse. Each dot is a zero-length path with a
 *  round cap and `vector-effect: non-scaling-stroke`, which stays round. */
export function Sparkline({ points, className, ariaLabel }: SparklineProps) {
  if (points.length < 2) return null;
  const n = points.length;
  const offsets = dayOffsets(points);
  const span = offsets ? offsets[n - 1] : 0;
  const xAt = (i: number) =>
    PAD + (offsets && span > 0 ? offsets[i] / span : i / (n - 1)) * (W - 2 * PAD);
  const yAt = (v: number) => PAD + (1 - Math.min(100, Math.max(0, v)) / 100) * (H - 2 * PAD);
  const xy = points.map((p, i) => [xAt(i).toFixed(1), yAt(p.percent).toFixed(1)] as const);
  const a11y = ariaLabel
    ? { role: "img" as const, "aria-label": ariaLabel }
    : { "aria-hidden": true as const };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`w-full overflow-visible ${className ?? ""}`} preserveAspectRatio="none" {...a11y}>
      <polyline points={xy.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" className="stroke-ui-dark-blue" strokeWidth={2}
        strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {xy.map(([x, y], i) => (
        <path key={i} data-sparkline-point="" d={`M${x} ${y}h0`} className="stroke-ui-dark-blue" strokeWidth={6}
          strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}
