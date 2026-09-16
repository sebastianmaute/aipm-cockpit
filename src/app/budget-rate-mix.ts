/**
 * Rate mix (MR 3 addendum §3.2). Pure and i18n-free. € and hours forecasts
 * diverge only when the average contract rate of the hours actually booked
 * differs from the planned average. This module measures that drift over
 * HOURLY buckets (a fixed-price bucket's € actual is already an hours ratio),
 * groups rows by role or discipline, names the driver and decides whether the
 * surfaces signal it. Hours per row mirror `computeBucketReport` exactly: own
 * effective budget hours and `actualHoursIn` over the bucket's active periods.
 */
import { bucketActivePeriods, bucketRateRows, effectiveBudgetHours } from "./budget-report";
import { actualHoursIn } from "./actual-hours";
import { roleLabel } from "./resource-foundation";
import { isPaceAvailable, paceVacHealth, type BudgetForecast } from "./budget-forecast";
import type { Absence, BudgetBucket, Discipline, Grade, Resource, ResourcePlan, Role } from "./types";

export const RATE_DRIFT_SIGNAL_RATIO = 0.03;
export const RATE_MIX_DRIVER_MIN_DIFFERENCE = 0.03;

export type RateMixRow = {
  key: string; kind: "role" | "discipline"; id: number; name: string; plannedRate: number | null;
  budgetHours: number; actualHours: number; plannedShare: number; bookedShare: number; difference: number;
  usedOfBudget: number | null;
};
export type RateMixSignal = {
  triggered: boolean; direction: "hours-worse" | "eur-worse" | null; severity: "warning" | "info" | null;
};
export type RateMix = RateMixSignal & {
  drift: number; bookedRate: number; plannedRate: number; budgetHours: number; actualHours: number;
  budgetValue: number; bookedValue: number; rows: readonly RateMixRow[]; driver: RateMixRow | null;
  /** Booked hours the fixed-price skip left OUT of every figure above, so the
   *  surfaces can disclose the scope (the hours pace VAC in the same sentence
   *  is project-wide, §3.1). Budget hours are deliberately NOT summed for the
   *  excluded buckets: that would need a fourth `effectiveBudgetHours` walk
   *  per recalculation and the disclosure does not use them. */
  excludedActualHours: number;
};
export type RateMixInput = {
  buckets: readonly BudgetBucket[]; roles: readonly Role[]; disciplines: readonly Discipline[]; grades: readonly Grade[];
  plan: ResourcePlan; resources: readonly Resource[]; workdayHours: number; holidaySet: ReadonlySet<string>;
  absences: readonly Absence[]; eur: BudgetForecast; hours: BudgetForecast;
};

const QUIET: RateMixSignal = { triggered: false, direction: null, severity: null };

/** Trigger (§3.2): both pace forecasts available AND (|drift| ≥ 3% OR the €
 *  and hours pace VAC ratings differ). Severity is a warning only when the
 *  ratings differ. */
export function rateMixSignal(drift: number, eur: BudgetForecast, hours: BudgetForecast): RateMixSignal {
  if (!isPaceAvailable(eur.pace) || !isPaceAvailable(hours.pace) || eur.facts.bac <= 0 || hours.facts.bac <= 0) return QUIET;
  const ragDiffers = paceVacHealth(eur.pace.vac, eur.facts.bac) !== paceVacHealth(hours.pace.vac, hours.facts.bac);
  if (Math.abs(drift) < RATE_DRIFT_SIGNAL_RATIO && !ragDiffers) return QUIET;
  const hoursWorse = hours.pace.vac / hours.facts.bac < eur.pace.vac / eur.facts.bac;
  return { triggered: true, direction: hoursWorse ? "hours-worse" : "eur-worse", severity: ragDiffers ? "warning" : "info" };
}

type Group = { kind: "role" | "discipline"; id: number; budgetHours: number; actualHours: number; budgetValue: number };

