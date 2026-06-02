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
      { id: 1, firstName: "Sample", lastName: "", roleId: 5, utilizationMode: "percent", utilization: { "2026-02": 100 } },
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
      { id: 2, firstName: "Bob", lastName: "", roleId: null, utilizationMode: "percent", utilization: { "2026-02": 50 } },
    ];
    const rep = computeResourceReport(resources, roles, disciplines, grades, plan, [], new Set(), 8);
    expect(rep.totalCapacityHours).toBeCloseTo(80, 6);
    expect(rep.totalInternal).toBe(0);
    expect(rep.perDiscipline).toHaveLength(0);
    expect(rep.perResource[0]).toMatchObject({ name: "Bob", hasRole: false });
  });

  test("no resources: zeroed totals, one zeroed per-period row, empty breakdowns", () => {
    const rep = computeResourceReport([], roles, disciplines, grades, plan, [], new Set(), 8);
    expect(rep.totalCapacityHours).toBe(0);
    expect(rep.totalInternal).toBe(0);
    expect(rep.totalExternal).toBe(0);
    expect(rep.totalMargin).toBe(0);
    expect(rep.perPeriod).toEqual([
      { key: "2026-02", capacityHours: 0, internal: 0, external: 0, margin: 0 },
    ]);
    expect(rep.perDiscipline).toEqual([]);
    expect(rep.perGrade).toEqual([]);
    expect(rep.perCombo).toEqual([]);
    expect(rep.perResource).toEqual([]);
  });

  test("per-period accumulation across two months and two resources; margin = external - internal per row", () => {
    const twoMonths: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-02-28", granularity: "month", currency: "EUR" };
    const resources: Resource[] = [
      { id: 1, firstName: "A", lastName: "", roleId: 5, utilizationMode: "percent", utilization: { "2026-01": 100, "2026-02": 100 } },
      { id: 2, firstName: "B", lastName: "", roleId: 5, utilizationMode: "percent", utilization: { "2026-01": 50 } },
    ];
    const rep = computeResourceReport(resources, roles, disciplines, grades, twoMonths, [], new Set(), 8);
    // Jan 2026 = 176h @100%; Feb 2026 = 160h @100%.
    const jan = rep.perPeriod.find((p) => p.key === "2026-01")!;
    const feb = rep.perPeriod.find((p) => p.key === "2026-02")!;
    expect(jan.capacityHours).toBeCloseTo(176 + 88, 5); // A 176 + B 88
    expect(feb.capacityHours).toBeCloseTo(160, 5); // A only
    for (const row of rep.perPeriod) {
      expect(row.margin).toBeCloseTo(row.external - row.internal, 6);
    }
    // avgUtilization averages across BOTH periods (B's missing Feb counts as 0).
    expect(rep.perResource.find((r) => r.id === 2)!.avgUtilization).toBeCloseTo(25, 6);
  });

  test("discipline/grade breakdowns are sorted by label", () => {
    const disc: Discipline[] = [{ id: 1, name: "Zeta" }, { id: 2, name: "Alpha" }, { id: 3, name: "Mu" }];
    const gr: Grade[] = [{ id: 1, name: "G" }];
    const rs: Role[] = [
      { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 200 },
      { id: 2, disciplineId: 2, gradeId: 1, internalRate: 100, externalRate: 200 },
      { id: 3, disciplineId: 3, gradeId: 1, internalRate: 100, externalRate: 200 },
    ];
    const resources: Resource[] = rs.map((role, i) => ({
      id: i + 1, firstName: `R${i}`, lastName: "", roleId: role.id,
      utilizationMode: "percent", utilization: { "2026-02": 100 },
    }));
    const rep = computeResourceReport(resources, rs, disc, gr, plan, [], new Set(), 8);
    expect(rep.perDiscipline.map((d) => d.label)).toEqual(["Alpha", "Mu", "Zeta"]);
  });

  test("role referencing unknown discipline/grade ids falls back to 'n/a' labels", () => {
    const orphanRole: Role[] = [{ id: 5, disciplineId: 99, gradeId: 88, internalRate: 100, externalRate: 200 }];
    const resources: Resource[] = [
      { id: 1, firstName: "X", lastName: "", roleId: 5, utilizationMode: "percent", utilization: { "2026-02": 100 } },
    ];
    const rep = computeResourceReport(resources, orphanRole, [], [], plan, [], new Set(), 8);
    expect(rep.perDiscipline[0].label).toBe("n/a");
    expect(rep.perGrade[0].label).toBe("n/a");
  });

  test("two resources sharing one role merge into a single combo row (headcount 2)", () => {
    const resources: Resource[] = [
      { id: 1, firstName: "A", lastName: "", roleId: 5, utilizationMode: "percent", utilization: { "2026-02": 100 } },
      { id: 2, firstName: "B", lastName: "", roleId: 5, utilizationMode: "percent", utilization: { "2026-02": 100 } },
    ];
    const rep = computeResourceReport(resources, roles, disciplines, grades, plan, [], new Set(), 8);
    expect(rep.perCombo).toHaveLength(1);
    expect(rep.perCombo[0]).toMatchObject({ headcount: 2 });
    expect(rep.perCombo[0].capacityHours).toBeCloseTo(320, 5); // 160 + 160
  });

  test("degenerate plan (start after end) yields no periods and zeroed avgUtilization", () => {
    const empty: ResourcePlan = { startDate: "2026-03-01", endDate: "2026-02-01", granularity: "month", currency: "EUR" };
    const resources: Resource[] = [
      { id: 1, firstName: "A", lastName: "", roleId: 5, utilizationMode: "percent", utilization: { "2026-02": 100 } },
    ];
    const rep = computeResourceReport(resources, roles, disciplines, grades, empty, [], new Set(), 8);
    expect(rep.perPeriod).toEqual([]);
    expect(rep.totalCapacityHours).toBe(0);
    expect(rep.perResource[0].avgUtilization).toBe(0); // periods.length === 0 guard
  });
});
