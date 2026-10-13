import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BudgetPanel } from "./budget-panel";
import { t } from "./i18n";
import { budgetSetupDismissKey } from "./budget-setup";
import type { BudgetBucket, ResourcePlan, Role } from "./types";

const L = "en-US" as const;
const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };
const roles: Role[] = [{ id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
const bucket = (actual: Record<string, number> = {}): BudgetBucket => ({
  id: 1, name: "Acme phase 1", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-06-30", status: "open",
  allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: actual }],
});
const base = {
  lang: L, buckets: [] as BudgetBucket[], roles, disciplines: [], grades: [], resources: [],
  plan, fxRates: null, absences: [], holidaySet: new Set<string>(), workdayHours: 8, today: "2026-02-01",
  onChangeBuckets: vi.fn(), onRefreshFx: vi.fn(), timelogProjectId: "acme",
};
const collapsedLine = (n: number) => screen.queryByText(t(L, "budgetSetupCollapsed", n));
const hideBtn = () => screen.queryByRole("button", { name: t(L, "budgetSetupDismiss") });

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("BudgetPanel setup checklist", () => {
  test("an empty budget shows the expanded checklist with the add-bucket button in row 3", async () => {
    const onChangeBuckets = vi.fn();
    render(<BudgetPanel {...base} onChangeBuckets={onChangeBuckets} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    await userEvent.setup().click(screen.getByRole("button", { name: `+ ${t(L, "budgetAddBucket")}…` }));
    expect(onChangeBuckets).toHaveBeenCalledTimes(1);
  });

  test("once a bucket exists it collapses to a one-line summary above the table", () => {
    render(<BudgetPanel {...base} buckets={[bucket()]} />);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    // rates (role has a rate) + bucket = 2 of 4; no people yet.
    expect(collapsedLine(2)).toBeInTheDocument();
    expect(hideBtn()).toBeInTheDocument();
  });

  test("it disappears once a booking exists", () => {
    render(<BudgetPanel {...base} buckets={[bucket({ "2026-01": 8 })]} />);
    expect(collapsedLine(3)).toBeNull();
    expect(hideBtn()).toBeNull();
  });

  test("dismissing hides it, persists per project, and a fresh mount stays hidden", async () => {
    const { unmount } = render(<BudgetPanel {...base} buckets={[bucket()]} />);
    await userEvent.setup().click(hideBtn()!);
    expect(hideBtn()).toBeNull();
    expect(window.localStorage.getItem(budgetSetupDismissKey("acme"))).toBe("1");
    unmount();
    render(<BudgetPanel {...base} buckets={[bucket()]} />);
    expect(hideBtn()).toBeNull();
  });

  test("a dismissal for one project does not hide another project's line", () => {
    window.localStorage.setItem(budgetSetupDismissKey("acme"), "1");
    render(<BudgetPanel {...base} buckets={[bucket()]} timelogProjectId="other" />);
    expect(hideBtn()).toBeInTheDocument();
  });

  test("a dismissed project that later has no bucket still shows the expanded checklist", () => {
    window.localStorage.setItem(budgetSetupDismissKey("acme"), "1");
    render(<BudgetPanel {...base} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  test("in a popout, dismissing hides the line for now but writes nothing", async () => {
    render(<BudgetPanel {...base} buckets={[bucket()]} isPopout />);
    await userEvent.setup().click(hideBtn()!);
    expect(hideBtn()).toBeNull();
    expect(window.localStorage.getItem(budgetSetupDismissKey("acme"))).toBeNull();
  });

  test("without the link callbacks (popout) the go, tour and demo links are absent", () => {
    render(<BudgetPanel {...base} isPopout />);
    expect(screen.queryByRole("button", { name: t(L, "budgetSetupGoRoles") })).toBeNull();
    expect(screen.queryByRole("button", { name: t(L, "budgetSetupTour") })).toBeNull();
    expect(screen.queryByRole("button", { name: t(L, "budgetSetupDemo") })).toBeNull();
  });

  test("the callbacks given by the workspace section reach the checklist", async () => {
    const onSetupGo = vi.fn();
    const onStartTour = vi.fn();
    const onLoadDemo = vi.fn();
    render(<BudgetPanel {...base} onSetupGo={onSetupGo} onStartTour={onStartTour} onLoadDemo={onLoadDemo} />);
    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: t(L, "budgetSetupGoRoles") }));
    await u.click(screen.getByRole("button", { name: t(L, "budgetSetupTour") }));
    await u.click(screen.getByRole("button", { name: t(L, "budgetSetupDemo") }));
    expect(onSetupGo).toHaveBeenCalledWith("manage-roles");
    expect(onStartTour).toHaveBeenCalledWith("budget-changes");
    expect(onLoadDemo).toHaveBeenCalledTimes(1);
  });
});
