import { beforeAll, describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { computeAccessibleName } from "dom-accessibility-api";
import { BudgetSetupChecklist } from "./budget-setup-checklist";
import { BUDGET_SETUP_STEP_COUNT, type BudgetSetupSteps } from "./budget-setup";
import { loadI18n, t } from "./i18n";
import { ALL_MODULE_IDS, type FeatureModuleId } from "./feature-modules";

const L = "en-US" as const;
const none: BudgetSetupSteps = { ratesDone: false, peopleDone: false, bucketDone: false, bookingsDone: false, next: 1 };

function setup(over: Partial<React.ComponentProps<typeof BudgetSetupChecklist>> = {}) {
  const cb = {
    onAddBucket: vi.fn(), onGo: vi.fn(), onStartTour: vi.fn(), onLoadDemo: vi.fn(), onDismiss: vi.fn(),
  };
  render(<BudgetSetupChecklist lang={L} steps={none} collapsed={false} {...cb} {...over} />);
  return cb;
}
const rows = () => screen.getAllByRole("listitem");

describe("BudgetSetupChecklist expanded", () => {
  test("renders the four steps in order, step 4 marked optional", () => {
    setup();
    const r = rows();
    expect(r).toHaveLength(4);
    expect(within(r[0]).getByText(t(L, "budgetSetupRates"))).toBeInTheDocument();
    expect(within(r[1]).getByText(t(L, "budgetSetupPeople"))).toBeInTheDocument();
    expect(within(r[2]).getByText(t(L, "budgetSetupBucket"))).toBeInTheDocument();
    expect(within(r[3]).getByText(t(L, "budgetSetupBookings"))).toBeInTheDocument();
    expect(within(r[3]).getByText(t(L, "budgetSetupOptional"))).toBeInTheDocument();
    for (const i of [0, 1, 2]) expect(within(r[i]).queryByText(t(L, "budgetSetupOptional"))).toBeNull();
  });

  test.each([1, 2, 3, 4] as const)("the next row (%i) is highlighted with a text cue, and only that one", (next) => {
    setup({ steps: { ...none, next } });
    rows().forEach((row, i) => {
      const isNext = i + 1 === next;
      expect(row.getAttribute("data-next")).toBe(isNext ? "true" : "false");
      // Non-colour cue: the word "next" is in the row, not only a tint.
      expect(within(row).queryByText(t(L, "budgetSetupNext")) !== null).toBe(isNext);
    });
  });

  test("no row is highlighted when everything is done", () => {
    setup({ steps: { ratesDone: true, peopleDone: true, bucketDone: true, bookingsDone: true, next: null } });
    for (const row of rows()) expect(row.getAttribute("data-next")).toBe("false");
    expect(screen.queryByText(t(L, "budgetSetupNext"))).toBeNull();
  });

  test("each row states done or to do in text, not by tick colour alone", () => {
    setup({ steps: { ratesDone: true, peopleDone: false, bucketDone: false, bookingsDone: false, next: 2 } });
    const r = rows();
    expect(within(r[0]).getByText(t(L, "budgetSetupStepDone"))).toBeInTheDocument();
    expect(within(r[1]).getByText(t(L, "budgetSetupStepTodo"))).toBeInTheDocument();
  });

  test("the row links call onGo with the real view ids", async () => {
    const cb = setup();
    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: t(L, "budgetSetupGoRoles") }));
    await u.click(screen.getByRole("button", { name: t(L, "budgetSetupGoPeople") }));
    await u.click(screen.getByRole("button", { name: t(L, "budgetSetupGoBookings") }));
    expect(cb.onGo.mock.calls).toEqual([["manage-roles"], ["directory"], ["timelog"]]);
  });

  test("row 3 holds the existing + Add bucket… button", async () => {
    const cb = setup();
    await userEvent.setup().click(within(rows()[2]).getByRole("button", { name: `+ ${t(L, "budgetAddBucket")}…` }));
    expect(cb.onAddBucket).toHaveBeenCalledTimes(1);
  });

  test("the tour link starts tour budget-changes and the demo link loads the demo", async () => {
    const cb = setup();
    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: t(L, "budgetSetupTour") }));
    await u.click(screen.getByRole("button", { name: t(L, "budgetSetupDemo") }));
    expect(cb.onStartTour).toHaveBeenCalledWith("budget-changes");
    expect(cb.onLoadDemo).toHaveBeenCalledTimes(1);
  });

  test("with the callbacks undefined (popout) the go, tour and demo links are hidden", () => {
    setup({ onGo: undefined, onStartTour: undefined, onLoadDemo: undefined });
    for (const k of ["budgetSetupGoRoles", "budgetSetupGoPeople", "budgetSetupGoBookings", "budgetSetupTour", "budgetSetupDemo"] as const) {
      expect(screen.queryByRole("button", { name: t(L, k) })).toBeNull();
    }
    expect(rows()).toHaveLength(4);
  });

  test("the expanded checklist has no hide button and no show toggle", () => {
    setup();
    expect(screen.queryByRole("button", { name: t(L, "budgetSetupDismiss") })).toBeNull();
    expect(screen.queryByRole("button", { name: t(L, "budgetSetupShowAria") })).toBeNull();
  });
});

