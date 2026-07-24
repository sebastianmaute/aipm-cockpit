import { describe, expect, test } from "vitest";
import { workspaceToCsv, csvToWorkspace, emptyWorkspace } from "./storage";

function wsWithBudget() {
  const ws = emptyWorkspace();
  return {
    ...ws,
    budgets: [{
      id: 1, name: "PAM, Phase 1", type: "tm" as const, currency: "USD" as const,
      startDate: "2026-01-01", endDate: "2026-06-30", status: "open" as const,
      successorId: 2, fxRateOverride: 1.09,
      allocations: [{ roleId: 3, resourceIds: [5, 7], budgetHours: { "2026-01": 40 }, actualHours: { "2026-01": 38 } }],
    }],
    fxRates: { base: "EUR" as const, date: "2026-05-26", fetchedAt: "2026-05-26T10:00:00Z", rates: { EUR: 1, USD: 1.08, GBP: 0.85 } },
  };
}

describe("budget CSV round-trip", () => {
  test("budgets + fxRates survive CSV encode/decode", () => {
    const ws = wsWithBudget();
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.budgets).toHaveLength(1);
    expect(back.budgets![0].name).toBe("PAM, Phase 1");
    expect(back.budgets![0].currency).toBe("USD");
    expect(back.budgets![0].successorId).toBe(2);
    expect(back.budgets![0].allocations[0]).toEqual({ roleId: 3, resourceIds: [5, 7], budgetHours: { "2026-01": 40 }, actualHours: { "2026-01": 38 } });
    expect(back.fxRates?.rates.USD).toBe(1.08);
  });

  test("bucket `order` survives CSV encode/decode", () => {
    const ws = emptyWorkspace();
    const wsWithOrder = {
      ...ws,
      budgets: [{
        id: 1, name: "Ordered bucket", type: "tm" as const, currency: "EUR" as const,
        startDate: "2026-01-01", endDate: "2026-06-30", status: "open" as const,
        order: 3, allocations: [],
      }],
    };
    const back = csvToWorkspace(workspaceToCsv(wsWithOrder));
    expect(back.budgets![0].order).toBe(3);
  });

  test("bucket taskIds and percentComplete survive CSV encode/decode", () => {
    const ws = {
      ...emptyWorkspace(),
      budgets: [{
        id: 1, name: "EV bucket", type: "tm" as const, currency: "EUR" as const,
        startDate: "2026-01-01", endDate: "2026-06-30", status: "open" as const,
        taskIds: [3, 4], percentComplete: 40, allocations: [],
      }],
    };
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.budgets![0].taskIds).toEqual([3, 4]);
    expect(back.budgets![0].percentComplete).toBe(40);
  });

  test("a manual percentComplete of 0 survives a CSV round-trip (not dropped as falsy)", () => {
    const ws = {
      ...emptyWorkspace(),
      budgets: [{
        id: 1, name: "EV bucket", type: "tm" as const, currency: "EUR" as const,
        startDate: "2026-01-01", endDate: "2026-06-30", status: "open" as const,
        taskIds: [3, 4], percentComplete: 0, allocations: [],
      }],
    };
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.budgets![0].percentComplete).toBe(0);
  });

  test("blended planningMode, disciplineAllocations, and rate overrides survive CSV encode/decode", () => {
    const ws = {
      ...emptyWorkspace(),
      budgets: [{
        id: 1, name: "Blended bucket", type: "tm" as const, currency: "EUR" as const,
        startDate: "2026-01-01", endDate: "2026-06-30", status: "open" as const,
        planningMode: "blended" as const,
        disciplineAllocations: [{ disciplineId: 2, resourceIds: [5, 7], budgetHours: { "2026-01": 30 }, actualHours: { "2026-01": 28 } }],
        rateOverrideInternal: 90, rateOverrideExternal: 200,
        allocations: [],
      }],
    };
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.budgets![0].planningMode).toBe("blended");
    expect(back.budgets![0].disciplineAllocations).toEqual([
      { disciplineId: 2, resourceIds: [5, 7], budgetHours: { "2026-01": 30 }, actualHours: { "2026-01": 28 } },
    ]);
    expect(back.budgets![0].rateOverrideInternal).toBe(90);
    expect(back.budgets![0].rateOverrideExternal).toBe(200);
  });
});
