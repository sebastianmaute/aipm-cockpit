import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BudgetPanel } from "./budget-panel";
import type { BudgetBucket, Role, ResourcePlan } from "./types";

const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };
const roles: Role[] = [{ id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];

function props(buckets: BudgetBucket[], onChangeBuckets = vi.fn()) {
  return {
    lang: "en-US" as const, buckets, roles, disciplines: [{ id: 1, name: "Consulting" }], grades: [{ id: 1, name: "Senior" }],
    resources: [], plan, fxRates: null, absences: [], holidaySet: new Set<string>(), workdayHours: 8, today: "2026-02-01",
    onChangeBuckets, onRefreshFx: vi.fn(),
  };
}

describe("BudgetPanel editing", () => {
  test("Add bucket calls onChangeBuckets with a new bucket", async () => {
    const onChange = vi.fn();
    render(<BudgetPanel {...props([], onChange)} />);
    await userEvent.click(screen.getByRole("button", { name: /Add bucket/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as BudgetBucket[];
    expect(next).toHaveLength(1);
    expect(next[0].status).toBe("open");
  });

  test("editing an actual-hours cell emits an updated bucket", async () => {
    const onChange = vi.fn();
    const buckets: BudgetBucket[] = [{
      id: 1, name: "PAM", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } }],
    }];
    render(<BudgetPanel {...props(buckets, onChange)} />);
    const cell = screen.getByLabelText("actual-1-3-2026-01");
    await userEvent.clear(cell);
    await userEvent.type(cell, "90");
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)![0] as BudgetBucket[];
    expect(last[0].allocations[0].actualHours["2026-01"]).toBe(90);
  });
});
