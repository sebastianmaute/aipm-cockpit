import {
  absencesForResource, displayCapacityHours, generatePeriods, type Period,
} from "./resource-capacity";
import type {
  Absence, BudgetBucket, PlanGranularity,
  Resource, ResourcePlan, Role,
} from "./types";
import { blendedDisciplineRate, effectiveRates, type RatePair } from "./budget-rates";
import { RATIO_EPSILON } from "./budget-health";

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
  // Optional pre-built id→resource index. Pass it when calling per allocation×
  // period (the report loop, the budget cell) to avoid rebuilding the map on
  // every call; omitted, it is built from `resources` (back-compat default).
  byId?: ReadonlyMap<number, Resource>,
): number {
  const idx = byId ?? new Map(resources.map((r) => [r.id, r]));
  let sum = 0;
  for (const rid of alloc.resourceIds) {
    const r = idx.get(rid);
    if (!r) continue;
    // External resources are planned/capacity-tracked elsewhere but excluded
    // from all budget figures — including the budget report's planned hours.
    if (r.isExternal) continue;
    const resAbs = absencesForResource(absences, r);
    sum += displayCapacityHours(period, canonicalPeriods, r, resAbs, workdayHours, holidaySet, granularity, granularity);
  }
  return sum;
}

/**
 * The effective per-period BUDGET hours for an allocation: the live planned
 * capacity when the plan's budget follows planning AND the allocation has
 * resources, else the stored `budgetHours` entry. This is the SINGLE rule the
 * budget cell and every budget aggregate share, so they can never diverge.
 */
export function effectiveBudgetHours(
  alloc: { resourceIds: readonly number[]; budgetHours: Record<string, number> },
  period: Period,
  canonicalPeriods: readonly Period[],
  resources: readonly Resource[],
  workdayHours: number,
  holidaySet: ReadonlySet<string>,
  granularity: PlanGranularity,
  absences: readonly Absence[],
  budgetFollowsPlan: boolean,
  byId?: ReadonlyMap<number, Resource>,
): number {
  if (budgetFollowsPlan && alloc.resourceIds.length > 0) {
    return allocationPlannedHours(alloc, period, canonicalPeriods, resources, workdayHours, holidaySet, granularity, absences, byId);
  }
  return alloc.budgetHours[period.key] ?? 0;
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
  /** True when this bucket's budget hours ARE its planned hours (follow-plan on
   *  and every row resourced). The Plan-vs-Budget badge is then a comparison of
   *  a number with itself and carries no information — surfaces do not render it. */
  budgetMirrorsPlan: boolean;
  /** False when this bucket's internal-cost figures (cost, margin, burn) have no
   *  sound basis: no rows at all, no row carrying a rate, or ANY row booking
   *  hours at a zero rate. That last case is the dangerous one — those hours are
   *  costed at 0, so the figure is not unknown but WRONG. Surfaces must render
   *  all three as unknown; a 0 cost otherwise reads as a perfect margin. */
  costIsKnowable: boolean;
  /** True when rows EXIST and a rate is genuinely missing — none carries one, or
   *  some row books hours at none. An empty bucket is false: it has no roles to
   *  rate, so that guidance would point at the wrong problem. */
  ratesAreMissing: boolean;
};

function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return (numerator / denominator) * 100;
}

export type RateRow = {
  rates: RatePair;
  budgetHours: Record<string, number>;
  actualHours: Record<string, number>;
  resourceIds: readonly number[];
};

/** Uniform rate-bearing rows for a bucket: from disciplineAllocations (blended)
 *  or allocations (detailed). Each row's rate honors the per-bucket override. */
