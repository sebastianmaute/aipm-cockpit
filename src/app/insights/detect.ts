// Pure, i18n-free deterministic insight DETECTION engine (SP1). Each detector
// REUSES an existing domain engine (never re-derives domain logic) and emits
// zero or more `DetectedInsight`s; reconcile/lifecycle lives elsewhere. `today`
// is always passed in — this module reads no clock.
import { milestoneStatus } from "../milestones";
import { isRaidActiveForReview } from "../raid-review";
import { isTaskFinished } from "../task-status";
import { partitionUpcoming } from "../dashboard";
import { computeBudgetReport } from "../budget-report";
import { resourceDisplayName } from "../resource-foundation";
import type { TimelogViolation } from "../timelog-policy";
import type { Task, Milestone, RaidItem, BudgetBucket, ResourcePlan, Role, Resource } from "../types";
import { INSIGHT_SEVERITY_RANK, type DetectedInsight, type InsightType } from "./insight";

/** The five detectors below that ALWAYS run — this module needs no
 *  configuration and no per-device cache to produce them, so their absence from
 *  a detection pass really does mean the condition cleared. Guardrail types are
 *  added to `reconcileInsights`'s evaluated set BY THE CALLER, and only when the
 *  rules were actually evaluated; see the doc comment on that function. */
export const CORE_INSIGHT_TYPES: readonly InsightType[] = [
  "milestoneSlip",
  "overdueTrend",
  "stalledWork",
  "budgetVariance",
  "raidAging",
];

// --- thresholds (pinned by detect.test.ts) ---------------------------------
export const MILESTONE_SLIP_MIN_REBASELINES = 2;
export const STALLED_WORK_MIN = 3;
export const BUDGET_VARIANCE_PCT = 10;
export const RAID_AGING_DAYS = 7;
// Mirrors the (unexported) STALE_DAYS in next-actions/providers/task-attention.ts.
// Kept in lockstep with that value — a task un-touched this long is "stale".
export const STALE_DAYS = 14;

// Assumed working-day length for the budget engine when no resource plan detail
// is available to this detector (variance is on stored budget-vs-actual HOURS,
// so the value only matters to cost math we do not read).
const BUDGET_WORKDAY_HOURS = 8;

/** Whole-day gap (from → to) for two YYYY-MM-DD (or ISO) strings; NaN if either
 *  is unparseable. Floor matches the task-attention/raid-review convention. */
function dayGap(fromISO: string, toISO: string): number {
  const from = Date.parse(fromISO);
  const to = Date.parse(toISO);
  if (Number.isNaN(from) || Number.isNaN(to)) return NaN;
  return Math.floor((to - from) / 86_400_000);
}

// --- milestoneSlip ---------------------------------------------------------
// NOTE: the Milestone entity carries no baseline date or rebaseline counter
// (`applyMilestoneRebaseline` just overwrites `date`), so the rebaseline arm is
// undetectable from this input — we fire on overdue-vs-target only, reusing the
// milestone engine's own overdue rule. MILESTONE_SLIP_MIN_REBASELINES is
// exported for a later SP that has snapshot history.
function milestoneSlipInsights(
  milestones: readonly Milestone[],
  tasks: readonly Task[],
  today: string,
  holidaySet: ReadonlySet<string>,
): DetectedInsight[] {
  const tasksById = new Map<number, Task>(tasks.map((t) => [t.id, t]));
  const out: DetectedInsight[] = [];
  for (const m of milestones) {
    if (milestoneStatus(m, tasksById, today, holidaySet) !== "overdue") continue;
    out.push({
      key: `milestoneSlip:${m.id}`,
      type: "milestoneSlip",
      severity: "high",
      entityRef: { view: "milestones", id: m.id },
      // Guard NaN (unparseable date) → 0, consistent with the sibling detectors;
      // NaN would serialize to null in the persisted blob.
      data: { name: m.name, date: m.date, daysOverdue: Math.max(0, dayGap(m.date, today) || 0) },
    });
  }
  return out;
}