export function computeRateMix(input: RateMixInput): RateMix | null {
  const { buckets, roles, disciplines, grades, plan, resources, workdayHours, holidaySet, absences, eur, hours } = input;
  const budgetFollowsPlan = plan.budgetFollowsPlan ?? false;
  const resourcesById = new Map(resources.map((r) => [r.id, r] as const));
  const groups = new Map<string, Group>();
  let budgetHours = 0;
  let actualHours = 0;
  let budgetValue = 0;
  let bookedValue = 0;
  let excludedActualHours = 0;
  for (const bucket of buckets) {
    if (bucket.type === "fixed") {
      // Actual hours only — no `effectiveBudgetHours` walk here (see the field's
      // comment on `RateMix`); this loop runs on every dashboard recalculation.
      const fixedPeriods = bucketActivePeriods(bucket, plan);
      for (const row of bucketRateRows(bucket, roles)) {
        for (const p of fixedPeriods) excludedActualHours += actualHoursIn(row.actualHours, p.key);
      }
      continue;
    }
    const periods = bucketActivePeriods(bucket, plan);
    for (const row of bucketRateRows(bucket, roles)) {
      // `bucketRateRows` always tags a role-planned row with `roleId` and a
      // blended row with `disciplineId` (never neither) — see the tagging it
      // does in `budget-report.ts`. No third case to guard against here.
      const kind: "role" | "discipline" = row.roleId !== undefined ? "role" : "discipline";
      const id = kind === "role" ? (row.roleId as number) : (row.disciplineId as number);
      // Mirrors computeBucketReport's per-row sums (Step 1); the parity test pins it.
      let bh = 0;
      let ah = 0;
      for (const p of periods) {
        bh += effectiveBudgetHours(row, p, periods, resources, workdayHours, holidaySet, plan.granularity, absences, budgetFollowsPlan, resourcesById);
        ah += actualHoursIn(row.actualHours, p.key);
      }
      const external = row.rates.external;
      const key = `${kind}:${id}`;
      const g = groups.get(key) ?? { kind, id, budgetHours: 0, actualHours: 0, budgetValue: 0 };
      g.budgetHours += bh;
      g.actualHours += ah;
      g.budgetValue += bh * external;
      groups.set(key, g);
      budgetHours += bh;
      actualHours += ah;
      budgetValue += bh * external;
      bookedValue += ah * external;
    }
  }
  // `bookedValue` is guarded like the other three: every booked hour landing on
  // a row whose external rate is 0 (an unpriced role, or a dangling `roleId`
  // whose role was deleted — those rows are kept) makes `bookedRate` 0 and
  // `drift` exactly −1, which renders "-100.0% vs plan" and guarantees the
  // signal. A mix with a zero booked rate has no meaning; every surface is
  // already gated on a non-null mix.
  if (!(budgetHours > 0) || !(actualHours > 0) || !(budgetValue > 0) || !(bookedValue > 0)) return null;
  const plannedRate = budgetValue / budgetHours;
  const bookedRate = bookedValue / actualHours;
  const drift = bookedRate / plannedRate - 1;
  const rows: RateMixRow[] = [...groups.entries()].map(([key, g]) => {
    const plannedShare = g.budgetHours / budgetHours;
    const bookedShare = g.actualHours / actualHours;
    const name = g.kind === "role"
      ? roleLabel(roles.find((r) => r.id === g.id), disciplines, grades) || "—"
      : disciplines.find((d) => d.id === g.id)?.name ?? "—";
    return {
      key, kind: g.kind, id: g.id, name,
      plannedRate: g.budgetHours > 0 ? g.budgetValue / g.budgetHours : null,
      budgetHours: g.budgetHours, actualHours: g.actualHours,
      plannedShare, bookedShare, difference: bookedShare - plannedShare,
      usedOfBudget: g.budgetHours > 0 ? g.actualHours / g.budgetHours : null,
    };
  });
  const driver = rows
    .filter((r) => r.difference >= RATE_MIX_DRIVER_MIN_DIFFERENCE - 1e-9)
    .reduce<RateMixRow | null>((best, r) => (best === null || r.difference > best.difference ? r : best), null);
  return {
    drift, bookedRate, plannedRate, budgetHours, actualHours, budgetValue, bookedValue, rows, driver,
    excludedActualHours,
    ...rateMixSignal(drift, eur, hours),
  };
}
