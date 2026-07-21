// src/app/timelog-apply.ts — pure plan/apply of Timelog overlay actuals into budget allocations.
import type { BudgetBucket, BucketAllocation, Discipline, DisciplineAllocation, Grade, Resource, Role } from "./types";
import { roleLabel } from "./resource-foundation";
import type { ActualsByBucket, BucketPeriodCell } from "./timelog-actuals";

/** 2dp, binary-float safe. Hours are money-adjacent (they multiply a rate), so
 *  a running sum of TimeLog decimals must not persist 7.000000000000001. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type ApplyDiffRow = {
  bucketId: number;
  /** Index into the bucket's target allocation list — actuals are attributed
   *  PER ROLE line, so a bucket·period can yield several rows. */
  allocIndex: number;
  period: string;
  current: number;
  next: number;
};

// The allocation array that HOLDS actuals for a bucket: disciplineAllocations for
// a blended bucket, else the per-role allocations. A bucket with an EMPTY target
// array has nowhere to store actuals — apply must skip it (there is no "unassigned"
// role/discipline to fabricate), so the plan/affordance must not count it either.
function targetAllocations(b: BudgetBucket): readonly (BucketAllocation | DisciplineAllocation)[] {
  return b.planningMode === "blended" ? (b.disciplineAllocations ?? []) : b.allocations;
}

/**
 * Which allocation line receives this person's hours.
 *
 * `resourceIds` wins — an explicitly staffed line is a deliberate statement about
 * who sits on it. Otherwise fall back to the person's directory role (for a
 * blended bucket, that role's discipline), which is how most buckets are set up:
 * `resourceIds` feeds the PLAN and is often left empty.
 *
 * `null` = no line fits. Those hours are SURFACED and never written: putting them
 * on an arbitrary line is exactly the defect this module used to have, and it
 * costs them at another role's rate (budget-report multiplies each line's actual
 * hours by THAT line's rate).
 */
function allocationIndexFor(
  resourceId: number,
  list: readonly (BucketAllocation | DisciplineAllocation)[],
  blended: boolean,
  resourcesById: ReadonlyMap<number, Resource>,
  rolesById: ReadonlyMap<number, Role>,
): number | null {
  // `resources` is the COST-BEARING directory (the panel filters out
  // `isExternal`, which is capacity-only and excluded from all cost figures).
  // A person absent from it is attributed by NO path — checked before the
  // resourceIds match, which otherwise never consults the directory, so an
  // external (or a deleted resource still named by a line) would be costed at
  // that line's role rate.
  if (!resourcesById.has(resourceId)) return null;
  // First match wins throughout. Two lines sharing a roleId (a hand-split of one
  // role across two rows) therefore collapse onto the first — the bucket total
  // and its cost are unaffected, since both carry the same rate, but the split
  // is not preserved.
  const explicit = list.findIndex((a) => a.resourceIds.includes(resourceId));
  if (explicit !== -1) return explicit;
  const roleId = resourcesById.get(resourceId)?.roleId;
  if (roleId === undefined || roleId === null) return null;
  if (blended) {
    const disciplineId = rolesById.get(roleId)?.disciplineId;
    if (disciplineId === undefined) return null;
    const i = list.findIndex((a) => (a as DisciplineAllocation).disciplineId === disciplineId);
    return i === -1 ? null : i;
  }
  const i = list.findIndex((a) => (a as BucketAllocation).roleId === roleId);
  return i === -1 ? null : i;
}

type Routed = {
  /** allocation index → periodKey → hours */
  perAlloc: Map<number, Record<string, number>>;
  /**
   * Periods that routed AT LEAST ONE booking — only these are OWNED (see
   * writeAllocations). A period whose hours were entirely unattributable is
   * deliberately EXCLUDED: apply cannot own lines it has no information about,
   * and zeroing them destroys previously applied actuals. That is reachable in
   * one click — `use-timelog-sync` seeds `aggregates` from the persisted cache,
   * so an upgraded user whose cached cells predate `byResource` would wipe every
   * line to 0. Ownership exists to clear a STALE total that the same period is
   * about to replace; with nothing to replace it, there is nothing to clear.
   */
  periods: string[];
  /** Some booked hours matched no line. Surfaced to the user, never applied. */
  unmatched: boolean;
  /** NET hours withheld. Informational only — `unmatched` is the authoritative
   *  flag, since a +40/-40 pair nets to zero while still needing the notice. */
  unmatchedHours: number;
};