// --- overdueTrend ----------------------------------------------------------
function overdueTrendInsight(
  tasks: readonly Task[],
  priorOverdueCount: number | null,
  today: string,
  holidaySet: ReadonlySet<string>,
): DetectedInsight | null {
  if (priorOverdueCount === null) return null;
  const current = partitionUpcoming(tasks, today, holidaySet).overdue.length;
  if (current <= priorOverdueCount) return null;
  return {
    key: "overdueTrend",
    type: "overdueTrend",
    severity: "low",
    data: { current, prior: priorOverdueCount, delta: current - priorOverdueCount },
  };
}

// --- stalledWork -----------------------------------------------------------
// Replicates the stale/blocked/dep-blocked predicates of the task-attention
// provider (unassigned is intentionally excluded — that is a routing gap, not
// stalled work), counting DISTINCT active tasks in one of those states.
function isStalled(task: Task, byId: ReadonlyMap<number, Task>, today: string): boolean {
  if (isTaskFinished(task)) return false;
  const days = dayGap(task.lastUpdateDate, today);
  if (Number.isFinite(days) && days >= STALE_DAYS) return true;
  if (task.blockers.trim() !== "") return true;
  // First unfinished FS predecessor (SS/FF/SF are overlaps, not start-blockers).
  return (task.dependencies ?? []).some((d) => {
    const pred = byId.get(d.taskId);
    return d.type === "FS" && d.taskId !== task.id && pred != null && !isTaskFinished(pred);
  });
}

function stalledWorkInsight(tasks: readonly Task[], today: string): DetectedInsight | null {
  const byId = new Map<number, Task>(tasks.map((t) => [t.id, t]));
  let count = 0;
  for (const t of tasks) if (isStalled(t, byId, today)) count++;
  if (count < STALLED_WORK_MIN) return null;
  return { key: "stalledWork", type: "stalledWork", severity: "medium", data: { count } };
}

// --- budgetVariance --------------------------------------------------------
// Reuses computeBudgetReport for the real budget-vs-actual HOURS figures, then
// flags the worst bucket whose |variance %| meets the threshold. Singleton.
function budgetVarianceInsight(
  budgets: readonly BudgetBucket[],
  plan: ResourcePlan | null,
  roles: readonly Role[],
  resources: readonly Resource[],
  holidaySet: ReadonlySet<string>,
): DetectedInsight | null {
  if (plan === null || budgets.length === 0) return null;
  // roles/resources are forwarded so that when plan.budgetFollowsPlan is true the
  // engine derives real budget HOURS from planned capacity (empty resources would
  // collapse budgetHours to 0 and silently drop the overrun).
  const report = computeBudgetReport(budgets, plan, roles, resources, BUDGET_WORKDAY_HOURS, holidaySet, []);
  let worstName = "";
  let worstPct = 0;
  let breaching = 0;
  for (const b of report.buckets) {
    if (b.budgetHours <= 0) continue;
    const pct = Math.abs(((b.actualHours - b.budgetHours) / b.budgetHours) * 100);
    if (pct < BUDGET_VARIANCE_PCT) continue;
    breaching++;
    if (pct > worstPct) { worstPct = pct; worstName = b.name; }
  }
  if (breaching === 0) return null;
  return {
    key: "budgetVariance",
    type: "budgetVariance",
    severity: "medium",
    data: { name: worstName, variancePct: Math.round(worstPct), buckets: breaching },
  };
}

// --- raidAging -------------------------------------------------------------
/** Last-touch date (YYYY-MM-DD): mirrors raid-review.ts `lastTouch` —
 *  localModifiedAt date part, else raisedDate. */
function raidLastTouch(item: RaidItem): string {
  return item.localModifiedAt ? item.localModifiedAt.slice(0, 10) : item.raisedDate;
}

function raidAgingInsights(raid: readonly RaidItem[], today: string): DetectedInsight[] {
  const out: DetectedInsight[] = [];
  for (const item of raid) {
    if (!isRaidActiveForReview(item)) continue;
    if (!item.targetDate || item.targetDate >= today) continue;
    const daysSinceUpdate = dayGap(raidLastTouch(item), today);
    if (!Number.isFinite(daysSinceUpdate) || daysSinceUpdate < RAID_AGING_DAYS) continue;
    out.push({
      key: `raidAging:${item.id}`,
      type: "raidAging",
      severity: "medium",
      entityRef: { view: "raid", id: item.id },
      data: { name: item.title, targetDate: item.targetDate, daysSinceUpdate },
    });
  }
  return out;
}

