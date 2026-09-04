// Pure, i18n-free reconcile engine. Merges the current detection set into the
// stored insight list, driving the lifecycle (upsert / re-fire / clear). `today`
// is passed IN — there is no clock in this module.
import {
  INSIGHT_SEVERITY_RANK,
  MAX_INSIGHTS,
  type DetectedInsight,
  type Insight,
} from "./insight";
import { baselineOf, computeClearedOutcome, computeOutcome, insightMetricValue } from "./outcome";

/** True when a user has interacted with the insight (ack/act/dismiss). */
function hadUserAction(i: Insight): boolean {
  return (
    i.acknowledgedAt !== undefined ||
    i.actedAt !== undefined ||
    i.dismissedAt !== undefined
  );
}

/** Attach a freshly measured outcome to an ACTED insight. No captured baseline
 *  or no extractable current metric ⇒ leave the record untouched. Idempotent:
 *  same data + same today ⇒ same outcome, so repeated reconciles converge. */
function withMeasuredOutcome(i: Insight, today: string): Insight {
  const baseline = baselineOf(i);
  const current = insightMetricValue(i.type, i.data);
  if (baseline === null || current === null) return i;
  return { ...i, outcome: computeOutcome(baseline, current, today) };
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
  if (prev.status !== "dismissed" && prev.status !== "resolved") {
    // SP3: an acted insight that is STILL detected gets its outcome re-measured
    // against the captured baseline using the fresh detection data.
    return prev.status === "acted" ? withMeasuredOutcome(next, today) : next;
  }
  // Re-fire: the condition is firing again → active, and any prior resolution or
  // dismissal no longer holds. Rebuild without resolvedAt/dismissedAt/dismissReason.
  // recommendation intentionally dropped on re-fire — a stale proposal no longer
  // describes the now-recurring problem; regenerate.
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
    // ★★ `outcome` is DROPPED for BOTH branches — a stale measurement describes the
    // previous state either way. `metricAtAction` is dropped ONLY on a genuine
    // RESOLVED→detected re-fire: the condition actually cleared and came back, so
    // that is a NEW problem instance deserving a new "before" value (keeping it
    // would make the next act a no-op for `metricAtActionPatch` — "first act wins" —
    // and measure a July recurrence against a March baseline).
    // A DISMISSED record is different: it is typically dismissed while STILL firing,
    // so the problem instance never ended and its baseline is still the true "before".
    // Dropping it here would re-create the very wrong-baseline bug this guard exists
    // to prevent, just via the other branch.
    ...(prev.status === "resolved" || next.metricAtAction === undefined
      ? {}
      : { metricAtAction: next.metricAtAction }),
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
    const resolved: Insight = { ...prev, status: "resolved", resolvedAt: today };
    if (prev.status !== "acted") return resolved;
    const baseline = baselineOf(prev);
    // SP3 — DIRECTION-ONLY: the condition cleared, and a disappearance carries no
    // number — this branch is reached precisely because there is no detection left
    // to read a current value from. Emitting a magnitude here would invent one,
    // and for the threshold-gated detectors it would be wrong on its face
    // ("cleared" means below threshold, not zero). `InsightOutcome.current` holds
    // the per-type split. `baseline` is passed through UNCLAMPED: it is the
    // one number this feature exists to preserve faithfully, and clamping would
    // report a "before" value the user never had. (Direction cannot read as
    // "worsened" regardless — computeClearedOutcome always emits "improved".)
    return baseline === null
      ? resolved
      : { ...resolved, outcome: computeClearedOutcome(baseline, today) };
  }
  return null;
}

/**
 * @param isEvaluated - Answers, for ONE stored insight, whether this pass could
 * actually have re-detected it. `false` ⇒ freeze it untouched.
 *
 * ★★★ REQUIRED, WITH NO DEFAULT, AND THAT IS THE POINT. `clear()` above reads
 * "absent from the detection set" as "the condition cleared". That inference is
 * sound only for a detector that always runs. A detector that can go DARK —
 * TimeLog unconfigured on this device, a failed fetch, a disabled rule —
 * produces nothing, and producing nothing is exactly what triggers clear().
 *
 * Because bookings are a PER-DEVICE cache while `Workspace.insights` is SHARED
 * AND EXPORTED, defaulting this to "everything was evaluated" would let a second
 * device prune another device's guardrail insights and resolve any `acted` one
 * through `computeClearedOutcome`, which always writes "improved" — a fabricated
 * win in an exported artifact, which then rides every AI turn via the outcomes
 * section.
 *
 * ★★★ A PER-INSIGHT PREDICATE, NOT A SET OF TYPES, AND THE DIFFERENCE IS THE
 * WHOLE DEFECT CLASS. A `ReadonlySet<InsightType>` can only say "this TYPE ran";
 * every real go-dark case here is "this SPECIFIC stored insight cannot be
 * certified", which no set can express. Three that shipped inside one:
 *   - `overdueTrend` is a core detector that returns null when the per-device
 *     landing snapshot is absent, so the TYPE is never uniformly evaluated.
 *   - the guardrail daily roll is a WINDOW-and-scope snapshot: a rule can run,
 *     find nothing, and still not have looked at the days a stored insight is
 *     about.
 *   - a `partial` roll is missing whole people while every rule still reports
 *     itself evaluated.
 * The caller therefore compares each insight's own `data` against the roll it
 * actually holds. See the predicate built at the `task-manager.tsx` call site.
 *
 * A default would reintroduce exactly that for the NEXT go-dark detector while
 * leaving this guard looking present. Required makes a forgetful detector a
 * typecheck error instead. `reconcile.test.ts` pins that with @ts-expect-error.
 */
export function reconcileInsights(
  stored: readonly Insight[],
  detected: readonly DetectedInsight[],
  today: string,
  isEvaluated: (insight: Insight) => boolean,
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
    // Not evaluated ⇒ FROZEN, carried through byte-for-byte. Reconcile cannot
    // distinguish "not violated" from "not evaluated" on its own, so the caller
    // says which it was — per INSIGHT, because for the guardrails the answer
    // depends on this row's own violating days, not on its type. Anything less
    // than an untouched carry-through — even keeping the row while resolving
    // it — writes the fabricated win.
    if (!isEvaluated(prev)) {
      result.push(prev);
      continue;
    }
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

function toolCallsEqual(
  a: readonly { name: string; input: unknown }[],
  b: readonly { name: string; input: unknown }[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name) return false;
    if (JSON.stringify(a[i].input) !== JSON.stringify(b[i].input)) return false;
  }
  return true;
}

function recommendationEqual(
  a: Insight["recommendation"],
  b: Insight["recommendation"],
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return (
    a.summary === b.summary &&
    a.status === b.status &&
    a.generatedAt === b.generatedAt &&
    a.appliedAt === b.appliedAt &&
    a.appliedSummary === b.appliedSummary &&
    toolCallsEqual(a.proposedCalls, b.proposedCalls)
  );
}

function outcomeEqual(a: Insight["outcome"], b: Insight["outcome"]): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return (
    a.direction === b.direction &&
    a.baseline === b.baseline &&
    a.current === b.current &&
    a.delta === b.delta &&
    a.measuredAt === b.measuredAt
  );
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
      !shallowRecordEqual(x.metricAtAction, y.metricAtAction) ||
      !recommendationEqual(x.recommendation, y.recommendation) ||
      !outcomeEqual(x.outcome, y.outcome)
    ) {
      return false;
    }
  }
  return true;
}
