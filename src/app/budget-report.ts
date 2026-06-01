import {
  absencesForResource, displayCapacityHours, generatePeriods, type Period,
} from "./resource-capacity";
import type {
  Absence, BudgetBucket, PlanGranularity,
  Resource, ResourcePlan, Role,
} from "./types";
import { blendedDisciplineRate, effectiveRates, type RatePair } from "./budget-rates";

/** Plan periods whose start falls within the bucket's [startDate,endDate]. */
export function bucketActivePeriods(bucket: Pick<BudgetBucket, "startDate" | "endDate">, plan: ResourcePlan): Period[] {
  const all = generatePeriods(plan.startDate, plan.endDate, plan.granularity);
  if (!bucket.startDate || !bucket.endDate) return all;
  return all.filter((p) => p.start >= bucket.startDate && p.start <= bucket.endDate);
}

/** Planned hours for one allocation in one period = sum of capacity of its resources. */
export function allocationPlannedHours(
  alloc: { resourceIds: readonly number[] },
  period: Period,
  canonicalPeriods: readonly Period[],
  resources: readonly Resource[],
  workdayHours: number,
  holidaySet: ReadonlySet<string>,
  granularity: PlanGranularity,
  absences: readonly Absence[] = [],
): number {
  const byId = new Map(resources.map((r) => [r.id, r]));
  let sum = 0;
  for (const rid of alloc.resourceIds) {
    const r = byId.get(rid);
    if (!r) continue;
    const resAbs = absencesForResource(absences, r);
    sum += displayCapacityHours(period, canonicalPeriods, r, resAbs, workdayHours, holidaySet, granularity, granularity);
  }
  return sum;
}

/** Sum a periodKey -> number map over a set of period keys (or all when omitted). */
function sumPeriodMap(map: Record<string, number>, keys?: readonly string[]): number {
  if (!keys) return Object.values(map).reduce((a, b) => a + b, 0);
  let s = 0;
  for (const k of keys) s += map[k] ?? 0;
  return s;
}

/** Resolve the Role for an allocation. */
function roleFor(roleId: number, roles: readonly Role[]): Role | undefined {
  return roles.find((r) => r.id === roleId);
}

/** A CCI value: an absolute amount (EUR) and a percent, or null when the
 *  denominator is 0 (rendered as "-"). */
export type CciValue = { amount: number; percent: number | null };

export type BucketReport = {
  bucketId: number;
  name: string;
  currency: BudgetBucket["currency"];
  type: BudgetBucket["type"];
  status: BudgetBucket["status"];
  budgetHours: number;
  plannedHours: number;
  actualHours: number;
  /** All amounts in EUR (converted to bucket currency only at display). */
  budgetValue: number;
  consumedValue: number;
  revenue: number;
  cost: number;
  /** internal-rate cost of the budgeted hours (used for the project CPI rollup). */
  budgetCost: number;
  winLossHours: number;
  winLossValue: number;
  /** Remaining budget rolled in from a closed predecessor (EUR + hours). */
  spilloverInHours: number;
  spilloverInValue: number;
  contributionMargin: CciValue;
  costPerformance: CciValue;
  consumption: CciValue;
};

function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return (numerator / denominator) * 100;
}

type RateRow = {
  rates: RatePair;
  budgetHours: Record<string, number>;
  actualHours: Record<string, number>;
  resourceIds: readonly number[];
};

/** Uniform rate-bearing rows for a bucket: from disciplineAllocations (blended)
 *  or allocations (detailed). Each row's rate honors the per-bucket override. */
function bucketRateRows(bucket: BudgetBucket, roles: readonly Role[]): RateRow[] {
  if (bucket.planningMode === "blended") {
    return (bucket.disciplineAllocations ?? []).map((a) => ({
      rates: effectiveRates(bucket, blendedDisciplineRate(a.disciplineId, roles)),
      budgetHours: a.budgetHours,
      actualHours: a.actualHours,
      resourceIds: a.resourceIds,
    }));
  }
  return bucket.allocations.map((a) => {
    const role = roleFor(a.roleId, roles);
    return {
      rates: effectiveRates(bucket, { internal: role?.internalRate ?? 0, external: role?.externalRate ?? 0 }),
      budgetHours: a.budgetHours,
      actualHours: a.actualHours,
      resourceIds: a.resourceIds,
    };
  });
}

