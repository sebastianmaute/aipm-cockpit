import type { ReactNode } from "react";

export interface TrendPoint {
  label: string;          // x-axis tick (e.g. "2026-W24" or a short date)
  value: number;
  /** True when one or more expected cadence buckets are missing before this point. */
  gapBefore: boolean;
}

const W = 320, H = 160, PAD_L = 52, PAD_R = 12, PAD_T = 12, PAD_B = 28;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

function xAt(i: number, n: number): number {
  if (n <= 1) return PAD_L;
  return PAD_L + (i * PLOT_W) / (n - 1);
}
function yAt(v: number, min: number, max: number): number {
  if (max <= min) return PAD_T + PLOT_H / 2;
  return PAD_T + (1 - (v - min) / (max - min)) * PLOT_H;
}

export function TrendChart({
  caption, points, gapCount = 0, emptyLabel, format = (v: number) => String(Math.round(v)),
}: {
  caption: string;
  points: readonly TrendPoint[];
  gapCount?: number;
  emptyLabel?: ReactNode;
  format?: (v: number) => string;
}) {
  if (points.length < 2) {
    return (
      <div className="min-w-[240px] flex-1">
        <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{caption}</div>
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      </div>
    );
  }
  const n = points.length;
  const values = points.map((p) => p.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const baseY = PAD_T + PLOT_H;
  const yTicks = max > min ? [min, (min + max) / 2, max] : [min];

  const segments = points.slice(1).map((p, i) => {
    const x1 = xAt(i, n), y1 = yAt(points[i].value, min, max);
    const x2 = xAt(i + 1, n), y2 = yAt(p.value, min, max);
    return { x1, y1, x2, y2, dashed: p.gapBefore };
  });

  return (
    <div className="min-w-[240px] flex-1">
      <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
        {caption}{gapCount > 0 ? ` · ${gapCount} gap${gapCount === 1 ? "" : "s"}` : ""}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={caption}>
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={baseY} className="stroke-line" strokeWidth={1} />
        <line x1={PAD_L} y1={baseY} x2={W - PAD_R} y2={baseY} className="stroke-line" strokeWidth={1} />
        {yTicks.map((v) => (
          <text key={v} x={PAD_L - 4} y={yAt(v, min, max) + 3} textAnchor="end" className="fill-muted-foreground text-[8px] tabular-nums" aria-hidden="true">
            {format(v)}
          </text>
        ))}
        {segments.map((s, i) =>
          s.dashed ? (
            <rect key={`g${i}`} data-testid="gap-band" x={s.x1} y={PAD_T} width={s.x2 - s.x1} height={PLOT_H}
              className="fill-muted-foreground" opacity={0.08} aria-hidden="true" />
          ) : null,
        )}
        {segments.map((s, i) => (
          <line key={`s${i}`} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
            className="stroke-AIPM-dark-blue" strokeWidth={2}
            strokeDasharray={s.dashed ? "4 3" : undefined} />
        ))}
        <polyline points={points.map((p, i) => `${xAt(i, n).toFixed(1)},${yAt(p.value, min, max).toFixed(1)}`).join(" ")}
          fill="none" className="stroke-AIPM-dark-blue" strokeWidth={0} aria-hidden="true" />
        {points.map((p, i) => (
          <text key={`x${i}`} x={xAt(i, n)} y={baseY + 12}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
            className="fill-muted-foreground text-[8px] tabular-nums" aria-hidden="true">
            {p.label}
          </text>
        ))}
      </svg>
    </div>
  );
}