function routeBucket(
  b: BudgetBucket,
  periods: Record<string, BucketPeriodCell>,
  resourcesById: ReadonlyMap<number, Resource>,
  rolesById: ReadonlyMap<number, Role>,
): Routed | null {
  const list = targetAllocations(b);
  if (list.length === 0) return null;
  const blended = b.planningMode === "blended";
  const perAlloc = new Map<number, Record<string, number>>();
  const routedPeriods = new Set<string>();
  let unmatched = false;
  // NET hours, so the number answers "how far off is the budget". A +40/-40 pair
  // nets to 0, which is why `unmatched` stays a separate flag — the total can
  // never be the signal that something was withheld.
  let unmatchedHours = 0;
  for (const [period, cell] of Object.entries(periods)) {
    // A cell from a pre-breakdown persisted actuals cache has no `byResource`.
    // Its hours are unattributable, so they are surfaced rather than guessed at
    // — a re-fetch repopulates the breakdown.
    const breakdown = cell.byResource ?? {};
    // `!== 0`, matching the per-person guard below: TimeLog emits credit
    // corrections, so a period's net total can be NEGATIVE, and those hours are
    // just as unattributable as positive ones. `> 0` dropped them silently —
    // exactly what the notice exists to prevent.
    if (Object.keys(breakdown).length === 0 && cell.hours !== 0) {
      unmatched = true;
      unmatchedHours += cell.hours;
    }
    for (const [rid, hc] of Object.entries(breakdown)) {
      const idx = allocationIndexFor(Number(rid), list, blended, resourcesById, rolesById);
      if (idx === null) {
        if (hc.hours !== 0) {
          unmatched = true;
          unmatchedHours += hc.hours;
        }
        continue;
      }
      const rec = perAlloc.get(idx) ?? {};
      // round2 at the ACCUMULATION point, not at display: TimeLog hours are
      // decimals, so a bare running sum yields values like 7.000000000000001 —
      // and this figure is written straight into the persisted `actualHours`,
      // so the float would be stored, not just shown.
      rec[period] = round2((rec[period] ?? 0) + hc.hours);
      perAlloc.set(idx, rec);
      // Ownership needs a REAL booking. A person whose hours net to zero (a +4
      // and a -4 credit correction) says nothing about the period, so on its own
      // that must not claim every other line and zero a hand-entered figure.
      // Their own line is still written to 0 whenever some OTHER booking arms
      // the period — their net genuinely is zero.
      if (hc.hours !== 0) routedPeriods.add(period);
    }
  }
  return { perAlloc, periods: [...routedPeriods], unmatched, unmatchedHours };
}

function indexes(resources: readonly Resource[], roles: readonly Role[]) {
  return {
    resourcesById: new Map(resources.map((r) => [r.id, r])),
    rolesById: new Map(roles.map((r) => [r.id, r])),
  };
}

export type ApplyPlan = {
  rows: ApplyDiffRow[];
  /** Buckets carrying hours that matched no line. The authoritative "something
   *  was withheld" signal — gate the notice on THIS, not on unmatchedHours. */
  unmatchedBuckets: number[];
  /** NET hours withheld across all buckets, so the notice can say how far off
   *  the budget will read. Nets to zero for a +40/-40 credit-correction pair
   *  while unmatchedBuckets stays non-empty. */
  unmatchedHours: number;
};

/**
 * Both panel outputs in ONE pass. The panel needs the diff rows AND the
 * unmatched set every render; deriving them from two entry points routed every
 * bucket twice. `planApply` / `bucketsWithUnmatchedHours` remain as focused
 * exports and delegate here.
 */
export function buildApplyPlan(
  buckets: readonly BudgetBucket[],
  overlay: ActualsByBucket,
  resources: readonly Resource[],
  roles: readonly Role[],
): ApplyPlan {
  const { resourcesById, rolesById } = indexes(resources, roles);
  const rows: ApplyDiffRow[] = [];
  const unmatchedBuckets: number[] = [];
  let unmatchedHours = 0;
  for (const b of buckets) {
    const periods = overlay[b.id];
    if (!periods) continue;
    const routed = routeBucket(b, periods, resourcesById, rolesById);
    if (!routed) continue; // no allocation to receive actuals — apply would no-op
    if (routed.unmatched) unmatchedBuckets.push(b.id);
    unmatchedHours += routed.unmatchedHours;
    targetAllocations(b).forEach((a, i) => {
      for (const period of routed.periods) {
        const current = a.actualHours[period] ?? 0;
        const next = routed.perAlloc.get(i)?.[period] ?? 0;
        // Only real changes: the confirm modal shows this list's LENGTH, so
        // unchanged lines would inflate the count and the Apply button would
        // stay enabled with nothing to do.
        if (current !== next) rows.push({ bucketId: b.id, allocIndex: i, period, current, next });
      }
    });
  }
  return { rows, unmatchedBuckets, unmatchedHours };
}

