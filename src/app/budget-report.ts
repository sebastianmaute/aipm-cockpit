import {
  absencesForResource, displayCapacityHours, generatePeriods, type Period,
} from "./resource-capacity";
import type {
  Absence, BudgetBucket, BucketAllocation, PlanGranularity,
  Resource, ResourcePlan, Role,
} from "./types";

/** Plan periods whose start falls within the bucket's [startDate,endDate]. */
export function bucketActivePeriods(bucket: Pick<BudgetBucket, "startDate" | "endDate">, plan: ResourcePlan): Period[] {
  const all = generatePeriods(plan.startDate, plan.endDate, plan.granularity);
  if (!bucket.startDate || !bucket.endDate) return all;
  return all.filter((p) => p.start >= bucket.startDate && p.start <= bucket.endDate);
}

/** Planned hours for one allocation in one period = sum of capacity of its resources. */
export function allocationPlannedHours(
  alloc: BucketAllocation,
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
export function sumPeriodMap(map: Record<string, number>, keys?: readonly string[]): number {
  if (!keys) return Object.values(map).reduce((a, b) => a + b, 0);
  let s = 0;
  for (const k of keys) s += map[k] ?? 0;
  return s;
}

/** Resolve the Role for an allocation. */
export function roleFor(roleId: number, roles: readonly Role[]): Role | undefined {
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

  for (const alloc of bucket.allocations) {
    const role = roleFor(alloc.roleId, roles);
    const internal = role?.internalRate ?? 0;
    const external = role?.externalRate ?? 0;
    const aBudget = sumPeriodMap(alloc.budgetHours, keys);
    const aActual = sumPeriodMap(alloc.actualHours, keys);
    budgetHours += aBudget;
    actualHours += aActual;
    cost += aActual * internal;
    tmRevenue += aActual * external;
    budgetValueExternal += aBudget * external;
    budgetCost += aBudget * internal;
    for (const p of periods) {
      plannedHours += allocationPlannedHours(alloc, p, periods, resources, workdayHours, holidaySet, plan.granularity, absences);
    }
  }

  const isFixed = bucket.type === "fixed";
  const fixedPrice = bucket.fixedPriceAmount ?? 0;

  const revenue = isFixed ? fixedPrice : tmRevenue;
  const budgetValue = (isFixed ? fixedPrice : budgetValueExternal) + spilloverInValue;
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
