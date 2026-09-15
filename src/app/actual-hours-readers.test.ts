import { describe, expect, it } from "vitest";
import { bucketBudgetGrid, type TotalsRow } from "./budget-panel-totals";

describe("bucketBudgetGrid actual totals", () => {
  it("counts day keys inside each period column and in the grand total", () => {
    const rows: TotalsRow[] = [
      { resourceIds: [], budgetHours: {}, actualHours: { "2026-01": 2, "2026-01-05": 3, "2026-02-02": 7 } },
      { resourceIds: [], budgetHours: {}, actualHours: { "2026-02": 1 } },
    ];
    const grid = bucketBudgetGrid(rows, [{ key: "2026-01" }, { key: "2026-02" }], () => 0);
    expect(grid.columns.map((c) => c.actual)).toEqual([5, 8]);
    expect(grid.grandActual).toBe(13);
  });
});
