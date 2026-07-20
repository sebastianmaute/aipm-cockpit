// Pure, i18n-free. The SINGLE validator for the persisted insight list. Never
// throws — bad records are dropped, bad fields coerced/dropped. Mirrors the
// defensive posture of sanitizeKnowledgeItems.
// outcome.ts imports only ./insight, so this stays acyclic.
import { METRIC_FIELD } from "./outcome";
import {
  INSIGHT_TYPES, INSIGHT_SEVERITIES, INSIGHT_STATUSES, INSIGHT_REC_STATUSES,
  MAX_INSIGHTS, INSIGHT_DISMISS_REASON_MAX, INSIGHT_DATA_VALUE_MAX,
  INSIGHT_REC_SUMMARY_MAX, INSIGHT_REC_MAX_CALLS, INSIGHT_REC_TOOL_NAME_MAX, ALLOWED_REC_TOOLS,
  INSIGHT_OUTCOME_DIRECTIONS,
  type Insight, type InsightType, type InsightSeverity, type InsightStatus,
  type InsightEntityRef, type InsightRecommendation,
  type InsightRecommendationStatus, type InsightToolCall,
  type InsightOutcome, type InsightOutcomeDirection,
} from "./insight";

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s.slice(0, max) : undefined;
}
function posInt(v: unknown): number {
  const n = typeof v === "number" ? Math.floor(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1;
}
function isoOr(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 40) : fallback;
}
function sanitizeData(v: unknown): Record<string, string | number> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, string | number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "number" && Number.isFinite(val)) out[k] = val;
    else if (typeof val === "string") out[k] = val.slice(0, INSIGHT_DATA_VALUE_MAX);
  }
  return out;
}
function sanitizeRef(v: unknown): InsightEntityRef | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const id = typeof o.id === "number" && Number.isFinite(o.id) ? o.id : undefined;
  const view = typeof o.view === "string" ? o.view : undefined;
  if (id === undefined || view === undefined) return undefined;
  return { view: view as InsightEntityRef["view"], id };
}
function sanitizeToolCall(v: unknown): InsightToolCall | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const name = str(o.name, INSIGHT_REC_TOOL_NAME_MAX);
  if (!name) return undefined;
  // Security: only the sanctioned non-destructive tools may persist. A tampered/
  // imported/synced blob must never carry delete_*/update_settings past load.
  if (!ALLOWED_REC_TOOLS.has(name)) return undefined;
  if (!o.input || typeof o.input !== "object" || Array.isArray(o.input)) return undefined;
  return { name, input: o.input as Record<string, unknown> };
}
function sanitizeRecommendation(v: unknown): InsightRecommendation | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const summary = str(o.summary, INSIGHT_REC_SUMMARY_MAX);
  if (!summary) return undefined;
  if (!Array.isArray(o.proposedCalls)) return undefined;
  const calls = o.proposedCalls
    .map(sanitizeToolCall)
    .filter((c): c is InsightToolCall => c !== undefined)
    .slice(0, INSIGHT_REC_MAX_CALLS);
  const status = INSIGHT_REC_STATUSES.includes(o.status as InsightRecommendationStatus)
    ? (o.status as InsightRecommendationStatus)
    : "proposed";
  const appliedSummary = str(o.appliedSummary, INSIGHT_REC_SUMMARY_MAX);
  const appliedAt = str(o.appliedAt, 40);
  return {
    summary,
    proposedCalls: calls,
    generatedAt: isoOr(o.generatedAt, ""),
    status,
    ...(appliedSummary ? { appliedSummary } : {}),
    ...(appliedAt ? { appliedAt } : {}),
  };
}
/** Numeric coercion for persisted metric values. An EMPTY/whitespace string must
 *  NOT become 0 — `Number("")` is 0, which would read as "the metric hit zero",
 *  i.e. a fabricated "condition fully cleared". Require real digits. */