/**
 * Compute a single bucket's report. All money is in EUR (role rates are EUR).
 * `spilloverInHours`/`spilloverInValue` are the remaining budget rolled in
 * from a closed predecessor; the caller supplies them.
 */
export function computeBucketReport(
  bucket: BudgetBucket,
  plan: ResourcePlan,
  roles: readonly Role[],
  resources: readonly Resource[],
  workdayHours: number,
  holidaySet: ReadonlySet<string>,
  spilloverInHours = 0,
  spilloverInValue = 0,
  absences: readonly Absence[] = [],
): BucketReport {
  const periods = bucketActivePeriods(bucket, plan);
  const keys = periods.map((p) => p.key);

  let budgetHours = 0;
  let actualHours = 0;
  let plannedHours = 0;
  let cost = 0;
  let tmRevenue = 0;
  let budgetValueExternal = 0;
  let budgetCost = 0;

  const rows = bucketRateRows(bucket, roles);
  for (const row of rows) {
    const { internal, external } = row.rates;
    const aBudget = sumPeriodMap(row.budgetHours, keys);
    const aActual = sumPeriodMap(row.actualHours, keys);
    budgetHours += aBudget;
    actualHours += aActual;
    cost += aActual * internal;
    tmRevenue += aActual * external;
    budgetValueExternal += aBudget * external;
    budgetCost += aBudget * internal;
    for (const p of periods) {
      plannedHours += allocationPlannedHours(row, p, periods, resources, workdayHours, holidaySet, plan.granularity, absences);
    }
  }

  const isFixed = bucket.type === "fixed";
  const fixedPrice = bucket.fixedPriceAmount ?? 0;

  const revenue = isFixed ? fixedPrice : tmRevenue;
  // Spillover adds available budget to a T&M bucket; a fixed-price bucket's
  // budget IS the contract amount and is not inflated by spilled-in value.
  const budgetValue = isFixed ? fixedPrice : budgetValueExternal + spilloverInValue;
  const consumedValue = isFixed
    ? (budgetHours > 0 ? Math.min(fixedPrice, fixedPrice * (actualHours / budgetHours)) : 0)
    : tmRevenue;

  const winLossHours = budgetHours + spilloverInHours - actualHours;
  const winLossValue = isFixed ? revenue - cost : budgetValue - consumedValue;

  // For fixed-price with no budgeted hours, consumption % is meaningless.
  const consumptionPercent = isFixed && budgetHours === 0 ? null : pct(consumedValue, budgetValue);

  return {
    bucketId: bucket.id, name: bucket.name, currency: bucket.currency,
    type: bucket.type, status: bucket.status,
    budgetHours: budgetHours + spilloverInHours, plannedHours, actualHours,
    budgetValue, consumedValue, revenue, cost, budgetCost,
    winLossHours, winLossValue,
    spilloverInHours, spilloverInValue,
    contributionMargin: { amount: revenue - cost, percent: pct(revenue - cost, revenue) },
    costPerformance: { amount: budgetCost - cost, percent: pct(budgetCost, cost) },
    consumption: { amount: budgetValue - consumedValue, percent: consumptionPercent },
  };
}

export type ProjectReport = {
  budgetHours: number;
  plannedHours: number;
  actualHours: number;
  budgetValue: number;
  consumedValue: number;
  revenue: number;
  cost: number;
  winLossHours: number;
  winLossValue: number;
  contributionMargin: CciValue;
  costPerformance: CciValue;
  consumption: CciValue;
};

export type BudgetReport = {
  buckets: BucketReport[];
  project: ProjectReport;
};

/**
 * Spillover-in amounts per bucket: a CLOSED bucket with a successor contributes
 * its remaining budget (budget - actual hours, and the EUR value) to the
 * successor. Single hop (no transitive chains); self-refs and missing
 * successors are ignored. Returns maps keyed by successor bucket id.
 */
