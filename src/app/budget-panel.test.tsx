import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BudgetPanel } from "./budget-panel";
import type { BudgetBucket, Role, ResourcePlan } from "./types";

const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };
const roles: Role[] = [{ id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
const buckets: BudgetBucket[] = [{
  id: 1, name: "PAM", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-06-30", status: "open",
  allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } }],
}];

const props = {
  lang: "en-US" as const, buckets, roles, disciplines: [], grades: [], resources: [],
  plan, fxRates: null, absences: [], holidaySet: new Set<string>(), workdayHours: 8, today: "2026-02-01",
  onChangeBuckets: vi.fn(), onRefreshFx: vi.fn(),
};

describe("BudgetPanel", () => {
  test("renders the project total contribution margin", () => {
    render(<BudgetPanel {...props} />);
    expect(screen.getByText(/Project total/i)).toBeInTheDocument();
    expect(screen.getAllByText(/4,000|4000/).length).toBeGreaterThan(0); // 80×150 − 80×100
  });
  test("lists each bucket by name", () => {
    render(<BudgetPanel {...props} />);
    expect(screen.getByText("PAM")).toBeInTheDocument();
  });
});
