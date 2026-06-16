import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { markdownToWorkspace } from "./storage";
import { computeBudgetReport } from "./budget-report";

const md = readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.md"), "utf8");
const ws = markdownToWorkspace(md);

describe("sample-workspace budgets", () => {
  test("parses five buckets", () => {
    expect(ws.budgets?.map((b) => b.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
  test("bucket 1 is detailed with three role allocations and real hours", () => {
    const b = ws.budgets!.find((x) => x.id === 1)!;
    expect(b.planningMode ?? "detailed").toBe("detailed");
    expect(b.allocations).toHaveLength(3);
    const r1 = b.allocations.find((a) => a.roleId === 1)!;
    expect(r1.budgetHours["2026-04"]).toBe(120);
    expect(r1.actualHours["2026-05"]).toBe(130);
  });
  test("bucket 2 is blended with two discipline allocations", () => {
    const b = ws.budgets!.find((x) => x.id === 2)!;
    expect(b.planningMode).toBe("blended");
    expect(b.disciplineAllocations).toHaveLength(2);
    expect(b.disciplineAllocations!.find((a) => a.disciplineId === 3)!.budgetHours["2026-04"]).toBe(80);
  });
  test("bucket 3 carries per-bucket rate overrides", () => {
    const b = ws.budgets!.find((x) => x.id === 3)!;
    expect(b.rateOverrideInternal).toBe(90);
    expect(b.rateOverrideExternal).toBe(200);
  });
  test("bucket 4 is fixed-price", () => {
    const b = ws.budgets!.find((x) => x.id === 4)!;
    expect(b.type).toBe("fixed");
    expect(b.fixedPriceAmount).toBe(80000);
  });
  test("bucket 5 is closed with a successor", () => {
    const b = ws.budgets!.find((x) => x.id === 5)!;
    expect(b.status).toBe("closed");
    expect(b.successorId).toBe(1);
  });
  test("computeBudgetReport yields a realistic project rollup (cost from role rates, not zeroed)", () => {
    const rep = computeBudgetReport(ws.budgets!, ws.plan, ws.roles, ws.resources, 8, new Set<string>(), ws.absences);
    expect(rep.project.actualHours).toBeGreaterThan(1000);
    expect(rep.project.cost).toBeGreaterThan(80000);   // would be ~9000 if empty overrides zeroed the rates
    expect(rep.project.revenue).toBeGreaterThan(80000);
  });
});