describe("BudgetSetupChecklist with a function off (§710)", () => {
  const without = (...off: FeatureModuleId[]) => ALL_MODULE_IDS.filter((id) => !off.includes(id));
  const goName = (k: "budgetSetupGoRoles" | "budgetSetupGoPeople" | "budgetSetupGoBookings") => t(L, k);

  test("with Resources off, Manage roles and Open directory are not links; each row says the function is off", () => {
    setup({ features: without("resources"), onCommitFeatures: vi.fn() });
    expect(screen.queryByRole("button", { name: goName("budgetSetupGoRoles") })).toBeNull();
    expect(screen.queryByRole("button", { name: goName("budgetSetupGoPeople") })).toBeNull();
    const hint = t(L, "budgetSetupModuleOff", t(L, "tabResources"));
    expect(within(rows()[0]).getByText(hint)).toBeInTheDocument();
    expect(within(rows()[1]).getByText(hint)).toBeInTheDocument();
    // The Timelog link is untouched.
    expect(screen.getByRole("button", { name: goName("budgetSetupGoBookings") })).toBeInTheDocument();
  });

  test("with Time bookings off, Open Timelog is not a link and the row says so", () => {
    setup({ features: without("timelog"), onCommitFeatures: vi.fn() });
    expect(screen.queryByRole("button", { name: goName("budgetSetupGoBookings") })).toBeNull();
    expect(within(rows()[3]).getByText(t(L, "budgetSetupModuleOff", t(L, "navTimelog")))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: goName("budgetSetupGoRoles") })).toBeInTheDocument();
  });

  test("with both on, the links render and call onGo with the real view ids", async () => {
    const cb = setup({ features: [...ALL_MODULE_IDS], onCommitFeatures: vi.fn() });
    expect(screen.queryByText(t(L, "budgetSetupModuleOff", t(L, "tabResources")))).toBeNull();
    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: goName("budgetSetupGoRoles") }));
    await u.click(screen.getByRole("button", { name: goName("budgetSetupGoPeople") }));
    await u.click(screen.getByRole("button", { name: goName("budgetSetupGoBookings") }));
    expect(cb.onGo.mock.calls).toEqual([["manage-roles"], ["directory"], ["timelog"]]);
  });

  test("the turn-on button commits the enabled set plus the module, in registry order", async () => {
    const onCommitFeatures = vi.fn();
    setup({ features: without("resources", "timelog"), onCommitFeatures });
    const u = userEvent.setup();
    const resources = t(L, "tabResources");
    // One button per row, each named by its row (row-unique accessible names).
    const roles = screen.getByRole("button", { name: t(L, "budgetSetupTurnOnAria", resources, t(L, "budgetSetupRates")) });
    const people = screen.getByRole("button", { name: t(L, "budgetSetupTurnOnAria", resources, t(L, "budgetSetupPeople")) });
    expect(roles).not.toBe(people);
    await u.click(roles);
    expect(onCommitFeatures).toHaveBeenLastCalledWith(without("timelog"));
    await u.click(screen.getByRole("button", { name: t(L, "budgetSetupTurnOnAria", t(L, "navTimelog"), t(L, "budgetSetupBookings")) }));
    expect(onCommitFeatures).toHaveBeenLastCalledWith(without("resources"));
    // Label in name (WCAG 2.5.3): the visible text is contained in the accessible name.
    expect(roles.textContent).toBe(t(L, "functionsUsesTurnOn"));
    expect(roles.getAttribute("aria-label")).toContain(t(L, "functionsUsesTurnOn"));
  });

  test("without onCommitFeatures the hint stays and there is no turn-on button", () => {
    setup({ features: without("resources") }); // onGo set, onCommitFeatures absent
    expect(screen.queryByRole("button", { name: new RegExp(t(L, "functionsUsesTurnOn")) })).toBeNull();
    expect(within(rows()[0]).getByText(t(L, "budgetSetupModuleOff", t(L, "tabResources")))).toBeInTheDocument();
  });
});

