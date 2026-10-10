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

/** One character of an 8px tabular label is about 4.4 units wide ("2026-W16" ≈ 35). */
export const X_LABEL_CHAR_W = 4.4;

/** How many x labels fit when the longest is `chars` wide. The tightest pair is the start-anchored
 *  first label beside a centred one (or a centred one beside the end-anchored last), which needs
 *  1.5 label widths between anchors: 5 weekly labels ("2026-W16"), 4 daily ("2026-09-18"), 6
 *  monthly ("2026-09"). */
export function xLabelCapacity(chars: number): number {
  return Math.max(2, Math.floor(PLOT_W / (1.5 * chars * X_LABEL_CHAR_W)) + 1);
}

/** The indices that get an x label: every point when `max` fit, otherwise evenly spaced ones,
 *  always the first and the last. A step-aligned label less than a full step before the last
 *  one is dropped, since the end-anchored last label reaches back a whole label width. */
export function labelledIndices(n: number, max: number): Set<number> {
  if (n <= max) return new Set(Array.from({ length: n }, (_, i) => i));
  const step = Math.ceil((n - 1) / (max - 1));
  const kept = [];
  for (let i = 0; i < n - 1; i += step) kept.push(i);
  if (n - 1 - kept[kept.length - 1] < step) kept.pop();
  return new Set([...kept, n - 1]);
}

export function TrendChart({
  caption, points, gapCount = 0, gapLabel, emptyLabel, format = (v: number) => String(Math.round(v)),
}: {
  caption: string;
  points: readonly TrendPoint[];
  gapCount?: number;
  gapLabel?: string;
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
  const labelled = labelledIndices(n, xLabelCapacity(Math.max(...points.map((p) => p.label.length))));

  const segments = points.slice(1).map((p, i) => {
    const x1 = xAt(i, n), y1 = yAt(points[i].value, min, max);
    const x2 = xAt(i + 1, n), y2 = yAt(p.value, min, max);
    return { x1, y1, x2, y2, dashed: p.gapBefore };
  });

  return (
    <div className="min-w-[240px] flex-1">
      <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
        {caption}{gapLabel ? ` · ${gapLabel}` : gapCount > 0 ? ` · ${gapCount} gap${gapCount === 1 ? "" : "s"}` : ""}
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
            className="stroke-ui-dark-blue" strokeWidth={2}
            strokeDasharray={s.dashed ? "4 3" : undefined} />
        ))}
        <polyline points={points.map((p, i) => `${xAt(i, n).toFixed(1)},${yAt(p.value, min, max).toFixed(1)}`).join(" ")}
          fill="none" className="stroke-ui-dark-blue" strokeWidth={0} aria-hidden="true" />
        {points.map((p, i) => !labelled.has(i) ? null : (
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
