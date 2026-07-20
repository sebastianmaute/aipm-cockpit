// Pure, i18n-free reconcile engine. Merges the current detection set into the
// stored insight list, driving the lifecycle (upsert / re-fire / clear). `today`
// is passed IN — there is no clock in this module.
import {
  INSIGHT_SEVERITY_RANK,
  MAX_INSIGHTS,
  type DetectedInsight,
  type Insight,
} from "./insight";

/** True when a user has interacted with the insight (ack/act/dismiss). */
function hadUserAction(i: Insight): boolean {
  return (
    i.acknowledgedAt !== undefined ||
    i.actedAt !== undefined ||
    i.dismissedAt !== undefined
  );
}

/** Fold a detection into an existing stored record (upsert / re-fire). */
function upsert(prev: Insight, det: DetectedInsight, today: string): Insight {
  const next: Insight = {
    ...prev,
    severity: det.severity,
    data: det.data,
    entityRef: det.entityRef,
    lastSeenAt: today,
    occurrences: prev.occurrences + 1,
  };
  if (prev.status !== "dismissed" && prev.status !== "resolved") return next;
  // Re-fire: the condition is firing again → active, and any prior resolution or
  // dismissal no longer holds. Rebuild without resolvedAt/dismissedAt/dismissReason.
  return {
    id: next.id,
    key: next.key,
    type: next.type,
    severity: next.severity,
    entityRef: next.entityRef,
    data: next.data,
    status: "active",
    firstSeenAt: next.firstSeenAt,
    lastSeenAt: next.lastSeenAt,
    occurrences: next.occurrences,
    ...(next.acknowledgedAt !== undefined ? { acknowledgedAt: next.acknowledgedAt } : {}),
    ...(next.actedAt !== undefined ? { actedAt: next.actedAt } : {}),
    ...(next.metricAtAction !== undefined ? { metricAtAction: next.metricAtAction } : {}),
  };
}

/** A brand-new active record for an unseen detection. */
function create(det: DetectedInsight, id: number, today: string): Insight {
  return {
    id,
    key: det.key,
    type: det.type,
    severity: det.severity,
    entityRef: det.entityRef,
    data: det.data,
    status: "active",
    firstSeenAt: today,
    lastSeenAt: today,
    occurrences: 1,
  };
}

/**
 * A stored record whose key is NOT in the current detection set.
 * - dismissed → unchanged (stays suppressed).
 * - had a user event → resolve (keep as history).
 * - auto-surfaced, never touched → prune (return null).
 */
function clear(prev: Insight, today: string): Insight | null {
  if (prev.status === "dismissed") return prev;
  if (prev.status === "resolved") return prev;
  if (hadUserAction(prev)) {
    return { ...prev, status: "resolved", resolvedAt: today };
  }
  return null;
}

export function reconcileInsights(
  stored: readonly Insight[],
  detected: readonly DetectedInsight[],
  today: string,
): Insight[] {
  const byKey = new Map<string, Insight>();
  let maxId = 0;
  for (const i of stored) {
    byKey.set(i.key, i);
    if (i.id > maxId) maxId = i.id;
  }
  let nextId = maxId + 1;

  const detectedKeys = new Set<string>();
  const result: Insight[] = [];

  for (const det of detected) {
    if (detectedKeys.has(det.key)) continue; // first detection per key wins
    detectedKeys.add(det.key);
    const prev = byKey.get(det.key);
    result.push(prev ? upsert(prev, det, today) : create(det, nextId++, today));
  }

  for (const prev of stored) {
    if (detectedKeys.has(prev.key)) continue;
    const cleared = clear(prev, today);
    if (cleared !== null) result.push(cleared);
  }

  result.sort((a, b) => {
    const bySeverity = INSIGHT_SEVERITY_RANK[a.severity] - INSIGHT_SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    if (a.lastSeenAt < b.lastSeenAt) return 1;
    if (a.lastSeenAt > b.lastSeenAt) return -1;
    return 0;
  });

  return result.slice(0, MAX_INSIGHTS);
}

/** Same keys, same primitive values (both may be undefined). */
function shallowRecordEqual(
  x: Readonly<Record<string, string | number>> | undefined,
  y: Readonly<Record<string, string | number>> | undefined,
): boolean {
  if (x === y) return true;
  if (x === undefined || y === undefined) return false;
  const xk = Object.keys(x);
  const yk = Object.keys(y);
  if (xk.length !== yk.length) return false;
  for (const k of xk) {
    if (!Object.prototype.hasOwnProperty.call(y, k)) return false;
    if (x[k] !== y[k]) return false;
  }
  return true;
}

function entityRefEqual(
  a: Insight["entityRef"],
  b: Insight["entityRef"],
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return a.view === b.view && a.id === b.id;
}

/**
 * True when `a` and `b` are the SAME set of insights differing ONLY in
 * `occurrences` and/or `lastSeenAt`. Both come from `reconcileInsights`, whose
 * output is deterministically sorted, so compare element-wise by index. When
 * this holds the runner should skip the write-back (no material change), which
 * avoids a write-on-open and an extra save per edit.
 */
export function insightsMateriallyEqual(
  a: readonly Insight[],
  b: readonly Insight[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.key !== y.key ||
      x.type !== y.type ||
      x.severity !== y.severity ||
      x.status !== y.status ||
      x.firstSeenAt !== y.firstSeenAt ||
      x.acknowledgedAt !== y.acknowledgedAt ||
      x.actedAt !== y.actedAt ||
      x.dismissedAt !== y.dismissedAt ||
      x.resolvedAt !== y.resolvedAt ||
      x.dismissReason !== y.dismissReason ||
      !entityRefEqual(x.entityRef, y.entityRef) ||
      !shallowRecordEqual(x.data, y.data) ||
      !shallowRecordEqual(x.metricAtAction, y.metricAtAction)
    ) {
      return false;
    }
  }
  return true;
}
