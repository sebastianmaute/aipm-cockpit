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
  // Gamma: actualHours (120) > budgetHours (80) → R on both leading status (consumed > budget) and Actual (h) cell
  { id: 3, name: "Gamma", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
    allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 80 }, actualHours: { "2026-01": 120 } }] },
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
    // revenue = 80*180 + 50*150 + 120*150 = 39900 ; cost = 80*120 + 50*100 + 120*100 = 26600
    // Every bucket here is T&M, where consumed value IS revenue, so the figure
    // renders TWICE: once on the revenue tile, once on the consumption tile.
    // Pinned exactly — a bare "at least one" would not notice a third.
    expect(screen.getAllByText(/€?39,900|39\.900/)).toHaveLength(2);
    expect(screen.getByText(/€?26,600|26\.600/)).toBeInTheDocument();
  });

  it("lists a row per bucket with its planning mode", () => {
    renderPanel();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
    expect(screen.getByText("Blended")).toBeInTheDocument();
    // Beta and Gamma are both Detailed; getAllByText handles multiple matches
    expect(screen.getAllByText("Detailed").length).toBeGreaterThanOrEqual(2);
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

  it("shows a RAG badge on the Actual (h) cell judged vs budget hours", () => {
    // Gamma bucket: actualHours (120) > budgetHours (80) → R on the Actual (h) cell.
    // The Gamma row also has R on the leading status cell (consumedValue > budgetValue).
    // Scope the assertion to the Gamma row so it cannot become vacuous from unrelated R badges.
    renderPanel();
    const gammaRow = screen.getByText("Gamma").closest("tr")!;
    // Leading status (consumed > budget) + Actual (h) cell (actualHours > budgetHours) = ≥2 R badges.
    expect(within(gammaRow).getAllByText("R").length).toBeGreaterThanOrEqual(2);
  });

  it("renders the burn-down caption beneath the chart", () => {
    renderPanel();
    expect(screen.getByText(/burn-down shows remaining budget/i)).toBeTruthy();
  });

  it("carries RAG badges on the project-total Plan (h), Actual (h) and Revenue tiles", () => {
    renderPanel();
    // Scope to the project-total Section so the detail table's Actual (h) badge does not collide.
    // Section renders <div><h3>{title}</h3>{children}</div>, so the heading's parent div is the scope.
    const total = screen.getByText(/project total/i).parentElement!;
    const totalScope = within(total);
    expect(totalScope.getByTitle("Plan (h)")).toBeInTheDocument();
    expect(totalScope.getByTitle("Actual (h)")).toBeInTheDocument();
    expect(totalScope.getByTitle("Revenue")).toBeInTheDocument();
  });
});