function num(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (s === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
/** Bound for a persisted metric magnitude. These are day counts, item counts and
 *  percentages — anything beyond this is corrupt or tampered, not real data. */
const METRIC_MAGNITUDE_MAX = 1e9;
/** The closed set of real metric field names (one per insight type). Bounding
 *  `metricAtAction` to these keys caps the record by construction and can never
 *  drop the key that is actually read. */
const VALID_METRIC_FIELDS: ReadonlySet<string> = new Set(Object.values(METRIC_FIELD));
function boundedMetric(v: unknown): number | undefined {
  const n = num(v);
  return n !== undefined && Math.abs(n) <= METRIC_MAGNITUDE_MAX ? n : undefined;
}
/** The captured acted-on baseline (SP3). Values are re-validated and bounded;
 *  a non-numeric or out-of-range entry is dropped rather than trusted. Without
 *  this the field is silently lost on EVERY load path, which both disables
 *  measurement and lets a later re-act capture a WRONG baseline from
 *  already-improved data (the "first act wins" guard reads this field). */
function sanitizeMetricAtAction(v: unknown): Readonly<Record<string, number>> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    // Keep ONLY real metric field names. This bounds the record by construction
    // (at most one key per insight type) without an order-dependent count cap —
    // a `break`-after-N would drop the ONE key that is actually read
    // (`METRIC_FIELD[type]`) if a tampered blob listed junk keys ahead of it,
    // silently disabling measurement.
    if (!VALID_METRIC_FIELDS.has(k)) continue;
    const n = boundedMetric(val);
    if (n !== undefined) out[k] = n;
  }
  return Object.keys(out).length ? out : undefined;
}
/** SP3 outcome. `delta` and `direction` are RE-DERIVED from baseline/current
 *  rather than trusted — a persisted blob claiming "improved by 1e308" while
 *  current > baseline would otherwise survive and render a nonsense label
 *  (and on a resolved insight nothing ever recomputes it). */
function sanitizeOutcome(v: unknown): InsightOutcome | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const stored = o.direction as InsightOutcomeDirection;
  if (!INSIGHT_OUTCOME_DIRECTIONS.includes(stored)) return undefined;
  const baseline = boundedMetric(o.baseline);
  if (baseline === undefined) return undefined;
  const measuredAt = isoOr(o.measuredAt, "");
  // ★ ABSENT and CORRUPT must not be conflated. A genuinely absent `current` is
  // the direction-only "condition cleared" shape; a PRESENT but invalid one
  // (Infinity, "x", out of range) is a corrupt record — drop the whole outcome
  // rather than silently promoting it to a "cleared" win.
  const hasCurrent = o.current !== undefined && o.current !== null;
  const current = boundedMetric(o.current);
  if (hasCurrent && current === undefined) return undefined;
  // Direction is RE-DERIVED here too, not trusted: the only producer of the
  // direction-only shape is `computeClearedOutcome`, which always emits
  // "improved". A persisted record claiming "worsened" with no magnitude is
  // unreachable in-app, and would render a RED dot beside "Resolved since you
  // acted" (the badge picks text by `delta`, colour by `direction`).
  if (current === undefined) return { direction: "improved", baseline, measuredAt };
  const delta = baseline - current;
  const direction: InsightOutcomeDirection =
    delta > 0 ? "improved" : delta < 0 ? "worsened" : "unchanged";
  return { direction, baseline, current, delta, measuredAt };
}

export function sanitizeInsights(input: unknown): Insight[] {
  if (!Array.isArray(input)) return [];
  const out: Insight[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const type = o.type as InsightType;
    const severity = o.severity as InsightSeverity;
    const status = o.status as InsightStatus;
    if (!INSIGHT_TYPES.includes(type)) continue;
    if (!INSIGHT_SEVERITIES.includes(severity)) continue;
    if (!INSIGHT_STATUSES.includes(status)) continue;
    const key = str(o.key, 200);
    const id = typeof o.id === "number" && Number.isFinite(o.id) ? o.id : undefined;
    if (!key || id === undefined) continue;
    const firstSeenAt = isoOr(o.firstSeenAt, "");
    if (!firstSeenAt) continue;
    const ref = sanitizeRef(o.entityRef);
    const ackAt = str(o.acknowledgedAt, 40);
    const actAt = str(o.actedAt, 40);
    const disAt = str(o.dismissedAt, 40);
    const resAt = str(o.resolvedAt, 40);
    const reason = str(o.dismissReason, INSIGHT_DISMISS_REASON_MAX);
    const rec = sanitizeRecommendation(o.recommendation);
    const metricAtAction = sanitizeMetricAtAction(o.metricAtAction);
    const outcome = sanitizeOutcome(o.outcome);
    const insight: Insight = {
      id, key, type, severity, status,
      data: sanitizeData(o.data),
      firstSeenAt,
      lastSeenAt: isoOr(o.lastSeenAt, firstSeenAt),
      occurrences: posInt(o.occurrences),
      ...(ref ? { entityRef: ref } : {}),
      ...(ackAt ? { acknowledgedAt: ackAt } : {}),
      ...(actAt ? { actedAt: actAt } : {}),
      ...(disAt ? { dismissedAt: disAt } : {}),
      ...(resAt ? { resolvedAt: resAt } : {}),
      ...(reason ? { dismissReason: reason } : {}),
      ...(rec ? { recommendation: rec } : {}),
      ...(metricAtAction ? { metricAtAction } : {}),
      ...(outcome ? { outcome } : {}),
    };
    out.push(insight);
  }
  return out.slice(0, MAX_INSIGHTS);
}
