// src/app/alloc-plan/alloc-effect.ts
//
// What ticking part of ONE alternative would do (§769): which people end up over capacity and what the plan costs
// internally. Pure, i18n-free. Everything is in SHOWN hours, so percent-mode people compare like hours-mode ones.
import { type Resource, type Role } from "../types";
import { absencesForResource, generatePeriods, periodCapacityHours, type Period } from "../resource-capacity";
import { OVER_CAPACITY_TOLERANCE_HOURS, plannedShownDeltas, type HoursMovePlan } from "../reassign-hours";
import { periodCost } from "../resource-cost";
import { cellKey, availableCapacityHours } from "./alloc-plan";
import { planTickedMoves, type GroundedAlternative, type MoveGroundContext } from "./alloc-ground-moves";

export interface OverCapacity {
  resourceId: number;
  periodKey: string;
  hours: number;
  capacityHours: number;
}

export interface AltEffect {
  movedTasks: number;
  movedHours: number;
  /** Ticked hour edits that count: the ones the ticked moves do not already change. */
  editedCells: number;
  /** Ticked hour edits the ticked moves, planned together, already change: they add nothing and are not written. */
  coveredCells: number;
  /** The ticked linked moves planned together; a ticked move's row shows its own share of it. */
  movePlan: HoursMovePlan;
  costDelta: number;
  externalHours: number;
  noRateCount: number;
  overCapacity: OverCapacity[];
}

const NO_CHANGE = 1e-9;

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function alternativeEffect(
  alt: GroundedAlternative,
  selected: ReadonlySet<string>,
  ctx: MoveGroundContext & { roles: readonly Role[] },
): AltEffect {
  const resourceById = new Map(ctx.resources.map((r) => [r.id, r]));
  const periodByKey = new Map<string, Period>(
    generatePeriods(ctx.plan.startDate, ctx.plan.endDate, ctx.plan.granularity).map((p) => [p.key, p]),
  );
  const roleById = new Map(ctx.roles.map((x) => [x.id, x]));
  const absencesById = new Map<number, ReturnType<typeof absencesForResource>>();
  const absencesOf = (r: Resource) => {
    const known = absencesById.get(r.id);
    if (known) return known;
    const mine = absencesForResource(ctx.absences, r);
    absencesById.set(r.id, mine);
    return mine;
  };
  const capacityOf = (r: Resource, periodKey: string): number => {
    const period = periodByKey.get(periodKey);
    return period ? availableCapacityHours(r, period, absencesOf(r), ctx.workdayHours, ctx.holidaySet) : 0;
  };
  /** Shown hours when the stored value is `value`: the quantity §774's over-capacity check uses (absences subtracted). */
  const shownAt = (r: Resource, periodKey: string, value: number): number => {
    const period = periodByKey.get(periodKey);
    if (!period) return 0;
    const at = { ...r, utilization: { ...r.utilization, [periodKey]: value } };
    return periodCapacityHours(at, period, absencesOf(r), ctx.workdayHours, ctx.holidaySet);
  };
  const shownNow = (r: Resource, periodKey: string): number => shownAt(r, periodKey, r.utilization[periodKey] ?? 0);

  // Ticked linked moves are planned TOGETHER, as the apply path does: a giver shared by two moves is taken once.
  const tickedMoves = alt.moves.filter((m) => selected.has(m.key));
  const { plan: combined, changedCells } = planTickedMoves(alt.moves, selected, ctx);

  const deltas = new Map<string, { resourceId: number; periodKey: string; delta: number }>();
  const addDelta = (resourceId: number, periodKey: string, delta: number): void => {
    const key = cellKey({ resourceId, periodKey });
    const prev = deltas.get(key);
    deltas.set(key, { resourceId, periodKey, delta: (prev?.delta ?? 0) + delta });
  };
  for (const [resourceId, byPeriod] of plannedShownDeltas(combined)) {
    for (const [periodKey, delta] of byPeriod) addDelta(resourceId, periodKey, delta);
  }

  const ticked = alt.cells.filter((c) => selected.has(cellKey(c)));
  // A cell the moves already change is not written on apply, so it adds nothing here either.
  const tickedCells = ticked.filter((c) => !changedCells.has(cellKey(c)));
  for (const cell of tickedCells) {
    const r = resourceById.get(cell.resourceId);
    // What apply WRITES (whole percent, capped), not what was asked.
    if (r) addDelta(cell.resourceId, cell.periodKey, shownAt(r, cell.periodKey, cell.nextValue) - shownNow(r, cell.periodKey));
  }

  let costDelta = 0;
  let externalHours = 0;
  const noRate = new Set<number>();
  const overCapacity: OverCapacity[] = [];
  for (const { resourceId, periodKey, delta } of deltas.values()) {
    const r = resourceById.get(resourceId);
    if (!r || Math.abs(delta) < NO_CHANGE) continue;
    if (r.isExternal) {
      externalHours += Math.abs(delta);
    } else {
      const role = r.roleId == null ? undefined : roleById.get(r.roleId);
      if (role) costDelta += periodCost(delta, role).internal;
      else noRate.add(resourceId);
    }
    const capacityHours = capacityOf(r, periodKey);
    const hours = shownNow(r, periodKey) + delta;
    // No `capacityHours > 0` guard (unlike §774's own notice): hours landing on someone with nothing available — a
    // whole month absent — are exactly what the review window must warn about.
    if (hours > capacityHours + OVER_CAPACITY_TOLERANCE_HOURS) overCapacity.push({ resourceId, periodKey, hours: round2(hours), capacityHours });
  }
  overCapacity.sort((a, b) => a.resourceId - b.resourceId || a.periodKey.localeCompare(b.periodKey));

  return {
    movedTasks: tickedMoves.length,
    movedHours: round2(combined.moves.reduce((s, m) => s + m.movedHours, 0)),
    editedCells: tickedCells.length,
    coveredCells: ticked.length - tickedCells.length,
    movePlan: combined,
    costDelta,
    externalHours,
    noRateCount: noRate.size,
    overCapacity,
  };
}
