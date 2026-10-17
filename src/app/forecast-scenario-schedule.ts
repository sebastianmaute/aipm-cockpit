/**
 * A saved forecast scenario as the engine's per-day schedules (§502, spec §4.1 / §4.1a) — pure, i18n-free.
 * Availability rows multiply into a clamped team factor (delivery and spend scale alike); Add-people shares are
 * added after the clamp; scope rows become dated arrivals.
 */
import type { DatedScheduleChanges, ScopeArrival } from "./forecast";
import { dayOnOrAfter } from "./forecast/day-index";
import { isAttributableMilestone } from "./forecast/milestones";
import { changeDayWindow, resolveAddedPeople, type AddedPersonStatus, type ScheduleContext } from "./forecast-added-people";
import type { ScenarioChange } from "./forecast-scenarios";

export type ScenarioRowStatus =
  | { kind: "availability"; ended: boolean }
  | { kind: "addPeople"; status: AddedPersonStatus }
  | { kind: "scope"; milestoneGone: boolean };

export type ScenarioSchedule = {
  changes: DatedScheduleChanges;   // capacityByDay = clamp(Π availability, 0.1, 3) + Σ added shares
  spendScale: Float64Array;        // the clamped availability product
  addedCost: Float64Array;         // Σ added cost per day, baseline currency
  rows: readonly ScenarioRowStatus[]; // aligned with the scenario's changes by index
  teamHoursPerDay: number | null;
  /** Σ (weeklyHours / 5) / teamHoursPerDay over the sized rows that apply on at least one simulated day;
   *  > 1 means "added people more than double the team". */
  addedShareAtFullSpeed: number;
};

const TEAM_FACTOR_MIN = 0.1;
const TEAM_FACTOR_MAX = 3;

export function buildScenarioSchedule(changes: readonly ScenarioChange[], ctx: ScheduleContext): ScenarioSchedule {
  const { dates } = ctx;
  const horizon = dates.length - 1;
  const product = new Float64Array(dates.length).fill(1);
  const shares = new Float64Array(dates.length);
  const addedCost = new Float64Array(dates.length);
  const arrivals: ScopeArrival[] = [];
  const rows: ScenarioRowStatus[] = [];
  const attributable = new Set(ctx.milestones.filter(isAttributableMilestone).map((m) => m.id));
  let addedShareAtFullSpeed = 0;

  for (const c of changes) {
    if (c.kind === "availability") {
      const { first, last } = changeDayWindow(dates, c.from, c.until);
      for (let d = first; d <= last; d += 1) product[d] *= c.percent / 100;
      rows.push({ kind: "availability", ended: c.until !== "" && c.until < ctx.today });
    } else if (c.kind === "addPeople") {
      const { status, share, cost } = resolveAddedPeople(c, ctx);
      for (let d = 1; d <= horizon; d += 1) {
        shares[d] += share[d];
        addedCost[d] += cost[d];
      }
      // A sized row with an empty window (`from` past the horizon, or `until` = today) adds no one on any
      // simulated day, so it must not raise the "more than double the team" warning.
      const { first, last } = changeDayWindow(dates, c.from, c.until);
      if (status.kind === "sized" && first <= last) addedShareAtFullSpeed += status.shareAtFullSpeed;
      rows.push({ kind: "addPeople", status });
    } else {
      const named = c.milestoneId;
      const milestoneId = named !== undefined && attributable.has(named) ? named : null;
      arrivals.push({ day: Math.min(dayOnOrAfter(dates, c.on), horizon), tasks: c.tasks, milestoneId });
      rows.push({ kind: "scope", milestoneGone: named !== undefined && milestoneId === null });
    }
  }

  const spendScale = new Float64Array(dates.length);
  const capacityByDay = new Float64Array(dates.length);
  for (let d = 0; d < dates.length; d += 1) {
    spendScale[d] = Math.min(TEAM_FACTOR_MAX, Math.max(TEAM_FACTOR_MIN, product[d]));
    capacityByDay[d] = spendScale[d] + shares[d];
  }
  return { changes: { capacityByDay, arrivals }, spendScale, addedCost, rows, teamHoursPerDay: ctx.teamHours, addedShareAtFullSpeed };
}