// --- timelog guardrails ----------------------------------------------------
/** Guardrail violations → insights. Aggregation already happened in
 *  `timelog-policy.ts`; this only names the person and attaches the ref.
 *  Severity is uniform: a cap breach is a review prompt, not a ranking.
 *  ★ `count` is load-bearing beyond the sentence — it is the `METRIC_FIELD`
 *  for all four types, so an outcome delta reads null without it. */
function timelogGuardrailInsights(
  violations: readonly TimelogViolation[] | null,
  resources: readonly Resource[],
): DetectedInsight[] {
  if (violations === null) return [];
  const byId = new Map<number, Resource>(resources.map((r) => [r.id, r]));
  return violations.map((v) => {
    // A DANGLING resourceId resolves to nothing and is treated exactly like an
    // absent link: InsightEntityRef promises a real workspace row, and the
    // recommendation-replay path resolves it as one.
    const resource = v.resourceId === null ? undefined : byId.get(v.resourceId);
    return {
      key: `timelog:${v.rule}:${v.timelogUserId}`,
      type: v.rule,
      severity: "medium" as const,
      ...(resource !== undefined ? { entityRef: { view: "resources" as const, id: resource.id } } : {}),
      data: {
        person: resource === undefined ? `#${v.timelogUserId}` : resourceDisplayName(resource),
        count: v.count,
        worstHours: v.worstHours,
        threshold: v.threshold,
        // ★★ Carried so a later reconcile can ask which DAYS this insight was
        // about. The roll behind it is a per-device window-and-scope snapshot,
        // so "the rule ran and found nothing" is only a real clean when the
        // roll still covered these days. `sanitizeData` keeps any string value
        // (sliced to INSIGHT_DATA_VALUE_MAX), so ISO dates survive every load
        // path with no sanitiser change. ★ Not read by `insightMetricValue`,
        // which takes only METRIC_FIELD (`count`) — these widen the record, not
        // the measurement.
        firstViolationDate: v.firstViolationDate,
        lastViolationDate: v.lastViolationDate,
      },
    };
  });
}

export interface InsightInput {
  readonly tasks: readonly Task[];
  readonly milestones: readonly Milestone[];
  readonly raid: readonly RaidItem[];
  /** Budget buckets — [] when there is no real plan. */
  readonly budgets: readonly BudgetBucket[];
  /** Rate card + directory — forwarded to the budget engine so budgetFollowsPlan
   *  buckets derive real capacity-based budget hours. */
  readonly roles: readonly Role[];
  readonly resources: readonly Resource[];
  readonly plan: ResourcePlan | null;
  /** Overdue-task count from the last visit/snapshot; null when unknown. */
  readonly priorOverdueCount: number | null;
  /** Pre-computed guardrail violations, or null when the rules could not run
   *  (no daily roll on this device). This module never learns what a booking
   *  is — same null-when-unknown shape as `priorOverdueCount`. */
  readonly timelogViolations: readonly TimelogViolation[] | null;
  readonly holidaySet: ReadonlySet<string>;
}

/** Run every detector and return the merged list, ordered severity desc then
 *  key asc. Pure — `today` supplied by the caller. */
export function detectInsights(input: InsightInput, today: string): DetectedInsight[] {
  const out: DetectedInsight[] = [
    ...milestoneSlipInsights(input.milestones, input.tasks, today, input.holidaySet),
    ...raidAgingInsights(input.raid, today),
  ];
  const trend = overdueTrendInsight(input.tasks, input.priorOverdueCount, today, input.holidaySet);
  if (trend) out.push(trend);
  const stalled = stalledWorkInsight(input.tasks, today);
  if (stalled) out.push(stalled);
  const budget = budgetVarianceInsight(input.budgets, input.plan, input.roles, input.resources, input.holidaySet);
  if (budget) out.push(budget);
  out.push(...timelogGuardrailInsights(input.timelogViolations, input.resources));

  out.sort(
    (a, b) =>
      INSIGHT_SEVERITY_RANK[a.severity] - INSIGHT_SEVERITY_RANK[b.severity] ||
      a.key.localeCompare(b.key),
  );
  return out;
}
