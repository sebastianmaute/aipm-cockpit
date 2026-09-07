// Pure, i18n-free. The persisted insight record + its enums. Text is rendered
// from `type` + `data` by the React surfaces (never stored as prose), so this
// module is language-neutral.
import type { AppView } from "../nav-config";
import { TIMELOG_RULE_IDS } from "../timelog-types";

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
  /** ★ ABSENT when the insight simply stopped firing. The rule is that a
   *  DISAPPEARANCE carries no number: reconcile is handed the detections that
   *  fired, so a key that is missing from them yields nothing to read a current
   *  value from, whatever the type.
   *  ★★ For a THRESHOLD-gated detector, substituting 0 would not merely be
   *  unmeasured but WRONG — "cleared" there means BELOW THRESHOLD (stalledWork
   *  `count < 3`, budgetVariance `pct < 10`, raidAging `days < 7`, overdueTrend
   *  `current <= prior`), so `current: 0` overstates the delta (e.g. "improved
   *  by 10" for a real move of 8).
   *  ★★ The TimeLog guardrails are the case that does NOT follow from that
   *  second argument, and reading it as the whole reason is the trap: their
   *  metric counts VIOLATING DAYS with a floor of 1, so a cleared guardrail
   *  really is at zero. They stay direction-only because of the FIRST rule
   *  alone — the clear path reads no value for any type — and because the clear
   *  path never runs for them unless the caller certified the rule was
   *  evaluated over the stored violating days (see `reconcileInsights`'
   *  `isEvaluated`). Absent ⇒ direction is known, magnitude is not. */
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

/** The TimeLog guardrail members of `INSIGHT_TYPES`, as a set for the admission
 *  test in `reconcileInsights`. One reader today.
 *  ★★★ DERIVED FROM `TIMELOG_RULE_IDS`, NEVER RESPELLED — and that is the whole
 *  value of this constant, because the four literals already exist twice (the
 *  guardrail tail of `INSIGHT_TYPES` above, and `TIMELOG_RULE_IDS`). A third
 *  hand-written copy stood here and consolidated nothing; do not reintroduce
 *  one. Deriving makes drift a TYPE ERROR: rename a rule id without renaming
 *  the `InsightType` and `readonly TimelogRuleId[]` stops being assignable to
 *  `Iterable<InsightType>`, so tsc fails on THIS LINE (measured — TS2769 at the
 *  constructor call) rather than silently leaving a guardrail unrecognised.
 *  ★★ `timelog-policy.test.ts`'s type-level pin is a DIFFERENT and weaker
 *  guarantee and says nothing whatever about this set: it asserts only that
 *  every rule id is assignable to `InsightType`, one direction, so before this
 *  derivation existed a literal list here could gain `"stalledWork"` and
 *  compile clean. Membership is now structural — it comes FROM the rule ids and
 *  cannot be added to here at all. */
export const GUARDRAIL_INSIGHT_TYPES: ReadonlySet<InsightType> = new Set<InsightType>(
  TIMELOG_RULE_IDS,
);

/** Slots at `MAX_INSIGHTS` that guardrail rows may never take FIRST.
 *  ★★★ WHY IT EXISTS. Guardrail cardinality is up to 4 × (TimeLog users seen in
 *  a fetch) with no cap in `detect.ts` — `drain` emits one row per (rule, user),
 *  but only for ENABLED rules that actually fired for that user, so 4× is an
 *  upper bound rather than the cardinality. Every guardrail is `medium` while
 *  `overdueTrend` is the app's ONLY `low` detector. Under the comparator that
 *  singleton therefore sorts LAST and loses to every guardrail before ties are
 *  even reached, so an org-scope fetch of ~50 people pushed it out of the cap
 *  entirely — and once sliced away it is gone from `stored` and never returns.
 *  ★★★ WHAT IT ACTUALLY GUARANTEES IS NARROWER THAN "THE SINGLETON IS SAFE",
 *  and the difference is the load-bearing part. Pass one admits non-guardrails
 *  unconditionally and stops at `admitted === MAX_INSIGHTS`, so against a
 *  guardrail flood of at least the guardrail budget the LAST-SORTING row
 *  survives IF AND ONLY IF the number of OTHER non-guardrail rows is fewer than
 *  `RESERVED_NON_GUARDRAIL`. Below that flood the reservation does nothing at
 *  all, at any total size — the selection is the plain slice again.
 *  ★★ 60 IS A JUDGEMENT CALL ABOUT TYPICAL PROJECT SIZE, NOT A GUARANTEE. It is
 *  meant to cover a large project's `milestoneSlip` and `raidAging` sets plus
 *  the three singletons, and the resulting guardrail budget of 140 is 35 people
 *  across 4 rules — but `milestoneSlip` is one row per overdue milestone and
 *  `raidAging` one per aging RAID item, and NEITHER is bounded by anything in
 *  the repo. A project with 60 aging RAID items plus a 250-row guardrail fetch
 *  still loses `overdueTrend`, exactly as before this reservation existed.
 *  `reconcile.test.ts` pins that boundary as a pair, blind to the value.
 *  ★★ IT IS A FLOOR ON NON-GUARDRAIL CAPACITY, NOT A GUARDRAIL QUOTA. Reserved
 *  slots nobody claims are handed straight back, so a device with 300 guardrails
 *  and one core insight emits 199 guardrails, not 140. Reading it as a quota is
 *  how a test ends up asserting the shortened list `reconcileInsights`' second
 *  admission pass exists to prevent.
 *  ★★ INVARIANT: `0 ≤ RESERVED_NON_GUARDRAIL ≤ MAX_INSIGHTS`. Nothing enforces
 *  it and no runtime assertion is wanted, because outside that range the
 *  selection degrades SAFELY rather than corrupting anything: above the cap the
 *  budget goes negative, pass one defers every guardrail and pass two refills,
 *  still emitting exactly `MAX_INSIGHTS` rows in comparator order; below 0 the
 *  budget exceeds the cap and nothing is ever deferred. That is luck rather than
 *  design — keep it in range.
 *  ★★★ THE RESERVATION LIVES IN `reconcile.ts`, NOT IN `detect.ts`, AND THAT IS
 *  A SAFETY PROPERTY RATHER THAN A PREFERENCE. Capping the detector drops rows
 *  from `detected`, and `reconcileInsights` reads an absent row as "the
 *  condition cleared" unless `isEvaluated` says otherwise — see that argument's
 *  docstring on `reconcileInsights` for the mechanism and the fabricated
 *  outcome it produces; it is not restated here. Reserving at the cap drops
 *  nothing from the detection set, so no row can be re-read as cleared.
 *  ★★ It does NOT make the cap lossless, and it MOVES the loss UP. A frozen
 *  guardrail row can still be evicted here, and this reservation raises that
 *  pressure by as much as `RESERVED_NON_GUARDRAIL` slots — guardrails now
 *  compete for 140 where they had 200. open-followups §363 keeps that residue
 *  open deliberately, because losing a row is strictly better than fabricating
 *  an outcome for it. */
export const RESERVED_NON_GUARDRAIL = 60;
export const INSIGHT_DISMISS_REASON_MAX = 500;
export const INSIGHT_DATA_VALUE_MAX = 200;
export const INSIGHT_SEVERITY_RANK: Record<InsightSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};
