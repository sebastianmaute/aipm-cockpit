import { describe, expect, test } from "vitest";
import { workspaceToJson, jsonToWorkspace, emptyWorkspace } from "./storage";

describe("budget JSON round-trip", () => {
  test("budgets + fxRates survive JSON encode/decode", () => {
    const ws = {
      ...emptyWorkspace(),
      budgets: [{
        id: 1, name: "PAM", type: "tm" as const, currency: "EUR" as const,
        startDate: "2026-01-01", endDate: "2026-06-30", status: "open" as const,
        allocations: [{ roleId: 3, resourceIds: [5, 7], budgetHours: { "2026-01": 40 }, actualHours: { "2026-01": 38 } }],
      }],
      fxRates: { base: "EUR" as const, date: "2026-05-26", fetchedAt: "2026-05-26T10:00:00Z", rates: { EUR: 1, USD: 1.08, GBP: 0.85 } },
    };
    const back = jsonToWorkspace(workspaceToJson(ws));
    expect(back.budgets).toHaveLength(1);
    expect(back.budgets![0].allocations[0].actualHours).toEqual({ "2026-01": 38 });
    expect(back.fxRates?.rates.USD).toBe(1.08);
  });
  test("jsonToWorkspace tolerates a legacy envelope without budgets", () => {
    const legacy = JSON.stringify({ schemaVersion: 5, tasks: [], raid: [] });
    const back = jsonToWorkspace(legacy);
    expect(back.budgets).toEqual([]);
    expect(back.fxRates).toBeNull();
  });
});
