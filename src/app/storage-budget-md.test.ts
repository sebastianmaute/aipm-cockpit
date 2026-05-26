import { describe, expect, test } from "vitest";
import { workspaceToMarkdown, markdownToWorkspace, emptyWorkspace } from "./storage";

describe("budget Markdown round-trip", () => {
  test("budgets + fxRates survive MD encode/decode", () => {
    const ws = {
      ...emptyWorkspace(),
      budgets: [{
        id: 1, name: "PAM", type: "fixed" as const, currency: "GBP" as const,
        fixedPriceAmount: 50000, startDate: "2026-01-01", endDate: "2026-06-30", status: "open" as const,
        allocations: [{ roleId: 3, resourceIds: [5], budgetHours: { "2026-01": 40 }, actualHours: {} }],
      }],
      fxRates: { base: "EUR" as const, date: "2026-05-26", fetchedAt: "2026-05-26T10:00:00Z", rates: { EUR: 1, USD: 1.08, GBP: 0.85 } },
    };
    const back = markdownToWorkspace(workspaceToMarkdown(ws));
    expect(back.budgets![0].type).toBe("fixed");
    expect(back.budgets![0].fixedPriceAmount).toBe(50000);
    expect(back.budgets![0].allocations[0].budgetHours).toEqual({ "2026-01": 40 });
    expect(back.fxRates?.rates.GBP).toBe(0.85);
  });
});