/** A diff row with the names needed to show it to a user. */
export interface ApplyDiffLabel extends ApplyDiffRow {
  bucketName: string;
  /** Role name, or discipline name for a blended bucket. "" when the role or
   *  discipline was deleted — the row still WRITES, so it must still be shown. */
  lineName: string;
}

/**
 * Name each diff row for the confirm dialog.
 *
 * The dialog used to show only a count. Apply OWNS every line of a routed period
 * (see writeAllocations), and `actualHours` is a user-editable input, so a
 * hand-entered figure on a line TimeLog knows nothing about is written to 0 —
 * e.g. a designer's 40h typed by the PM, zeroed because someone else booked to
 * the same week. Showing the rows turns that into an informed write.
 *
 * i18n-free: every string here is workspace data, and the caller supplies the
 * surrounding wording.
 */
export function describeApplyRows(
  rows: readonly ApplyDiffRow[],
  buckets: readonly BudgetBucket[],
  roles: readonly Role[],
  disciplines: readonly Discipline[],
  grades: readonly Grade[],
): ApplyDiffLabel[] {
  const bucketsById = new Map(buckets.map((b) => [b.id, b]));
  const rolesById = new Map(roles.map((r) => [r.id, r]));
  const disciplineName = new Map(disciplines.map((d) => [d.id, d.name]));
  return rows.map((row) => {
    const b = bucketsById.get(row.bucketId);
    const line = b ? targetAllocations(b)[row.allocIndex] : undefined;
    let lineName = "";
    if (b && line) {
      lineName =
        b.planningMode === "blended"
          ? disciplineName.get((line as DisciplineAllocation).disciplineId) ?? ""
          // A Role has no name of its own — it IS discipline × grade, so reuse
          // the one labeller the budget and resource views already use.
          : roleLabel(rolesById.get((line as BucketAllocation).roleId), disciplines, grades);
    }
    return { ...row, bucketName: b?.name ?? "", lineName };
  });
}

export function planApply(
  buckets: readonly BudgetBucket[],
  overlay: ActualsByBucket,
  resources: readonly Resource[],
  roles: readonly Role[],
): ApplyDiffRow[] {
  return buildApplyPlan(buckets, overlay, resources, roles).rows;
}

/**
 * Apply OWNS every target line for the periods it covers: a line with no bookings
 * in an applied period is written to 0, not skipped. Skipping it would leave a
 * stale total (e.g. one written by the old allocations[0] behaviour) sitting
 * alongside the new per-role numbers and DOUBLE-COUNT the bucket. Periods outside
 * the overlay are untouched.
 */
function writeAllocations<T extends { actualHours: Record<string, number> }>(
  list: readonly T[],
  routed: Routed,
): T[] {
  return list.map((a, i) => {
    const rec = routed.perAlloc.get(i);
    const nextActual = { ...a.actualHours };
    for (const period of routed.periods) nextActual[period] = rec?.[period] ?? 0;
    return { ...a, actualHours: nextActual };
  });
}

export function applyActualsToBuckets(
  buckets: readonly BudgetBucket[],
  overlay: ActualsByBucket,
  resources: readonly Resource[],
  roles: readonly Role[],
): BudgetBucket[] {
  const { resourcesById, rolesById } = indexes(resources, roles);
  return buckets.map((b) => {
    const periods = overlay[b.id];
    if (!periods) return b;
    const routed = routeBucket(b, periods, resourcesById, rolesById);
    if (!routed) return b;
    if (b.planningMode === "blended") {
      const list = b.disciplineAllocations ?? [];
      return { ...b, disciplineAllocations: writeAllocations(list, routed) };
    }
    return { ...b, allocations: writeAllocations(b.allocations, routed) };
  });
}

// Overlay buckets that carry booked hours but have NO target allocation to hold
// them — the panel surfaces these so the user knows to add a role/discipline line
// before actuals can be applied (see the missing-allocation notice).
export function bucketsMissingAllocations(buckets: readonly BudgetBucket[], overlay: ActualsByBucket): number[] {
  return buckets.filter((b) => overlay[b.id] && targetAllocations(b).length === 0).map((b) => b.id);
}

/**
 * Overlay buckets that DO have allocation lines but where some booked hours match
 * none of them — an unlinked person, a person with no directory role, or a role
 * with no line in this bucket. Those hours are withheld from the budget, so the
 * panel must say so; otherwise the bucket silently reads low.
 */
export function bucketsWithUnmatchedHours(
  buckets: readonly BudgetBucket[],
  overlay: ActualsByBucket,
  resources: readonly Resource[],
  roles: readonly Role[],
): number[] {
  return buildApplyPlan(buckets, overlay, resources, roles).unmatchedBuckets;
}
