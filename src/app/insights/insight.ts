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
  /** RESERVED for SP3 outcome feedback; unused in SP1. */
  readonly metricAtAction?: Readonly<Record<string, number>>;
}

/** Lifecycle callbacks a surface (dashboard card, Insights view) invokes to
 *  advance an insight's status. Threaded from task-manager, which owns the
 *  `setInsights` writer and the entity deep-link channel. */
export interface InsightActions {
  readonly onAcknowledge: (id: number) => void;
  readonly onAct: (id: number) => void;
  readonly onDismiss: (id: number, reason?: string) => void;
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
