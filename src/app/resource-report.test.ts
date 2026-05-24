import { describe, test, expect } from "vitest";
import { computeResourceReport } from "./resource-report";
import type { Resource, Role, Discipline, Grade, ResourcePlan } from "./types";

const disciplines: Discipline[] = [{ id: 1, name: "Developer" }];
const grades: Grade[] = [{ id: 1, name: "Senior" }];
const roles: Role[] = [{ id: 5, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 200 }];
const plan: ResourcePlan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month", currency: "EUR" };

describe("computeResourceReport", () => {
  test("totals + breakdowns for one assigned resource (Feb 2026 = 160h @100%)", () => {
    const resources: Resource[] = [
      { id: 1, name: "Sample", roleId: 5, utilizationMode: "percent", utilization: { "2026-02": 100 } },
    ];
    const rep = computeResourceReport(resources, roles, disciplines, grades, plan, [], new Set(), 8);
    expect(rep.totalCapacityHours).toBeCloseTo(160, 6);
    expect(rep.totalInternal).toBeCloseTo(16000, 6);
    expect(rep.totalExternal).toBeCloseTo(32000, 6);
    expect(rep.totalMargin).toBeCloseTo(16000, 6);
    expect(rep.perPeriod).toHaveLength(1);
    expect(rep.perPeriod[0]).toMatchObject({ key: "2026-02" });
    expect(rep.perDiscipline[0]).toMatchObject({ label: "Developer", headcount: 1 });
    expect(rep.perGrade[0]).toMatchObject({ label: "Senior", headcount: 1 });
    expect(rep.perCombo[0]).toMatchObject({ label: "Developer Senior", headcount: 1 });
    expect(rep.perResource[0]).toMatchObject({ name: "Sample", roleLabel: "Developer Senior", hasRole: true, avgUtilization: 100 });
  });

  test("unassigned resource: counted in capacity + per-resource (flagged), excluded from breakdowns and cost", () => {
    const resources: Resource[] = [
      { id: 2, name: "Bob", roleId: null, utilizationMode: "percent", utilization: { "2026-02": 50 } },
    ];
    const rep = computeResourceReport(resources, roles, disciplines, grades, plan, [], new Set(), 8);
    expect(rep.totalCapacityHours).toBeCloseTo(80, 6);
    expect(rep.totalInternal).toBe(0);
    expect(rep.perDiscipline).toHaveLength(0);
    expect(rep.perResource[0]).toMatchObject({ name: "Bob", hasRole: false });
  });
});
