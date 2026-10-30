// src/app/alloc-plan/alloc-effect.ts
//
// What ticking part of ONE alternative would do (§769): which people end up over capacity and what the plan costs
// internally. Pure, i18n-free. Everything is in SHOWN hours, so percent-mode people compare like hours-mode ones.
import { type Resource, type Role } from "../types";
import { absencesForResource, generatePeriods, type Period } from "../resource-capacity";
import { planHoursMoves, plannedShownDeltas } from "../reassign-hours";
import { periodCost } from "../resource-cost";
import { cellKey, availableCapacityHours } from "./alloc-plan";
import { ownerChangeFor, type GroundedAlternative, type MoveGroundContext } from "./alloc-ground-moves";

export interface OverCapacity {
  resourceId: number;
  periodKey: string;
  hours: number;
  capacityHours: number;
}

export interface AltEffect {
  movedTasks: number;
  movedHours: number;
  editedCells: number;
  costDelta: number;
  externalHours: number;
  noRateCount: number;
  overCapacity: OverCapacity[];
}

/** Shown hours are tenths; anything under this is rounding, not an overrun. */
const CAPACITY_TOLERANCE = 0.05;
const NO_CHANGE = 1e-9;

function shownHours(r: Resource, capacityHours: number, periodKey: string): number {
  const stored = r.utilization[periodKey] ?? 0;
  return r.utilizationMode === "percent" ? (stored / 100) * capacityHours : stored;
}

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
  const capacityOf = (r: Resource, periodKey: string): number => {
    const period = periodByKey.get(periodKey);
    return period ? availableCapacityHours(r, period, absencesForResource(ctx.absences, r), ctx.workdayHours, ctx.holidaySet) : 0;
  };

  // Ticked linked moves are planned TOGETHER, as the apply path does: a giver shared by two moves is taken once.
  const taskById = new Map(ctx.tasks.map((t) => [t.id, t]));
  const tickedMoves = alt.moves.filter((m) => selected.has(m.key));
  const changes = tickedMoves.flatMap((m) => {
    const task = taskById.get(m.taskId);
    const receiver = resourceById.get(m.toResourceId);
    return m.linked && task && receiver ? [ownerChangeFor(task, receiver)] : [];
  });
  const combined = planHoursMoves(changes, ctx.resources, ctx);

  const deltas = new Map<string, { resourceId: number; periodKey: string; delta: number }>();
  const addDelta = (resourceId: number, periodKey: string, delta: number): void => {
    const key = cellKey({ resourceId, periodKey });
    const prev = deltas.get(key);
    deltas.set(key, { resourceId, periodKey, delta: (prev?.delta ?? 0) + delta });
  };
  for (const [resourceId, byPeriod] of plannedShownDeltas(combined)) {
    for (const [periodKey, delta] of byPeriod) addDelta(resourceId, periodKey, delta);
  }

  const tickedCells = alt.cells.filter((c) => selected.has(cellKey(c)));
  for (const cell of tickedCells) {
    const r = resourceById.get(cell.resourceId);
    if (r) addDelta(cell.resourceId, cell.periodKey, cell.hours - shownHours(r, capacityOf(r, cell.periodKey), cell.periodKey));
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
      const role = r.roleId == null ? undefined : ctx.roles.find((x) => x.id === r.roleId);
      if (role) costDelta += periodCost(delta, role).internal;
      else noRate.add(resourceId);
    }
    const capacityHours = capacityOf(r, periodKey);
    const hours = shownHours(r, capacityHours, periodKey) + delta;
    if (hours > capacityHours + CAPACITY_TOLERANCE) overCapacity.push({ resourceId, periodKey, hours: round2(hours), capacityHours });
  }
  overCapacity.sort((a, b) => a.resourceId - b.resourceId || a.periodKey.localeCompare(b.periodKey));

  return {
    movedTasks: tickedMoves.length,
    movedHours: round2(combined.moves.reduce((s, m) => s + m.movedHours, 0)),
    editedCells: tickedCells.length,
    costDelta,
    externalHours,
    noRateCount: noRate.size,
    overCapacity,
  };
}
