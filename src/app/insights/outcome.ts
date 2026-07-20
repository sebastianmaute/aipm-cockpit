// Pure, i18n-free SP3 outcome engine. Every insight metric is LOWER-IS-BETTER,
// so `improved` is simply current < baseline — there is no per-type direction
// table. `today` is always passed in; this module reads no clock.
import { type Insight, type InsightOutcome, type InsightType } from "./insight";

/** The ONE comparable number per insight type, keyed by the `data` field each
 *  detector in detect.ts emits. Pinned by a guard test — renaming a detector's
 *  data key without updating this map silently strands extraction at null. */
export const METRIC_FIELD: Record<InsightType, string> = {
  milestoneSlip: "daysOverdue",
  overdueTrend: "current",
  stalledWork: "count",
  budgetVariance: "variancePct",
  raidAging: "daysSinceUpdate",
};

/** ★ An EMPTY or whitespace-only string must NOT coerce to 0 — `Number("")` is 0,
 *  which would read as "the metric reached zero" and fabricate an `improved`
 *  outcome (or a resolution) out of a missing value. Require real digits. */
function finite(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** The comparable number for an insight's data, or null when absent/unparseable. */
export function insightMetricValue(
  type: InsightType,
  data: Readonly<Record<string, string | number>>,
): number | null {
  return finite(data[METRIC_FIELD[type]]);
}

/** `{ [field]: value }` for metricAtAction, or undefined when no metric exists. */
export function insightMetricSnapshot(
  insight: Insight,
): Readonly<Record<string, number>> | undefined {
  const v = insightMetricValue(insight.type, insight.data);
  return v === null ? undefined : { [METRIC_FIELD[insight.type]]: v };
}

/** Spreadable patch for an acted transition. The FIRST act wins — a re-act must
 *  never overwrite the true "before" value the outcome is measured against. */
export function metricAtActionPatch(
  insight: Insight,
): { metricAtAction?: Readonly<Record<string, number>> } {
  if (insight.metricAtAction !== undefined) return {};
  const snap = insightMetricSnapshot(insight);
  return snap ? { metricAtAction: snap } : {};
}

/** The captured baseline for this insight, or null when never captured. */
export function baselineOf(insight: Insight): number | null {
  const m = insight.metricAtAction;
  if (!m) return null;
  return finite(m[METRIC_FIELD[insight.type]]);
}

export function computeOutcome(baseline: number, current: number, today: string): InsightOutcome {
  const delta = baseline - current;
  const direction = delta > 0 ? "improved" : delta < 0 ? "worsened" : "unchanged";
  return { direction, baseline, current, delta, measuredAt: today };
}

/** The outcome for an insight whose condition CLEARED (it stopped being detected).
 *  Direction-only: the detectors are threshold-gated, so we know the problem went
 *  away but NOT the true current value — and there is no detection left to read it
 *  from. Emitting a magnitude here would overstate the improvement. */
export function computeClearedOutcome(baseline: number, today: string): InsightOutcome {
  return { direction: "improved", baseline, measuredAt: today };
}
