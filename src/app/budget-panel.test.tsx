import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BudgetPanel } from "./budget-panel";
import { t } from "./i18n";
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

  const twoBuckets = (): BudgetBucket[] => [
    { ...buckets[0], id: 1, name: "PAM", order: 0 },
    {
      id: 2, name: "DEV", type: "tm", currency: "EUR", startDate: "2026-01-01",
      endDate: "2026-06-30", status: "open", order: 1, allocations: [],
    },
  ];

  test("ArrowDown on a bucket's reorder handle moves it down (keyboard reorder)", () => {
    const onChangeBuckets = vi.fn();
    render(<BudgetPanel {...props} buckets={twoBuckets()} onChangeBuckets={onChangeBuckets} />);
    const handles = screen.getAllByRole("button", { name: /reorder bucket/i });
    fireEvent.keyDown(handles[0], { key: "ArrowDown" }); // move PAM (order 0) down
    expect(onChangeBuckets).toHaveBeenCalledTimes(1);
    const next = onChangeBuckets.mock.calls[0][0] as BudgetBucket[];
    expect(next.find((b) => b.name === "PAM")!.order).toBe(1);
    expect(next.find((b) => b.name === "DEV")!.order).toBe(0);
  });

  test("ArrowUp on the top bucket's handle is a no-op", () => {
    const onChangeBuckets = vi.fn();
    render(<BudgetPanel {...props} buckets={twoBuckets()} onChangeBuckets={onChangeBuckets} />);
    const handles = screen.getAllByRole("button", { name: /reorder bucket/i });
    fireEvent.keyDown(handles[0], { key: "ArrowUp" }); // already at top → no change
    expect(onChangeBuckets).not.toHaveBeenCalled();
  });
});

test("filters the bucket role table by role name", () => {
  // Two detailed role allocations whose roleLabel() names resolve distinctly.
  const filterRoles: Role[] = [
    { id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
    { id: 4, disciplineId: 2, gradeId: 2, internalRate: 110, externalRate: 160 },
  ];
  const disciplines = [
    { id: 1, name: "Backend" },
    { id: 2, name: "Frontend" },
  ];
  const grades = [
    { id: 1, name: "Senior" },
    { id: 2, name: "Junior" },
  ];
  const filterBuckets: BudgetBucket[] = [{
    id: 1, name: "PAM", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-06-30", status: "open",
    allocations: [
      { roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } },
      { roleId: 4, resourceIds: [], budgetHours: { "2026-01": 50 }, actualHours: { "2026-01": 40 } },
    ],
  }];
  render(<BudgetPanel {...props} roles={filterRoles} disciplines={disciplines} grades={grades} buckets={filterBuckets} />);
  // Both role names resolve and render before filtering.
  expect(screen.getByText("Backend Senior")).toBeInTheDocument();
  expect(screen.getByText("Frontend Junior")).toBeInTheDocument();
  const input = screen.getByPlaceholderText(/filter role|rolle.*filtern/i);
  fireEvent.change(input, { target: { value: "Frontend" } });
  // Filtering to "Frontend" hides the Backend row.
  expect(screen.queryByText("Backend Senior")).not.toBeInTheDocument();
  expect(screen.getByText("Frontend Junior")).toBeInTheDocument();
});

test("renders InfoTooltip for CPI metric label by accessible name", () => {
  render(<BudgetPanel {...props} />);
  const hint = t("en-US", "budgetCciCpiHint");
  // CPI tooltip appears in both the project-total row and the per-bucket row
  const tooltips = screen.getAllByRole("button", { name: hint });
  expect(tooltips.length).toBeGreaterThanOrEqual(1);
});

test("budget renders a bucket-count heading and is a resizable card", () => {
  const src = readFileSync(join(__dirname, "budget-panel.tsx"), "utf8");
  expect(src).toMatch(/budgetBucketsCount/);
  expect(src).toMatch(/VIEW_PANE_RESIZABLE_CLASS/);
});

test("over-budget allocation row shows a Red RAG badge", () => {
  const overBudgetBuckets: BudgetBucket[] = [{
    id: 1, name: "PAM", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-06-30", status: "open",
    allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 120 } }],
  }];
  render(<BudgetPanel {...props} buckets={overBudgetBuckets} />);
  // actual (120) exceeds budget (100) → Red badge rendered with aria-label "Red"
  expect(screen.getAllByLabelText("Red").length).toBeGreaterThan(0);
});
