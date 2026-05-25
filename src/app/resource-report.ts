import { generatePeriods, displayCapacityHours, absencesForResource } from "./resource-capacity";
import { periodCost, type CostBreakdown } from "./resource-cost";
import { roleLabel, resourceDisplayName } from "./resource-foundation";
import type { Absence, Discipline, Grade, Resource, ResourcePlan, Role } from "./types";

export type ReportGroupRow = {
  key: string;
  label: string;
  headcount: number;
  capacityHours: number;
  internal: number;
  external: number;
};

export type ReportPeriodRow = {
  key: string;
  capacityHours: number;
  internal: number;
  external: number;
  margin: number;
};

export type ReportResourceRow = {
  id: number;
  name: string;
  roleLabel: string;
  hasRole: boolean;
  avgUtilization: number;
  capacityHours: number;
  internal: number;
  external: number;
};

export type ResourceReport = {
  totalCapacityHours: number;
  totalInternal: number;
  totalExternal: number;
  totalMargin: number;
  perPeriod: ReportPeriodRow[];
  perDiscipline: ReportGroupRow[];
  perGrade: ReportGroupRow[];
  perCombo: ReportGroupRow[];
  perResource: ReportResourceRow[];
};

function bump(
  map: Map<number, ReportGroupRow>,
  key: number,
  label: string,
  hours: number,
  cost: CostBreakdown,
): void {
  let row = map.get(key);
  if (!row) {
    row = { key: String(key), label, headcount: 0, capacityHours: 0, internal: 0, external: 0 };
    map.set(key, row);
  }
  row.headcount += 1;
  row.capacityHours += hours;
  row.internal += cost.internal;
  row.external += cost.external;
}

export function computeResourceReport(
  resources: readonly Resource[],
  roles: readonly Role[],
  disciplines: readonly Discipline[],
  grades: readonly Grade[],
  plan: ResourcePlan,
  absences: readonly Absence[],
  holidaySet: ReadonlySet<string>,
  workdayHours: number,
): ResourceReport {
  const periods = generatePeriods(plan.startDate, plan.endDate, plan.granularity);
  const perPeriod: ReportPeriodRow[] = periods.map((p) => ({
    key: p.key,
    capacityHours: 0,
    internal: 0,
    external: 0,
    margin: 0,
  }));
  const perPeriodIdx = new Map(periods.map((p, i) => [p.key, i]));

  const discMap = new Map<number, ReportGroupRow>();
  const gradeMap = new Map<number, ReportGroupRow>();
  const comboMap = new Map<number, ReportGroupRow>();
  const perResource: ReportResourceRow[] = [];

  let totalCapacityHours = 0;
  let totalInternal = 0;
  let totalExternal = 0;

  for (const r of resources) {
    const resAbs = absencesForResource(absences, r);
    const role = roles.find((x) => x.id === r.roleId);
    let resHours = 0;
    let utilSum = 0;

    for (const p of periods) {
      const capH = displayCapacityHours(
        p,
        periods,
        r,
        resAbs,
        workdayHours,
        holidaySet,
        plan.granularity,
        plan.granularity,
      );
      resHours += capH;
      utilSum += r.utilization[p.key] ?? 0;

      const cost = periodCost(capH, role);
      const idx = perPeriodIdx.get(p.key)!;
      perPeriod[idx].capacityHours += capH;
      perPeriod[idx].internal += cost.internal;
      perPeriod[idx].external += cost.external;
      perPeriod[idx].margin += cost.margin;
    }

    const resCost = periodCost(resHours, role);
    totalCapacityHours += resHours;
    totalInternal += resCost.internal;
    totalExternal += resCost.external;

    perResource.push({
      id: r.id,
      name: resourceDisplayName(r),
      roleLabel: roleLabel(role, disciplines, grades),
      hasRole: !!role,
      avgUtilization: periods.length ? utilSum / periods.length : 0,
      capacityHours: resHours,
      internal: resCost.internal,
      external: resCost.external,
    });

    if (role) {
      const discName = disciplines.find((d) => d.id === role.disciplineId)?.name ?? "?";
      const gradeName = grades.find((g) => g.id === role.gradeId)?.name ?? "?";
      bump(discMap, role.disciplineId, discName, resHours, resCost);
      bump(gradeMap, role.gradeId, gradeName, resHours, resCost);
      bump(comboMap, role.id, roleLabel(role, disciplines, grades), resHours, resCost);
    }
  }

  const byLabel = (a: ReportGroupRow, b: ReportGroupRow) => a.label.localeCompare(b.label);

  return {
    totalCapacityHours,
    totalInternal,
    totalExternal,
    totalMargin: totalExternal - totalInternal,
    perPeriod,
    perDiscipline: Array.from(discMap.values()).sort(byLabel),
    perGrade: Array.from(gradeMap.values()).sort(byLabel),
    perCombo: Array.from(comboMap.values()).sort(byLabel),
    perResource,
  };
}
