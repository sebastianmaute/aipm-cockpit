// Pure engine: per-KPI trend (direction + delta) vs the user's last-visit
// snapshot. No React, no I/O — the testable unit behind the dashboard KPI strip.

export type MetricKey = "complete" | "overdue" | "openRaid";
export type MetricSnapshot = Partial<Record<MetricKey, number>>;
export type MetricTrend = {
  value: number;
  delta: number | null; // null ⇒ no prior value (first visit / pre-metrics state)
  direction: "up" | "down" | "flat";
  improved: boolean | null; // null when delta is null; an exactly-flat change ⇒ false
};

const METRIC_KEYS: readonly MetricKey[] = ["complete", "overdue", "openRaid"];
const HIGHER_IS_BETTER: Record<MetricKey, boolean> = {
  complete: true,
  overdue: false,
  openRaid: false,
};

export function computeMetricTrends(
  prior: MetricSnapshot | undefined,
  current: Record<MetricKey, number>,
): Record<MetricKey, MetricTrend> {
  const result = {} as Record<MetricKey, MetricTrend>;

  for (const key of METRIC_KEYS) {
    const value = current[key];
    const priorVal = prior?.[key];
    const delta = priorVal === undefined ? null : value - priorVal;

    let direction: MetricTrend["direction"];
    if (delta === null || delta === 0) {
      direction = "flat";
    } else if (delta > 0) {
      direction = "up";
    } else {
      direction = "down";
    }

    let improved: boolean | null;
    if (delta === null) {
      improved = null;
    } else if (delta === 0) {
      improved = false;
    } else {
      improved = HIGHER_IS_BETTER[key] ? delta > 0 : delta < 0;
    }

    result[key] = { value, delta, direction, improved };
  }

  return result;
}
