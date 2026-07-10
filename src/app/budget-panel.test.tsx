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

  test("budget: bucket period date header is not right-aligned", () => {
    const oneMonthBuckets: BudgetBucket[] = [{
      id: 1, name: "PAM", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } }],
    }];
    render(<BudgetPanel {...props} buckets={oneMonthBuckets} />);
    const th = screen.getByRole("columnheader", { name: /\d{4}-\d{2}/ });
    expect(th.className).not.toMatch(/text-right/);
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

  test("budget: toggling 'budget hours follow plan' calls the setter", () => {
    const onSetBudgetFollowsPlan = vi.fn();
    render(<BudgetPanel {...props} onSetBudgetFollowsPlan={onSetBudgetFollowsPlan} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /budget hours follow plan/i }));
    expect(onSetBudgetFollowsPlan).toHaveBeenCalledWith(true);
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

test("budget: bucket-name search filters buckets", () => {
  const twoNamed: BudgetBucket[] = [
    { ...buckets[0], id: 1, name: "Alpha", order: 0 },
    { ...buckets[0], id: 2, name: "Beta", order: 1 },
  ];
  render(<BudgetPanel {...props} buckets={twoNamed} />);
  // Both buckets render before filtering.
  expect(screen.getByText("Alpha")).toBeInTheDocument();
  expect(screen.getByText("Beta")).toBeInTheDocument();
  // The bucket filter box is distinct from the role filter (distinct accessible name).
  const box = screen.getByLabelText(/filter buckets/i);
  fireEvent.change(box, { target: { value: "alph" } });
  expect(screen.getByText("Alpha")).toBeInTheDocument();
  expect(screen.queryByText("Beta")).not.toBeInTheDocument();
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

describe("Cci primary prop", () => {
  // We test Cci by rendering BudgetPanel with a bucket that has known CCI values
  // and checking which number appears as the big figure vs the small figure.
  // With primary="percent" on CPI and Consumption, the big figure is the percent string.
  // With default (Margin), the big figure is the currency amount.

  const cciProps = {
    ...props,
    buckets: [{
      id: 1, name: "B1", type: "tm" as const, currency: "EUR" as const,
      startDate: "2026-01-01", endDate: "2026-06-30", status: "open" as const,
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 95 } }],
    }],
  };

  test("CPI card shows percent as big figure and currency as small figure", () => {
    render(<BudgetPanel {...cciProps} />);
    // There are two CPI cards (project-total + per-bucket). We look at all text-lg elements.
    // The big figure for CPI with primary="percent" must contain a "%" string.
    // CPI and Consumption big figures should contain "%"
    const cpiLabel = t("en-US", "budgetCciCpi");
    // Find a card whose label is CPI
    const cards = Array.from(document.querySelectorAll(".rounded-lg.border.border-line.p-3"));
    const cpiCards = cards.filter((c) => c.textContent?.includes(cpiLabel));
    expect(cpiCards.length).toBeGreaterThanOrEqual(1);
    for (const card of cpiCards) {
      const big = card.querySelector(".text-lg.font-semibold");
      expect(big?.textContent).toMatch(/%/);
    }
  });

  test("Consumption card shows percent as big figure", () => {
    render(<BudgetPanel {...cciProps} />);
    const consumptionLabel = t("en-US", "budgetCciConsumption");
    const cards = Array.from(document.querySelectorAll(".rounded-lg.border.border-line.p-3"));
    const consumptionCards = cards.filter((c) => c.textContent?.includes(consumptionLabel));
    expect(consumptionCards.length).toBeGreaterThanOrEqual(1);
    for (const card of consumptionCards) {
      const big = card.querySelector(".text-lg.font-semibold");
      expect(big?.textContent).toMatch(/%/);
    }
  });

  test("Margin card shows currency amount as big figure (default primary=amount)", () => {
    render(<BudgetPanel {...cciProps} />);
    const marginLabel = t("en-US", "budgetCciMargin");
    const cards = Array.from(document.querySelectorAll(".rounded-lg.border.border-line.p-3"));
    const marginCards = cards.filter((c) => c.textContent?.includes(marginLabel));
    expect(marginCards.length).toBeGreaterThanOrEqual(1);
    for (const card of marginCards) {
      const big = card.querySelector(".text-lg.font-semibold");
      // Currency amount big figure should NOT be just a percent string (it's a formatted number)
      expect(big?.textContent).not.toMatch(/^\s*\d+\.\d+%\s*$/);
    }
  });
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