function computeSpillover(
  buckets: readonly BudgetBucket[],
  plan: ResourcePlan,
  roles: readonly Role[],
  resources: readonly Resource[],
  workdayHours: number,
  holidaySet: ReadonlySet<string>,
): { hours: Map<number, number>; value: Map<number, number> } {
  const hours = new Map<number, number>();
  const value = new Map<number, number>();
  const ids = new Set(buckets.map((b) => b.id));
  for (const b of buckets) {
    if (b.status !== "closed" || b.successorId == null) continue;
    if (b.successorId === b.id || !ids.has(b.successorId)) continue;
    const rep = computeBucketReport(b, plan, roles, resources, workdayHours, holidaySet);
    hours.set(b.successorId, (hours.get(b.successorId) ?? 0) + rep.winLossHours);
    value.set(b.successorId, (value.get(b.successorId) ?? 0) + (rep.budgetValue - rep.consumedValue));
  }
  return { hours, value };
}

export function computeBudgetReport(
  buckets: readonly BudgetBucket[],
  plan: ResourcePlan,
  roles: readonly Role[],
  resources: readonly Resource[],
  workdayHours: number,
  holidaySet: ReadonlySet<string>,
  absences: readonly Absence[] = [],
): BudgetReport {
  const spill = computeSpillover(buckets, plan, roles, resources, workdayHours, holidaySet);
  // Spillover is built from `successorId` links and keyed by bucket id, so it
  // is order-independent. Sorting a COPY only affects the produced report order.
  const ordered = [...buckets].sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id));
  const reports = ordered.map((b) =>
    computeBucketReport(
      b, plan, roles, resources, workdayHours, holidaySet,
      spill.hours.get(b.id) ?? 0, spill.value.get(b.id) ?? 0, absences,
    ),
  );

  const sum = (sel: (r: BucketReport) => number) => reports.reduce((a, r) => a + sel(r), 0);
  const revenue = sum((r) => r.revenue);
  const cost = sum((r) => r.cost);
  const budgetValue = sum((r) => r.budgetValue);
  const consumedValue = sum((r) => r.consumedValue);
  const budgetCost = sum((r) => r.budgetCost);

  const project: ProjectReport = {
    budgetHours: sum((r) => r.budgetHours),
    plannedHours: sum((r) => r.plannedHours),
    actualHours: sum((r) => r.actualHours),
    budgetValue, consumedValue, revenue, cost,
    winLossHours: sum((r) => r.winLossHours),
    winLossValue: sum((r) => r.winLossValue),
    contributionMargin: { amount: revenue - cost, percent: pct(revenue - cost, revenue) },
    costPerformance: { amount: budgetCost - cost, percent: pct(budgetCost, cost) },
    consumption: { amount: budgetValue - consumedValue, percent: pct(consumedValue, budgetValue) },
  };
  return { buckets: reports, project };
}

export type BucketReminder = {
  bucket: BudgetBucket;
  category: "overdue" | "today" | "soon";
  daysLeft: number; // negative when overdue
};

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

/**
 * Open buckets whose end date is overdue, today, or within `leadDays` calendar
 * days of `today`. Sorted by end date ascending. Closed buckets are skipped.
 */
export function getBucketReminders(
  buckets: readonly BudgetBucket[],
  leadDays: number,
  today: string,
): BucketReminder[] {
  const out: BucketReminder[] = [];
  for (const bucket of buckets) {
    if (bucket.status === "closed" || !bucket.endDate) continue;
    const left = daysBetween(today, bucket.endDate);
    if (left < 0) out.push({ bucket, category: "overdue", daysLeft: left });
    else if (left === 0) out.push({ bucket, category: "today", daysLeft: 0 });
    else if (left <= leadDays) out.push({ bucket, category: "soon", daysLeft: left });
  }
  out.sort((a, b) => a.bucket.endDate.localeCompare(b.bucket.endDate));
  return out;
}
