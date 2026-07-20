// Pure, i18n-free. The SINGLE validator for the persisted insight list. Never
// throws — bad records are dropped, bad fields coerced/dropped. Mirrors the
// defensive posture of sanitizeKnowledgeItems.
import {
  INSIGHT_TYPES, INSIGHT_SEVERITIES, INSIGHT_STATUSES, INSIGHT_REC_STATUSES,
  MAX_INSIGHTS, INSIGHT_DISMISS_REASON_MAX, INSIGHT_DATA_VALUE_MAX,
  INSIGHT_REC_SUMMARY_MAX, INSIGHT_REC_MAX_CALLS, INSIGHT_REC_TOOL_NAME_MAX, ALLOWED_REC_TOOLS,
  type Insight, type InsightType, type InsightSeverity, type InsightStatus,
  type InsightEntityRef, type InsightRecommendation,
  type InsightRecommendationStatus, type InsightToolCall,
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
    };
    out.push(insight);
  }
  return out.slice(0, MAX_INSIGHTS);
}
