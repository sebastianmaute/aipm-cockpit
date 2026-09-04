// Pure, i18n-free. The persisted insight record + its enums. Text is rendered
// from `type` + `data` by the React surfaces (never stored as prose), so this
// module is language-neutral.
import type { AppView } from "../nav-config";

export const INSIGHT_TYPES = [
  "milestoneSlip",
  "overdueTrend",
  "stalledWork",
  "budgetVariance",
  "raidAging",
  // TimeLog guardrails. These four literals are ALSO `TimelogRuleId` — kept
  // deliberately identical so no rule-to-type lookup table exists to drift.
  // `timelog-policy.test.ts` pins the identity with a type-level assertion.
  "timelogCapPerEntry",
  "timelogCapPerDay",
  "timelogNonWorkingDay",
  "timelogWorkingHours",
] as const;
export type InsightType = (typeof INSIGHT_TYPES)[number];

export const INSIGHT_SEVERITIES = ["high", "medium", "low"] as const;
export type InsightSeverity = (typeof INSIGHT_SEVERITIES)[number];

export const INSIGHT_STATUSES = [
  "active",
  "acknowledged",
  "acted",
  "dismissed",
  "resolved",
] as const;
export type InsightStatus = (typeof INSIGHT_STATUSES)[number];

export interface InsightEntityRef {
  readonly view: AppView;
  readonly id: number;
}

export interface Insight {
  readonly id: number;
  readonly key: string;
  readonly type: InsightType;
  readonly severity: InsightSeverity;
  readonly entityRef?: InsightEntityRef;
  readonly data: Readonly<Record<string, string | number>>;
  readonly status: InsightStatus;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly occurrences: number;
  readonly acknowledgedAt?: string;
  readonly actedAt?: string;
  readonly dismissedAt?: string;
  readonly resolvedAt?: string;
  readonly dismissReason?: string;
  /** Baseline metric captured at the FIRST transition to `acted` (SP3). */
  readonly metricAtAction?: Readonly<Record<string, number>>;
  readonly recommendation?: InsightRecommendation;
  /** Measured outcome vs `metricAtAction` (SP3). Derived — reconcile owns it. */
  readonly outcome?: InsightOutcome;
}

/** A tool call the AI proposed as part of a recommendation. Mirrors the shape
 *  of an Anthropic tool_use block, narrowed to what a recommendation needs. */
export interface InsightToolCall {
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export const INSIGHT_REC_STATUSES = ["proposed", "applied", "rejected"] as const;
export type InsightRecommendationStatus = (typeof INSIGHT_REC_STATUSES)[number];

/** A persisted AI recommendation attached to an insight (SP2). */
export interface InsightRecommendation {
  readonly summary: string;
  readonly proposedCalls: readonly InsightToolCall[];
  readonly generatedAt: string;
  readonly status: InsightRecommendationStatus;
  readonly appliedSummary?: string;
  readonly appliedAt?: string;
}

export const INSIGHT_OUTCOME_DIRECTIONS = ["improved", "unchanged", "worsened"] as const;
export type InsightOutcomeDirection = (typeof INSIGHT_OUTCOME_DIRECTIONS)[number];

/** SP3 outcome measurement: the acted-on baseline vs the live metric. */
export interface InsightOutcome {
  readonly direction: InsightOutcomeDirection;
  readonly baseline: number;
  /** ★ ABSENT when the insight simply stopped firing. Four of the five detectors
   *  are THRESHOLD-gated (stalledWork `count < 3`, budgetVariance `pct < 10`,
   *  raidAging `days < 7`, overdueTrend `current <= prior`), so "cleared" means
   *  BELOW THRESHOLD, not zero — and reconcile has no detection left to read the
   *  true value from. Reporting `current: 0` there would overstate the delta
   *  (e.g. "improved by 10" for a real move of 8). Absent ⇒ direction is known,
   *  magnitude is not. */
  readonly current?: number;
  /** baseline − current. Positive ⇒ better (ALL insight metrics are
   *  lower-is-better). Absent whenever `current` is. */
  readonly delta?: number;
  readonly measuredAt: string;
}

export const INSIGHT_REC_SUMMARY_MAX = 500;
export const INSIGHT_REC_MAX_CALLS = 5;
export const INSIGHT_REC_TOOL_NAME_MAX = 60;
export const MAX_BG_RECS_PER_TICK = 3;

/** Safe, non-destructive write tools an AI insight recommendation may propose.
 *  This allow-set is the security boundary for the recommendation flow and is
 *  enforced at THREE points: generation (parseRecommendation), load (sanitizeInsights),
 *  and apply (task-manager) — a persisted/imported blob must never smuggle a
 *  destructive tool (delete_*, update_settings) past any of them. Lives on this
 *  leaf module so the sanitizer can import it without pulling in action-ai. */
export const ALLOWED_REC_TOOLS: ReadonlySet<string> = new Set([
  "update_task",
  "create_task",
  "update_raid_item",
  "create_raid_item",
  "update_milestone",
  "create_milestone",
  "update_change",
  "create_change",
  "update_stakeholder",
  "create_stakeholder",
]);

/** Lifecycle callbacks a surface (dashboard card, Insights view) invokes to
 *  advance an insight's status. Threaded from task-manager, which owns the
 *  `setInsights` writer and the entity deep-link channel. */
export interface InsightActions {
  readonly onAcknowledge: (id: number) => void;
  readonly onAct: (id: number) => void;
  readonly onDismiss: (id: number, reason?: string) => void;
  /** RESERVED for SP2 — real handlers land in Task 9. */
  readonly onGenerateRecommendation: (id: number) => void;
  readonly onApplyRecommendation: (id: number) => void;
  readonly onRejectRecommendation: (id: number) => void;
}

/** A fresh detection (no lifecycle/timestamps — reconcile owns those). */
export interface DetectedInsight {
  readonly key: string;
  readonly type: InsightType;
  readonly severity: InsightSeverity;
  readonly entityRef?: InsightEntityRef;
  readonly data: Readonly<Record<string, string | number>>;
}

export const MAX_INSIGHTS = 200;
export const INSIGHT_DISMISS_REASON_MAX = 500;
export const INSIGHT_DATA_VALUE_MAX = 200;
export const INSIGHT_SEVERITY_RANK: Record<InsightSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};