export function bucketRateRows(bucket: BudgetBucket, roles: readonly Role[]): RateRow[] {
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

  // When the plan's budget follows planning, a resourced row's budget hours
  // ARE the planned hours (the read-only cell the panel shows) — so cost, CCI,
  // RAG, win/loss and the project rollup all follow planned too. Off, or a
  // resource-less row → the stored budgetHours map, as before.
  const budgetFollowsPlan = plan.budgetFollowsPlan ?? false;
  // Built once and threaded into the per-row×period planned/budget helpers so
  // they don't rebuild the id→resource index on every cell.
  const resourcesById = new Map(resources.map((r) => [r.id, r]));
  const rows = bucketRateRows(bucket, roles);
  // TWO flags, because there are two different questions and three states.
  //
  // `costIsKnowable` — is there any basis for a cost figure? Needs BOTH rows and
  // a rate. `role?.internalRate ?? 0` and a 0 bucket override are
  // indistinguishable from a genuinely free resource and collapse cost to 0,
  // which reads as a perfect margin; so does an empty bucket, where there is
  // simply nothing to sum. An unstaffed fixed-price contract otherwise reports
  // revenue − 0 = a 100% margin and a full win before anyone has started.
  //
  // `ratesAreMissing` — should we tell the user to go fix the rate card? When
  // rows EXIST and either none carries a rate, or some row books hours at no
  // rate. A bucket with no allocations has no roles to rate, so that guidance
  // would point at the wrong problem.
  //
  // Collapsing these into one boolean is what let the empty fixed-price bucket
  // through: suppressing the notice and licensing the figure are not the same
  // decision.
  const hasRatedRow = rows.some((r) => r.rates.internal > 0);
  const rowsMirrorPlan =
    budgetFollowsPlan && rows.length > 0 && rows.every((r) => r.resourceIds.length > 0);
  // A row corrupts the totals only when it carries HOURS at a zero internal
  // rate: those hours land in `cost`/`budgetCost` as 0 and the resulting margin
  // is not unknown but WRONG. `hasRatedRow` alone let one rated row vouch for
  // the whole bucket, so 40 booked hours against an unrated role read as a
  // sound 100% margin. An unrated row with no hours contributes nothing and
  // must NOT blank an otherwise sound figure.
  let uncostedWork = false;
  for (const row of rows) {
    const { internal, external } = row.rates;
    let aBudget = 0;
    const aActual = sumPeriodMap(row.actualHours, keys);
    for (const p of periods) {
      aBudget += effectiveBudgetHours(row, p, periods, resources, workdayHours, holidaySet, plan.granularity, absences, budgetFollowsPlan, resourcesById);
      plannedHours += allocationPlannedHours(row, p, periods, resources, workdayHours, holidaySet, plan.granularity, absences, resourcesById);
    }
    if (internal <= 0 && (aActual !== 0 || aBudget !== 0)) uncostedWork = true;
    budgetHours += aBudget;
    actualHours += aActual;
    cost += aActual * internal;
    tmRevenue += aActual * external;
    budgetValueExternal += aBudget * external;
    budgetCost += aBudget * internal;
  }

  const costIsKnowable = rows.length > 0 && hasRatedRow && !uncostedWork;
  // The notice fires for a partly-rated bucket too: a rate really is missing
  // there, and it is the actionable half of the message.
  const ratesAreMissing = rows.length > 0 && (!hasRatedRow || uncostedWork);

  const isFixed = bucket.type === "fixed";
  const fixedPrice = bucket.fixedPriceAmount ?? 0;

  const revenue = isFixed ? fixedPrice : tmRevenue;
  // Spillover adds available budget to a T&M bucket; a fixed-price bucket's
  // budget IS the contract amount and is not inflated by spilled-in value.
  const budgetValue = isFixed ? fixedPrice : budgetValueExternal + spilloverInValue;
  const consumedValue = isFixed
    ? (budgetHours > 0 ? Math.min(fixedPrice, fixedPrice * (actualHours / budgetHours)) : 0)
    : tmRevenue;

  // The badge is suppressed only when the two DISPLAYED figures are the same
  // number. Row structure alone is not enough: the reported budget hours carry
  // spilled-in hours from a closed predecessor while planned hours do not, so a
  // follow-plan bucket receiving spillover shows two genuinely different
  // figures — hiding the badge there would suppress real information, the exact
  // inverse of what this flag is for. Compared with the shared band tolerance
  // because these are the same sum in different association orders.
  const reportedBudgetHours = budgetHours + spilloverInHours;
  const budgetMirrorsPlan =
    rowsMirrorPlan &&
    Math.abs(reportedBudgetHours - plannedHours) <=
      RATIO_EPSILON * Math.max(reportedBudgetHours, plannedHours, 1);

  const winLossHours = budgetHours + spilloverInHours - actualHours;
  const winLossValue = isFixed ? revenue - cost : budgetValue - consumedValue;

  // For fixed-price with no budgeted hours, consumption % is meaningless.
  const consumptionPercent = isFixed && budgetHours === 0 ? null : pct(consumedValue, budgetValue);

  return {
    bucketId: bucket.id, name: bucket.name, currency: bucket.currency,
    type: bucket.type, status: bucket.status,
    budgetHours: reportedBudgetHours, plannedHours, actualHours,
    budgetValue, consumedValue, revenue, cost, budgetCost,
    winLossHours, winLossValue,
    spilloverInHours, spilloverInValue,
    contributionMargin: { amount: revenue - cost, percent: pct(revenue - cost, revenue) },
    costPerformance: { amount: budgetCost - cost, percent: pct(budgetCost, cost) },
    // The tile prints this amount directly beneath `percent`, so it must be the
    // SAME quantity — consumed, not remaining. Remaining is already carried by
    // win/loss.
    consumption: { amount: consumedValue, percent: consumptionPercent },
    budgetMirrorsPlan,
    costIsKnowable,
    ratesAreMissing,
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
  /** True when EVERY bucket's budget hours ARE its planned hours — see
   *  BucketReport.budgetMirrorsPlan. */
  budgetMirrorsPlan: boolean;
  /** False when NOT ONE bucket carries an internal rate, making the project's
   *  cost, margin and burn wholly unknowable. EVERY revenue-bearing bucket must
   *  be costable for the project total to mean anything — see the rollup.
   *  A single costable bucket keeps the rollup a real (if partial) figure. */
  costIsKnowable: boolean;
  /** True only when rows EXIST and none carries an internal rate — the case where
   *  pointing the user at the rate card is the right guidance. An empty bucket
   *  is false: it has no roles to rate. */
  ratesAreMissing: boolean;
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
    // The tile prints this amount directly beneath `percent`, so it must be the
    // SAME quantity — consumed, not remaining. Remaining is already carried by
    // win/loss.
    consumption: { amount: consumedValue, percent: pct(consumedValue, budgetValue) },
    budgetMirrorsPlan: reports.length > 0 && reports.every((b) => b.budgetMirrorsPlan),
    // ★★ EVERY, not SOME. `revenue` and `cost` above are summed across ALL
    // buckets, so a single uncostable bucket contaminates the total — and it is
    // the total a PM reads first. A `.some()` here would declare that total
    // knowable the moment any OTHER bucket happened to be rated: an unstarted
    // €50k fixed-price contract sitting beside one active bucket rendered a
    // green 98% project margin with no caveat.
    //
    // A bucket contributing NO revenue cannot distort the ratio, so it is
    // exempt — otherwise an empty scratch bucket would blank a good margin.
    //
    // BOTH halves are load-bearing. `every` alone would call a project of
    // nothing but zero-revenue rateless buckets knowable, when in truth nothing
    // in it can be costed at all; `some` alone is what let the unstarted
    // contract through. The total is trustworthy only when something real
    // contributes to it AND nothing uncostable contaminates it.
    // The exemption needs BOTH halves. `revenue === 0` alone lets through a
    // bucket whose BUDGETED hours sit at no rate: it earns nothing yet, so it
    // passes the revenue test, while those hours land in `budgetCost` as 0 and
    // understate the project's cost burn. `!ratesAreMissing` alone lets through
    // the unstaffed fixed-price contract, which has no rows to be missing a
    // rate. A bucket is harmless only when it earns nothing AND is not sitting
    // on unrated work.
    //
    // This also keeps the notice and the figures consistent: any bucket that
    // makes the notice fire now also blanks the total, so the panel can never
    // print "cost, margin and burn cannot be calculated" beside calculated
    // numbers.
    costIsKnowable:
      reports.some((b) => b.costIsKnowable) &&
      reports.every((b) => b.costIsKnowable || (b.revenue === 0 && !b.ratesAreMissing)),
    // Stays SOME: "at least one bucket has rows nobody has rated" is an honest
    // and actionable statement about a project even when others are fine.
    ratesAreMissing: reports.some((b) => b.ratesAreMissing),
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
