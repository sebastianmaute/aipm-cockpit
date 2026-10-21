import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BudgetPanel } from "./budget-panel";
import { defaultAiConfig } from "./settings-types";
import { t } from "./i18n";
import { BUDGET_SETUP_STEP_COUNT, budgetSetupDismissKey } from "./budget-setup";
import { setDisabledIntegrations } from "./integration-switches";
import type { BudgetBucket, ResourcePlan, Role } from "./types";

const L = "en-US" as const;
const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };
const roles: Role[] = [{ id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
const bucket = (actual: Record<string, number> = {}): BudgetBucket => ({
  id: 1, name: "Acme phase 1", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-06-30", status: "open",
  allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: actual }],
});
const base = {
  ai: defaultAiConfig,
  lang: L, buckets: [] as BudgetBucket[], roles, disciplines: [], grades: [], resources: [],
  plan, fxRates: null, absences: [], holidaySet: new Set<string>(), workdayHours: 8, today: "2026-02-01",
  onChangeBuckets: vi.fn(), onRefreshFx: vi.fn(), timelogProjectId: "acme",
};
const collapsedLine = (n: number) => screen.queryByText(t(L, "budgetSetupCollapsed", n, BUDGET_SETUP_STEP_COUNT));
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

  test("a go-link whose function is off becomes a hint, and Turn on commits the function (§710)", async () => {
    const onCommitFeatures = vi.fn();
    render(<BudgetPanel {...base} onSetupGo={vi.fn()} features={["budget"]} onCommitFeatures={onCommitFeatures} />);
    expect(screen.queryByRole("button", { name: t(L, "budgetSetupGoRoles") })).toBeNull();
    expect(screen.getAllByText(t(L, "budgetSetupModuleOff", t(L, "tabResources")))).toHaveLength(2);
    await userEvent.setup().click(screen.getByRole("button", { name: t(L, "budgetSetupTurnOnAria", t(L, "tabResources"), t(L, "budgetSetupRates")) }));
    expect(onCommitFeatures).toHaveBeenCalledWith(["resources", "budget"]);
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

  test("opening and closing the steps does not undo a dismissal, whenever it is made", async () => {
    const u = userEvent.setup();
    const { unmount } = render(<BudgetPanel {...base} buckets={[bucket()]} />);
    const show = () => screen.getByRole("button", { name: t(L, "budgetSetupShowAria") });
    await u.click(show());
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    await u.click(screen.getByRole("button", { name: t(L, "budgetSetupHideAria") }));
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    // Dismissed after a full open/close cycle...
    await u.click(hideBtn()!);
    expect(hideBtn()).toBeNull();
    expect(collapsedLine(3)).toBeNull();
    unmount();
    // ...it is still gone on a fresh mount, and stays gone while the steps are open on another.
    render(<BudgetPanel {...base} buckets={[bucket()]} />);
    expect(hideBtn()).toBeNull();
    expect(collapsedLine(3)).toBeNull();
  });

  test("dismissing while the steps are open hides the whole line, steps included", async () => {
    const u = userEvent.setup();
    render(<BudgetPanel {...base} buckets={[bucket()]} />);
    await u.click(screen.getByRole("button", { name: t(L, "budgetSetupShowAria") }));
    await u.click(hideBtn()!);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryByRole("region", { name: t(L, "budgetSetupTitle") })).toBeNull();
    expect(window.localStorage.getItem(budgetSetupDismissKey("acme"))).toBe("1");
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

describe("§762 — setup checklist with timelog switched off by the deployment", () => {
  afterEach(() => setDisabledIntegrations([]));
  test("§762 — timelog on, bucket without bookings: the collapsed checklist is shown (positive control)", () => {
    render(<BudgetPanel {...base} buckets={[bucket()]} />);
    expect(collapsedLine(2)).toBeInTheDocument();
    expect(hideBtn()).toBeInTheDocument();
  });
  test("§762 — timelog off, bucket without bookings: no checklist, and no \"N of 3\" line either", () => {
    setDisabledIntegrations(["timelog"]);
    render(<BudgetPanel {...base} buckets={[bucket()]} />);
    expect(screen.queryByText(t(L, "budgetSetupCollapsed", 2, BUDGET_SETUP_STEP_COUNT - 1))).toBeNull();
    expect(collapsedLine(2)).toBeNull();
    expect(hideBtn()).toBeNull();
    expect(screen.queryByRole("button", { name: t(L, "budgetSetupShowAria") })).toBeNull();
  });
  test("§762 — timelog off, empty budget: the expanded checklist still shows, without the bookings row", () => {
    setDisabledIntegrations(["timelog"]);
    render(<BudgetPanel {...base} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByText(t(L, "budgetSetupBookings"))).toBeNull();
  });
});