describe("BudgetSetupChecklist collapsed", () => {
  const some: BudgetSetupSteps = { ratesDone: true, peopleDone: true, bucketDone: true, bookingsDone: false, next: 4 };

  test("shows the count and keeps the steps hidden", () => {
    setup({ steps: some, collapsed: true });
    expect(screen.getByText("Budget setup: 3 of 4 ·")).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  test("M11: the total comes from BUDGET_SETUP_STEP_COUNT, not from the string, in EN and DE", async () => {
    await loadI18n("de");
    expect(t(L, "budgetSetupCollapsed", "X", "Y")).toBe("Budget setup: X of Y ·");
    expect(t("de", "budgetSetupCollapsed", "X", "Y")).toBe("Budget-Einrichtung: X von Y ·");
    expect(BUDGET_SETUP_STEP_COUNT).toBe(4);
  });

  test("the show toggle is a disclosure that reveals and hides the steps", async () => {
    setup({ steps: some, collapsed: true });
    const u = userEvent.setup();
    const toggle = screen.getByRole("button", { name: t(L, "budgetSetupShowAria") });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).not.toHaveAttribute("aria-pressed");
    await u.click(toggle);
    const open = screen.getByRole("button", { name: t(L, "budgetSetupHideAria") });
    expect(open).toHaveAttribute("aria-expanded", "true");
    expect(rows()).toHaveLength(4);
    await u.click(open);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  // WCAG 2.5.3: the accessible name is COMPUTED (aria-label wins over the text), then checked for
  // the visible text — in both states, since the label and the text swap together.
  test("the visible toggle text is contained in its computed accessible name (label in name)", async () => {
    setup({ steps: some, collapsed: true });
    const u = userEvent.setup();
    const states = [
      { aria: "budgetSetupShowAria", visible: "budgetSetupShow" },
      { aria: "budgetSetupHideAria", visible: "budgetSetupHide" },
    ] as const;
    for (const [i, s] of states.entries()) {
      const toggle = screen.getByRole("button", { name: t(L, s.aria) });
      const visible = toggle.textContent ?? "";
      expect(visible).toBe(t(L, s.visible));
      expect(computeAccessibleName(toggle).toLowerCase()).toContain(visible.toLowerCase());
      if (i === 0) await u.click(toggle);
    }
  });

  test("aria-controls names an element that exists while the steps are collapsed, and is hidden until opened", async () => {
    setup({ steps: some, collapsed: true });
    const toggle = screen.getByRole("button", { name: t(L, "budgetSetupShowAria") });
    const id = toggle.getAttribute("aria-controls")!;
    expect(id).toBeTruthy();
    const target = document.getElementById(id)!;
    expect(target).toBeInTheDocument();
    expect(target).not.toBeVisible();
    expect(target).toHaveAttribute("hidden");
    await userEvent.setup().click(toggle);
    expect(document.getElementById(id)).toBe(target);
    expect(target).toBeVisible();
    expect(target).not.toHaveAttribute("hidden");
  });

  test("the hide button is named Hide budget setup and calls onDismiss", async () => {
    const cb = setup({ steps: some, collapsed: true });
    await userEvent.setup().click(screen.getByRole("button", { name: "Hide budget setup" }));
    expect(cb.onDismiss).toHaveBeenCalledTimes(1);
  });

  test("an expanded-from-collapsed list does not offer another Add bucket button once a bucket exists", async () => {
    setup({ steps: some, collapsed: true });
    await userEvent.setup().click(screen.getByRole("button", { name: t(L, "budgetSetupShowAria") }));
    expect(screen.queryByRole("button", { name: `+ ${t(L, "budgetAddBucket")}…` })).toBeNull();
  });
});

describe("BudgetSetupChecklist (German)", () => {
  beforeAll(async () => { await loadI18n("de"); });
  test("renders the German step labels", () => {
    render(<BudgetSetupChecklist lang="de" steps={none} collapsed={false} onAddBucket={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(t("de", "budgetSetupRates"))).toBeInTheDocument();
    expect(t("de", "budgetSetupRates")).not.toBe(t("en-US", "budgetSetupRates"));
  });
});
