import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BudgetReportPanel } from "./budget-report-panel";
import type { BudgetBucket, ResourcePlan, Role } from "./types";

const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-01-31", granularity: "month", currency: "EUR" };
// Discipline 1 grades average to internal 120 / external 180.
const roles: Role[] = [
  { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
  { id: 2, disciplineId: 1, gradeId: 2, internalRate: 140, externalRate: 210 },
];
const buckets: BudgetBucket[] = [
  { id: 1, name: "Alpha", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
    planningMode: "blended", allocations: [],
    disciplineAllocations: [{ disciplineId: 1, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } }] },
  { id: 2, name: "Beta", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-01-31", status: "closed",
    allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 50 }, actualHours: { "2026-01": 50 } }] },
];

function renderPanel(over: Partial<React.ComponentProps<typeof BudgetReportPanel>> = {}) {
  return render(
    <BudgetReportPanel
      lang="en-US"
      buckets={buckets}
      plan={plan}
      roles={roles}
      resources={[]}
      absences={[]}
      holidaySet={new Set<string>()}
      workdayHours={8}
      fxRates={null}
      tasks={[]}
      today="2026-06-02"
      {...over}
    />,
  );
}

describe("BudgetReportPanel", () => {
  it("shows the project rollup (revenue + cost in EUR)", () => {
    renderPanel();
    // revenue = 80*180 + 50*150 = 21900 ; cost = 80*120 + 50*100 = 14600
    expect(screen.getByText(/€?21,900|21\.900/)).toBeInTheDocument();
    expect(screen.getByText(/€?14,600|14\.600/)).toBeInTheDocument();
  });

  it("lists a row per bucket with its planning mode", () => {
    renderPanel();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Blended")).toBeInTheDocument();
    expect(screen.getByText("Detailed")).toBeInTheDocument();
  });

  it("filters the bucket table by name", async () => {
    const user = userEvent.setup();
    renderPanel();
    const input = screen.getByPlaceholderText(/filter buckets/i);
    await user.type(input, "alpha");
    const table = within(screen.getByRole("table"));
    const rows = table.getAllByRole("row").slice(1); // skip header row
    const names = rows.map((tr) => (tr.querySelectorAll("td")[1] as HTMLElement)?.textContent ?? "");
    expect(names).toContain("Alpha");
    expect(names).not.toContain("Beta");
  });

  it("shows the empty state when there are no buckets", () => {
    renderPanel({ buckets: [] });
    expect(screen.getByText(/no budget buckets yet/i)).toBeInTheDocument();
  });

  it("embedded mode renders content without the ReportCard print button", () => {
    renderPanel({ embedded: true });
    expect(screen.getByText(/project total/i)).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /print/i })).toBeNull();
  });

  it("renders the burn-down section with both chart captions", () => {
    renderPanel();
    expect(screen.getByText("Burn-down")).toBeTruthy();
    expect(screen.getByText("Hours remaining")).toBeTruthy();
  });
});
