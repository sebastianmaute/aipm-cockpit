/**
 * What a matched person is planned for in OTHER projects, expressed in the
 * periods of the open project's plan. Pure and i18n-free.
 *
 * "Grid hours" are `Resource.utilization` read the way the Planning grid reads
 * it: `periodCapacityHours` (percent becomes hours of that project's own
 * capacity for the resource, absences and holidays included; hours mode is the
 * stored hours less absence). Each period of the other project's plan is spread
 * over the here-periods it overlaps in proportion to overlapping workdays
 * (weekends and holidays excluded). External and inactive resources count.
 *
 * The tasks hint is for the model only: open tasks the person owns elsewhere
 * (by `resourceId`, else the typed name equal to their display name) and their
 * remaining hours. It is never added to the hours.
 */
import type { Absence, Resource, ResourcePlan, Task } from "../types";
import { resourceDisplayName } from "../resource-foundation";
import { isTaskClosed } from "../task-closed";
import {
  absencesForResource,
  generatePeriods,
  periodCapacityHours,
  workdaysInRange,
  type Period,
} from "../resource-capacity";
import type { PersonRelation } from "./person-match";

export interface OtherProjectData {
  projectId: string;
  projectName: string;
  plan: ResourcePlan;
  resources: readonly Resource[];
  absences: readonly Absence[];
  tasks: readonly Task[];
}

export interface ElsewhereFigure {
  projectId: string;
  projectName: string;
  /** Hours per HERE period key, rounded to 2 decimals. */
  hoursByPeriod: Record<string, number>;
  openTasks: number;
  remainingHours: number;
}

const MINUTES_PER_HOUR = 60;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function matchesPerson(task: Task, resource: Resource): boolean {
  if (task.resourceId != null) return task.resourceId === resource.id;
  const name = resourceDisplayName(resource).toLowerCase();
  return name !== "" && (task.assignee ?? "").trim().toLowerCase() === name;
}

/** This resource's planned hours in the other project's plan, spread onto the here-periods. */
function spreadHours(
  resource: Resource,
  data: OtherProjectData,
  plan: ResourcePlan,
  herePeriods: readonly Period[],
  workdayHours: number,
  holidaySet: ReadonlySet<string>,
  into: Map<string, number>,
): void {
  const resourceAbsences = absencesForResource(data.absences, resource);
  for (const otherPeriod of generatePeriods(plan.startDate, plan.endDate, plan.granularity)) {
    const hours = periodCapacityHours(resource, otherPeriod, resourceAbsences, workdayHours, holidaySet);
    const otherDays = workdaysInRange(otherPeriod.start, otherPeriod.end, holidaySet);
    if (hours === 0 || otherDays === 0) continue;
    for (const here of herePeriods) {
      const start = here.start > otherPeriod.start ? here.start : otherPeriod.start;
      const end = here.end < otherPeriod.end ? here.end : otherPeriod.end;
      const overlap = workdaysInRange(start, end, holidaySet);
      if (overlap > 0) into.set(here.key, (into.get(here.key) ?? 0) + (hours * overlap) / otherDays);
    }
  }
}

function figureFor(
  data: OtherProjectData,
  resourceIds: ReadonlySet<number>,
  herePeriods: readonly Period[],
  workdayHours: number,
  holidaySet: ReadonlySet<string>,
): ElsewhereFigure {
  const matched = data.resources.filter((r) => resourceIds.has(r.id));
  const sums = new Map<string, number>();
  for (const r of matched) spreadHours(r, data, data.plan, herePeriods, workdayHours, holidaySet, sums);
  const hoursByPeriod: Record<string, number> = {};
  for (const p of herePeriods) hoursByPeriod[p.key] = round2(sums.get(p.key) ?? 0);
  const owned = data.tasks.filter((t) => !isTaskClosed(t) && matched.some((r) => matchesPerson(t, r)));
  const minutes = owned.reduce((s, t) => s + Math.max(0, t.remainingEstimateMinutes ?? 0), 0);
  return {
    projectId: data.projectId,
    projectName: data.projectName,
    hoursByPeriod,
    openTasks: owned.length,
    remainingHours: round2(minutes / MINUTES_PER_HOUR),
  };
}

/** One figure per other project that has at least one relation. */
export function elsewhereFor(
  relations: readonly PersonRelation[],
  others: readonly OtherProjectData[],
  herePeriods: readonly Period[],
  workdayHours: number,
  holidaySet: ReadonlySet<string>,
): ElsewhereFigure[] {
  const figures: ElsewhereFigure[] = [];
  for (const data of others) {
    const ids = new Set(relations.filter((r) => r.projectId === data.projectId).map((r) => r.resourceId));
    if (ids.size === 0) continue;
    figures.push(figureFor(data, ids, herePeriods, workdayHours, holidaySet));
  }
  return figures;
}

export function elsewhereTotal(figures: readonly ElsewhereFigure[], periodKey: string): number {
  return round2(figures.reduce((s, f) => s + (f.hoursByPeriod[periodKey] ?? 0), 0));
}
