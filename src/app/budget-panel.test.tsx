import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { BudgetPanel } from "./budget-panel";
import { mintId, __resetMintStateForTests } from "./id-mint-session";
import { t } from "./i18n";
import { expectDestructiveButton, expectSecondaryButton } from "../test/button-variant";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { rowLabel } from "./row-tokens";
import type { BudgetBucket, Resource, Role, ResourcePlan } from "./types";

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

  test("the reorder handle sets drag transfer data — Firefox will not start a drag without it", () => {
    // ★ Was missing before the panel adopted `useListReorderDnd`: `onDragStart`
    // took no event argument at all, so bucket reorder was simply dead in
    // Firefox. jsdom dispatches the whole drag sequence regardless, so only a
    // test that spies on `setData` can see the difference.
    render(<BudgetPanel {...props} buckets={twoBuckets()} />);
    const handles = screen.getAllByRole("button", { name: /reorder bucket/i });
    const setData = vi.fn();
    fireEvent.dragStart(handles[0], { dataTransfer: { setData, effectAllowed: "" } });
    expect(setData).toHaveBeenCalled();
  });

  test("gives every bucket reorder handle a bucket-unique accessible name (WCAG 2.4.6)", () => {
    // ★ Needs ≥2 buckets, or the collision cannot render and this passes on
    // broken code. Budget IS an axe-scanned view, but axe cannot detect two
    // controls sharing an accessible name in ANY view at ANY seed size — no
    // rule under the four tags `e2e/a11y.spec.ts` requests flags it — so this
    // unit test is the only possible detector.
    render(<BudgetPanel {...props} buckets={twoBuckets()} />);
    const names = screen
      .getAllByRole("button", { name: /reorder bucket/i })
      .map((el) => el.getAttribute("aria-label"));
    expect(names.length).toBe(2);
    expect(new Set(names).size).toBe(names.length);
    // …and each one names ITS bucket, not merely some distinct suffix.
    expect(names.some((n) => n?.includes("PAM"))).toBe(true);
    expect(names.some((n) => n?.includes("DEV"))).toBe(true);
  });

  // ★★★ THE COLLISION CASE, which the test above cannot reach: bucket names carry
  // no uniqueness constraint (`budget-bucket-modal.tsx` enforces only
  // BUDGET_NAME_MAX), so two buckets can genuinely share one. Both controls in a
  // bucket-card header then render byte-identical accessible names, and axe
  // cannot see it in ANY view at ANY seed size — no rule under the four tags
  // `e2e/a11y.spec.ts` requests flags two controls sharing a name. This unit
  // test is the only detector that can exist. (docs/open-followups.md §262.)
  const collidingBuckets = (): BudgetBucket[] => [
    // Storage order is deliberately the REVERSE of `order`: the panel renders
    // `report.buckets`, which `computeBudgetReport` sorts by `order ?? id`, so
    // the occurrence index must number by RENDERED order, not array order.
    { ...buckets[0], id: 1, name: "PAM", order: 1 },
    { ...buckets[0], id: 2, name: "PAM", order: 0 },
  ];

  test("keeps every bucket control bucket-unique when two buckets share a name", () => {
    render(<BudgetPanel {...props} buckets={collidingBuckets()} />);
    const handles = screen.getAllByRole("button", { name: /reorder bucket/i });
    expect(handles).toHaveLength(2);

    // ★★ THE SPINBUTTON HALF. The "Manual % complete" box is `type="number"`, so
    // its role is `spinbutton` — a `roles: ["button"]` scan misses it entirely.
    // Scope is the bucket-card SECTION (the handle's card's parent). Measured
    // over this fixture: 26 spinbuttons — the two percent boxes plus 2×12 period
    // hour cells, whose labels are already bucket-id-qualified
    // (`budget-<bucketId>-<roleId>-<period>`) and therefore all distinct. So the
    // ONLY stripped collision `requireCollisionSeed` can be satisfied by is the
    // percent pair under test — the masking hazard the helper's docstring warns
    // about does not apply at this role list, and `minControls` is pinned to the
    // exact measured count so a narrowed scan cannot pass vacuously.
    const scope = handles[0].closest("div.rounded-xl")!.parentElement as HTMLElement;
    expectRowUniqueNames({
      minControls: 26,
      roles: ["spinbutton"],
      scope,
      requireCollisionSeed: true,
    });

    // ★ Anti-vacuity, and the mutant it kills is the realistic one: the scan
    // proves only that the two percent boxes' names DIFFER, so it passes against
    // a "fix" that replaced the label with any unique nonsense
    // (`aria-label={String(idx)}`) — the exact shape that resolves a collision by
    // destroying the name. The BUTTON half above already asserts `toContain("PAM")`
    // on the reorder handles; this is the same pin for the spinbutton half, and
    // it names BOTH parts of `rowLabel(t(lang,"budgetPercentComplete"), rowToken)`
    // so neither half can be dropped silently.
    const percentNames = within(scope)
      .getAllByRole("spinbutton")
      .map((el) => el.getAttribute("aria-label") ?? "")
      .filter((n) => n.includes(t("en-US", "budgetPercentComplete")));
    expect(percentNames).toHaveLength(2);
    for (const n of percentNames) expect(n).toContain("PAM");

    // ★★ THE BUTTON HALF cannot go through the same call, and this is measured
    // rather than assumed: that same scope renders 52 buttons, of which the
    // per-bucket InfoTooltip hints, the "Role" sort header and the trailing
    // Edit/Close/Remove bucket controls are all byte-identical across the two
    // cards. Those are a real WCAG 2.4.6 gap but NOT the one §262 fixes, and no
    // element in the tree holds both reorder handles without also holding them.
    // Scanning `["button"]` here would fail on pre-existing debt; scanning it at
    // a narrower scope is impossible. So the handles are checked by name, with
    // the same two properties the helper asserts: pairwise-unique names, and a
    // genuine collision seed (both strip to one string once "(N)" is removed).
    const names = handles.map((h) => h.getAttribute("aria-label") ?? "");
    // Assert on the DUPES, not on a Set size: "expected 1 to be 2" names neither
    // the colliding string nor the control, and this is the only detector there
    // can be — so its failure has to say what collided.
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes, `WCAG 2.4.6: reorder handles share ${dupes.length} name(s) — ${dupes.join(", ")}`).toEqual([]);
    const stripped = new Set(names.map((n) => n.replace(/ \(\d+\)$/, "")));
    expect(stripped.size).toBe(1);
    expect([...stripped][0]).toContain("PAM");
  });

  // The control is the shared ToggleButton primitive, NOT a bare checkbox: it
  // is a binary display/behaviour switch sitting in a toolbar of toggle chips,
  // and the primitive is what carries the non-colour pressed marker and the
  // pinned-label/aria-pressed coherence the hand-rolled input had neither of.
  test("budget: toggling 'budget hours follow plan' calls the setter", () => {
    const onSetBudgetFollowsPlan = vi.fn();
    render(<BudgetPanel {...props} onSetBudgetFollowsPlan={onSetBudgetFollowsPlan} />);
    const toggle = screen.getByRole("button", { name: /budget hours follow plan/i });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(onSetBudgetFollowsPlan).toHaveBeenCalledWith(true);
  });

  // ★★ The OFF→ON test above is satisfied by a handler that ignores the current
  // state entirely (a literal `onSetBudgetFollowsPlan(true)` passes it), and an
  // inverted/constant handler is exactly the defect a checkbox→button swap
  // invites. Clicking while PRESSED is the only assertion that pins the negation.
  test("budget: the follow-plan toggle reports its ON state and turns back OFF", () => {
    const onSetBudgetFollowsPlan = vi.fn();
    render(<BudgetPanel {...props} plan={{ ...plan, budgetFollowsPlan: true }}
      onSetBudgetFollowsPlan={onSetBudgetFollowsPlan} />);
    const toggle = screen.getByRole("button", { name: /budget hours follow plan/i });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(onSetBudgetFollowsPlan).toHaveBeenCalledWith(false);
    // No checkbox survives anywhere in the header.
    expect(screen.queryByRole("checkbox", { name: /budget hours follow plan/i })).toBeNull();
  });

  // A resourced allocation + follow-plan ON: the bucket's budget hours ARE its
  // planned hours, so the Plan-vs-Budget badge compares a number with itself.
  const mirroredBuckets: BudgetBucket[] = [{
    ...buckets[0],
    allocations: [{ roleId: 3, resourceIds: [5], budgetHours: { "2026-01": 0 }, actualHours: { "2026-01": 80 } }],
  }];
  const mirroredResources: Resource[] = [
    { id: 5, firstName: "R5", lastName: "", roleId: 3, utilizationMode: "percent", utilization: { "2026-01": 100 } },
  ];
  const renderPanelWithMirroredBucket = () => render(
    <BudgetPanel {...props} buckets={mirroredBuckets} resources={mirroredResources}
      plan={{ ...plan, budgetFollowsPlan: true }} />,
  );
  const renderPanelWithFollowPlanOff = () => render(
    <BudgetPanel {...props} buckets={mirroredBuckets} resources={mirroredResources}
      plan={{ ...plan, budgetFollowsPlan: false }} />,
  );

  // Same mirrored setup at 6% of a 176-hour month, so the derived hours are the
  // float 0.06 * 176 === 10.559999999999999 rather than a round number.
  const renderPanelWithMirroredHours = () => render(
    <BudgetPanel {...props} buckets={mirroredBuckets}
      resources={[{ ...mirroredResources[0], utilization: { "2026-01": 6 } }]}
      plan={{ ...plan, budgetFollowsPlan: true }} />,
  );

  test("a mirrored plan cell renders rounded hours, not the raw float", () => {
    // The narrow input truncates 10.559999999999999 mid-number ("10.5599…"),
    // which reads as a wrong value.
    renderPanelWithMirroredHours();
    expect(screen.getByLabelText("budget-1-3-2026-01")).toHaveValue(10.56);
  });

  test("the per-period cell labels its budget input Budget, not Plan", () => {
    // The cell's input writes budgetHours, so labelling it "Plan" collided with
    // the bucket header's "Plan (h)" — a different quantity in the same view.
    render(<BudgetPanel {...props} />);
    const cell = screen.getByLabelText("budget-1-3-2026-01").closest("div");
    expect(cell).toHaveTextContent("Budget");
  });

  test("hides the Plan badge when the budget is mirroring the plan", () => {
    // follow-plan on + resourced row => budget IS plan; a RAG on that comparison
    // can only ever read Amber (equal) or Red (float noise), so it is suppressed.
    renderPanelWithMirroredBucket();
    expect(screen.queryByTitle("Plan (h)")).not.toBeInTheDocument();
  });

  test("shows the Plan badge when budget and plan are independent", () => {
    renderPanelWithFollowPlanOff();
    expect(screen.getByTitle("Plan (h)")).toBeInTheDocument();
  });

  // The live defect: an EXTERNAL rate exists, so revenue is real, but no
  // internal rate exists, so cost collapses to 0 and margin reads a perfect
  // 100% — the project looks maximally profitable precisely because its cost
  // could not be computed at all.
  const ratelessRoles: Role[] = [{ id: 3, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 150 }];
  const renderPanelWithRatelessRoles = () => render(
    <BudgetPanel {...props} roles={ratelessRoles} />,
  );
  const renderPanelWithRatedRoles = () => render(<BudgetPanel {...props} />);

  test("a bucket with no internal rates shows margin as unknown, not 100%", () => {
    renderPanelWithRatelessRoles();
    // Both the bucket tile and the project rollup print it, so assert on ALL
    // occurrences — a bare queryByText throws on the second one rather than
    // failing the claim being made.
    expect(screen.queryAllByText("100.0%")).toHaveLength(0);
    expect(screen.getAllByText(/no internal rates/i).length).toBeGreaterThan(0);
  });

  test("a bucket WITH internal rates is unaffected", () => {
    renderPanelWithRatedRoles();
    expect(screen.queryByText(/no internal rates/i)).not.toBeInTheDocument();
  });

  test("a bucket with no allocations yet does NOT claim its rate card is missing", () => {
    // "+ Add bucket" creates a bucket with allocations: []. A `some()` over no
    // rows is vacuously false, which would tell the user to go fix a rate card
    // before they have added a single role — the wrong problem.
    const emptyBuckets: BudgetBucket[] = [{ ...buckets[0], allocations: [] }];
    render(<BudgetPanel {...props} buckets={emptyBuckets} />);
    expect(screen.queryByText(/no internal rates/i)).not.toBeInTheDocument();
    // ...and it IS told the actual problem now — a bare dash explained nothing.
    expect(screen.getAllByText(/no allocations yet/i).length).toBeGreaterThan(0);
  });

  test("an unstaffed fixed-price bucket shows no margin and no full-win figure", () => {
    // revenue = price, cost = 0 (no rows) => 100% margin, +full price won, on a
    // contract nobody has started. The same false confidence the rateless case
    // produces, reached through zero ROWS instead of zero RATES.
    const emptyFixed: BudgetBucket[] = [{
      ...buckets[0], type: "fixed", fixedPriceAmount: 50000, allocations: [],
    }];
    render(<BudgetPanel {...props} buckets={emptyFixed} />);
    expect(screen.queryAllByText("100.0%")).toHaveLength(0);
    const winLoss = screen.getByText("Win / loss").parentElement!;
    expect(winLoss).toHaveTextContent("—");
    // ...but it must NOT be told to go fix a rate card it has no roles for.
    expect(screen.queryByText(/no internal rates/i)).not.toBeInTheDocument();
  });

  test("a T&M bucket keeps its win/loss when internal rates are missing", () => {
    // T&M win/loss is budgetValue − consumedValue, both on EXTERNAL rates, so it
    // stays a real figure without a rate card. Over-gating it would hide a
    // number that is perfectly knowable. 100h×150 budgeted − 80h×150 consumed.
    renderPanelWithRatelessRoles();
    const winLoss = screen.getByText("Win / loss").parentElement!;
    expect(winLoss).toHaveTextContent(/3,000|3000/);
    expect(winLoss).not.toHaveTextContent("—");
  });

  test("a FIXED-price bucket's win/loss IS gated — it is revenue minus cost", () => {
    const fixedBuckets: BudgetBucket[] = [{
      ...buckets[0], type: "fixed", fixedPriceAmount: 20000,
    }];
    render(<BudgetPanel {...props} roles={ratelessRoles} buckets={fixedBuckets} />);
    const winLoss = screen.getByText("Win / loss").parentElement!;
    expect(winLoss).toHaveTextContent("—");
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

test("budget: bucket search with no matches shows a no-match line", () => {
  const twoNamed: BudgetBucket[] = [
    { ...buckets[0], id: 1, name: "Alpha", order: 0 },
    { ...buckets[0], id: 2, name: "Beta", order: 1 },
  ];
  render(<BudgetPanel {...props} buckets={twoNamed} />);
  const box = screen.getByLabelText(/filter buckets/i);
  fireEvent.change(box, { target: { value: "zzz-no-such-bucket" } });
  expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  expect(screen.queryByText("Beta")).not.toBeInTheDocument();
  expect(screen.getByText(t("en-US", "reportsNoMatches"))).toBeInTheDocument();
});

test("renders InfoTooltip for CPI metric label by accessible name", () => {
  render(<BudgetPanel {...props} />);
  const hint = t("en-US", "budgetCciBurnHint");
  // CPI tooltip appears in both the project-total row and the per-bucket row
  const tooltips = screen.getAllByRole("button", { name: hint });
  expect(tooltips.length).toBeGreaterThanOrEqual(1);
});

test("budget renders a bucket-count heading and is a resizable card", () => {
  const src = readFileSync(join(__dirname, "budget-panel.tsx"), "utf8");
  expect(src).toMatch(/budgetBucketsCount/);
  expect(src).toMatch(/VIEW_PANE_RESIZABLE_CLASS/);
});

describe("BudgetPanel — blended bucket on a partly priced discipline", () => {
  const partlyPricedRoles: Role[] = [
    { id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
    { id: 4, disciplineId: 1, gradeId: 2, internalRate: 0, externalRate: 210 },
  ];
  const blendedBuckets: BudgetBucket[] = [{
    id: 1, name: "PAM", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-06-30", status: "open",
    planningMode: "blended", allocations: [],
    disciplineAllocations: [
      { disciplineId: 1, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } },
    ],
  }];

  test("names the discipline to price instead of costing at a diluted rate", () => {
    render(
      <BudgetPanel {...props} buckets={blendedBuckets} roles={partlyPricedRoles} disciplines={[{ id: 1, name: "Design" }]} />,
    );
    // Assert the NOTICE text, not a bare /Design/: the discipline name also
    // renders in the blended row's table cell, so matching it alone would pass
    // even if the notice were unwired (a vacuous test caught in review). This
    // message string comes ONLY from CostUnknownNotice; getAllByText because
    // both the bucket and project notices fire.
    expect(screen.getAllByText(/grades with no internal rate in: Design/i).length).toBeGreaterThan(0);
    expect(screen.queryAllByText("100.0%")).toHaveLength(0);
  });

  test("a bucket rate override beats the poison and costs normally", () => {
    render(
      <BudgetPanel {...props} buckets={[{ ...blendedBuckets[0], rateOverrideInternal: 90 }]} roles={partlyPricedRoles} disciplines={[{ id: 1, name: "Design" }]} />,
    );
    // No unpriced-blend notice anywhere...
    expect(screen.queryByText(/grades with no internal rate/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no internal rates are set/i)).not.toBeInTheDocument();
    // ...and the figures ARE computed rather than blanked: external blend is
    // mean(150,210)=180 (external is not poisoned), internal is the 90 override,
    // so 80h → cost 7,200 and margin 14,400 − 7,200 = 7,200. A blanked bucket
    // would show "—" for both.
    expect(screen.getAllByText(/7,200/).length).toBeGreaterThan(0);
  });
});

// nextBucketId is module-private; it now delegates to mintId("budgetBucket", …),
// so we prove the no-reuse contract on that mint kind directly.
describe("nextBucketId (session mint)", () => {
  beforeEach(__resetMintStateForTests);

  test("never reuses a deleted bucket id within the session", () => {
    const three: BudgetBucket[] = [1, 2, 3].map((id) => ({ ...buckets[0], id }));
    expect(mintId("budgetBucket", three)).toBe(4);
    // id 3 "deleted" — minting over [1,2] must NOT reuse 3
    const two: BudgetBucket[] = [1, 2].map((id) => ({ ...buckets[0], id }));
    expect(mintId("budgetBucket", two)).toBe(5);
  });
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
    const cpiLabel = t("en-US", "budgetCciBurn");
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

describe("BudgetPanel — CPI card (EV/AC)", () => {
  const cpiLabel = t("en-US", "budgetCciCpi");
  const cpiCardsIn = () =>
    Array.from(document.querySelectorAll(".rounded-lg.border.border-line.p-3"))
      .filter((c) => c.textContent?.includes(cpiLabel));

  test("renders unknown (—) when no bucket has progress set", () => {
    // The default `buckets` fixture carries no percentComplete/taskIds.
    render(<BudgetPanel {...props} />);
    const cards = cpiCardsIn();
    expect(cards.length).toBeGreaterThanOrEqual(1);
    for (const card of cards) {
      const big = card.querySelector(".text-lg.font-semibold");
      expect(big?.textContent).toBe("—");
    }
  });

  test("computes and renders a known CPI from a manual percent-complete", () => {
    // 100 budgeted hours × rate 100 = 10,000 budgeted cost; 40% complete => EV 4,000;
    // 80 actual hours × rate 100 = 8,000 actual cost => CPI 4,000/8,000 = 50%.
    const cpiBuckets: BudgetBucket[] = [{
      id: 1, name: "B1", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-06-30", status: "open",
      percentComplete: 40,
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } }],
    }];
    render(<BudgetPanel {...props} buckets={cpiBuckets} />);
    const cards = cpiCardsIn();
    expect(cards.length).toBeGreaterThanOrEqual(1);
    const bucketCard = cards.find((c) => c.textContent?.includes("50.0%"));
    expect(bucketCard).toBeTruthy();
  });

  test("resolves earned value from linked tasks via the tasks prop", () => {
    // Same budgeted/actual cost as above (10,000 / 8,000), but progress comes
    // from one finished linked task out of two => 50% => EV 5,000 => CPI 62.5%.
    const linkedBuckets: BudgetBucket[] = [{
      id: 1, name: "B1", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-06-30", status: "open",
      taskIds: [101, 102],
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } }],
    }];
    const tasks = [
      { id: 101, taskName: "T1", assignee: "A", assigneeEmail: "a@x.io", dueDate: "2026-02-01", lastUpdateDate: "2026-01-01", status: "Done" as const, priority: "Medium" as const, blockers: "", description: "" },
      { id: 102, taskName: "T2", assignee: "A", assigneeEmail: "a@x.io", dueDate: "2026-02-01", lastUpdateDate: "2026-01-01", status: "To Do" as const, priority: "Medium" as const, blockers: "", description: "" },
    ];
    render(<BudgetPanel {...props} buckets={linkedBuckets} tasks={tasks} />);
    const cards = cpiCardsIn();
    const bucketCard = cards.find((c) => c.textContent?.includes("62.5%"));
    expect(bucketCard).toBeTruthy();
  });
});

describe("budget: follow-plan mirror (Task 8)", () => {
  // A resource with January capacity so allocationPlannedHours > 0.
  const resourceWithCapacity: Resource = {
    id: 7, firstName: "Cap", lastName: "Acity", roleId: 3,
    utilizationMode: "percent", utilization: { "2026-01": 100 },
  };
  // One-month bucket → a single period column → getAllByLabelText(...)[0] is the cell.
  const resourcedBucket = (): BudgetBucket[] => [{
    id: 1, name: "PAM", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
    allocations: [{ roleId: 3, resourceIds: [7], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } }],
  }];
  const unresourcedBucket = (): BudgetBucket[] => [{
    id: 1, name: "PAM", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
    allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } }],
  }];

  test("mirror ON — resourced line's budget input is read-only and shows planned hours", () => {
    render(
      <BudgetPanel
        {...props}
        resources={[resourceWithCapacity]}
        plan={{ ...plan, budgetFollowsPlan: true }}
        buckets={resourcedBucket()}
      />,
    );
    const budgetInput = screen.getAllByLabelText(/^budget-/)[0] as HTMLInputElement;
    expect(budgetInput).toHaveAttribute("readonly");
    // Must show the PLANNED value (Jan 2026 = 22 workdays × 8h = 176h at 100%),
    // NOT the stored 100 — a broken mirror rendering 100 must fail here.
    expect(budgetInput.value).not.toBe("100");
    expect(Number(budgetInput.value)).toBeCloseTo(176, 5);
  });

  test("mirror ON — role line with NO assigned resource stays editable", () => {
    render(
      <BudgetPanel
        {...props}
        resources={[resourceWithCapacity]}
        plan={{ ...plan, budgetFollowsPlan: true }}
        buckets={unresourcedBucket()}
      />,
    );
    expect(screen.getAllByLabelText(/^budget-/)[0]).not.toHaveAttribute("readonly");
  });

  test("mirror OFF — budget input editable (unchanged)", () => {
    render(
      <BudgetPanel
        {...props}
        resources={[resourceWithCapacity]}
        plan={{ ...plan, budgetFollowsPlan: false }}
        buckets={resourcedBucket()}
      />,
    );
    expect(screen.getAllByLabelText(/^budget-/)[0]).not.toHaveAttribute("readonly");
  });

  test("mirror ON — actual input stays editable", () => {
    render(
      <BudgetPanel
        {...props}
        resources={[resourceWithCapacity]}
        plan={{ ...plan, budgetFollowsPlan: true }}
        buckets={resourcedBucket()}
      />,
    );
    expect(screen.getAllByLabelText(/^actual-/)[0]).not.toHaveAttribute("readonly");
  });

  test("mirror ON — row RAG follows planned, not the stored 0 budget", () => {
    // Stored budget is 0 (planning drives it). Without routing the row total
    // through the mirror, the badge would be ratioHealth(80, 0) → null → "—";
    // with planned (176) mirrored in it must be a real RAG band.
    const zeroBudgetBucket: BudgetBucket[] = [{
      id: 1, name: "PAM", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      allocations: [{ roleId: 3, resourceIds: [7], budgetHours: { "2026-01": 0 }, actualHours: { "2026-01": 80 } }],
    }];
    render(
      <BudgetPanel
        {...props}
        resources={[resourceWithCapacity]}
        plan={{ ...plan, budgetFollowsPlan: true }}
        buckets={zeroBudgetBucket}
      />,
    );
    // Scoped to the ALLOCATION row (row 0 is the header, the last row is the
    // bucket total) — the total row carries a same-titled badge, and this test
    // is about the allocation row's own mirrored total.
    const allocRow = screen.getAllByRole("row")[1];
    const rowStatus = within(allocRow).getByLabelText(t("en-US", "budgetRoleStatus"));
    expect(rowStatus.textContent).not.toBe("—");
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

describe("budget: per-period cell RAG is period-aware", () => {
  // One bucket spanning two monthly periods, both budgeted, neither booked.
  // `today` is 2026-02-01, so 2026-01 has CLOSED and 2026-02 has not.
  const emptyBothPeriods: BudgetBucket[] = [{
    id: 1, name: "PAM", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-02-28", status: "open",
    allocations: [{
      roleId: 3, resourceIds: [],
      budgetHours: { "2026-01": 100, "2026-02": 100 },
      actualHours: {},
    }],
  }];

  // The cell badge carries no `title`, so its accessible name is the colour —
  // but so would any other untitled badge. Reach it through the cell's own
  // actual-hours input instead, which is uniquely labelled per period.
  const cellBadgeLabel = (periodKey: string): string | null =>
    screen.getByLabelText(`actual-1-3-${periodKey}`)
      .parentElement!.querySelector('[role="img"]')!
      .getAttribute("aria-label");

  test("a CLOSED period with nothing booked is Amber, not Green", () => {
    render(<BudgetPanel {...props} buckets={emptyBothPeriods} />);
    expect(cellBadgeLabel("2026-01")).toBe("Amber");
  });

  test("the same empty cell in a period that has not closed stays Green", () => {
    render(<BudgetPanel {...props} buckets={emptyBothPeriods} />);
    expect(cellBadgeLabel("2026-02")).toBe("Green");
  });
});

describe("BudgetPanel — Total column + total row", () => {
  // 2 rows x 2 periods, every marginal distinct:
  //   rows    : 80/65 and 40/50
  //   columns : 60/55 (Jan) and 60/60 (Feb)
  //   grand   : 120/115
  // A single-row or single-period fixture passes whether the code sums the right
  // axis or not, which is the whole failure mode being guarded here.
  const totalsRoles: Role[] = [
    { id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
    { id: 4, disciplineId: 1, gradeId: 2, internalRate: 100, externalRate: 150 },
  ];
  const totalsBuckets: BudgetBucket[] = [{
    id: 1, name: "PAM", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-02-28", status: "open",
    allocations: [
      { roleId: 3, resourceIds: [], budgetHours: { "2026-01": 40, "2026-02": 40 }, actualHours: { "2026-01": 30, "2026-02": 35 } },
      { roleId: 4, resourceIds: [], budgetHours: { "2026-01": 20, "2026-02": 20 }, actualHours: { "2026-01": 25, "2026-02": 25 } },
    ],
  }];
  const renderTotals = () =>
    render(<BudgetPanel {...props} roles={totalsRoles} buckets={totalsBuckets} />);

  /** The two numbers in a totals cell, each read from its OWN labelled line.
   *  Asserting `cell.textContent` instead reads both lines at once, so swapping
   *  the two props at the TotalsTd call site (`budget={actual} actual={budget}`)
   *  leaves every such assertion passing while every Total cell in the app shows
   *  the actual on the Budget line — the exact reversed-argument hazard this
   *  file already warns about for `ratioHealth`. */
  const totalsLines = (cell: HTMLElement) => {
    const lineFor = (key: "budgetCellBudget" | "budgetCellActual") => {
      const label = t("en-US", key);
      const row = within(cell).getByText(label).parentElement as HTMLElement;
      return (row.textContent ?? "").replace(label, "").trim();
    };
    return { budget: lineFor("budgetCellBudget"), actual: lineFor("budgetCellActual") };
  };

  test("each row carries its summed budget and actual in the Total column", () => {
    renderTotals();
    expect(screen.getByRole("columnheader", { name: t("en-US", "budgetTotal") })).toBeInTheDocument();

    // Row-scoped: the CCI tiles above the table render their own numbers, so a
    // bare getByText could match one of those instead.
    const rows = screen.getAllByRole("row");
    expect(totalsLines(within(rows[1]).getAllByRole("cell")[2])).toEqual({ budget: "80", actual: "65" });
    expect(totalsLines(within(rows[2]).getAllByRole("cell")[2])).toEqual({ budget: "40", actual: "50" });
  });

  test("the total row carries each period's column sums and the grand total", () => {
    renderTotals();
    const totalRow = screen.getByText(t("en-US", "budgetTotal"), { selector: "td" }).closest("tr") as HTMLElement;
    const cells = within(totalRow).getAllByRole("cell");
    // cell 0 = RAG dot, 1 = "Total", 2 = grand, 3.. = per-period sums
    expect(totalsLines(cells[2])).toEqual({ budget: "120", actual: "115" });
    expect(totalsLines(cells[3])).toEqual({ budget: "60", actual: "55" });
    // Jan and Feb differ on actual only (55 vs 60), so a column-vs-column mixup
    // shows up here and not in the budget figure.
    expect(totalsLines(cells[4])).toEqual({ budget: "60", actual: "60" });
  });

  // useColumnResize's v2 blob for this table. It is read in a lazy useState
  // initializer, so a seed only takes effect if it is written BEFORE render.
  const COL_WIDTHS_KEY = "aipm-cockpit:col-widths:budget";
  const seedRoleWidth = (px: number) =>
    window.localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify({ v: 2, widths: { role: px } }));
  beforeEach(() => window.localStorage.removeItem(COL_WIDTHS_KEY));
  afterEach(() => window.localStorage.removeItem(COL_WIDTHS_KEY));

  test("the three leading columns are pinned", () => {
    renderTotals();
    const headers = screen.getAllByRole("columnheader");
    // Two halves, both required: `sticky` rides a CLASS (an inline
    // `position: sticky` would outrank the `print:static` beside it and make it
    // inert), while the per-instance offset stays inline.
    expect(headers[0].classList.contains("sticky")).toBe(true);
    expect(headers[0].style.left).toBe("0px");
    expect(headers[1].classList.contains("sticky")).toBe(true);
    expect(headers[1].style.left).toBe("28px");
    expect(headers[2].classList.contains("sticky")).toBe(true);
    expect(headers[2].style.left).toBe("188px"); // 28 + the 160px default role width
    // No inline position on any of them, or print could never override it.
    for (const th of headers.slice(0, 3)) expect(th.style.position).toBe("");
  });

  test("the pinned BODY cells are sticky too, in the data rows and the total row", () => {
    // Without this the shipped behaviour — everything left of and including
    // Total stays put while the months scroll — can go missing in every data
    // row while the headers stay pinned, and the suite stays green: the other
    // assertions here read a <th>, or read a body cell's `left` WITHOUT its
    // position, which a cell that is not positioned at all still carries.
    renderTotals();
    const dataCells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    const totalRow = screen.getByText(t("en-US", "budgetTotal"), { selector: "td" }).closest("tr") as HTMLElement;
    const totalCells = within(totalRow).getAllByRole("cell");
    for (const cells of [dataCells, totalCells]) {
      for (const td of cells.slice(0, 3)) {
        expect(td.classList.contains("sticky")).toBe(true);
        expect(td.style.position).toBe("");
      }
      expect(cells[0].style.left).toBe("0px");
      expect(cells[1].style.left).toBe("28px");
      expect(cells[2].style.left).toBe("188px");
      // A period cell scrolls — it must NOT be pinned, or the whole row is.
      expect(cells[3].classList.contains("sticky")).toBe(false);
      expect(cells[3].style.left).toBe("");
    }
  });

  test("the pinned role column is clamped to its declared width", () => {
    // `table-layout: auto` treats a declared width as a MINIMUM, so a long
    // discipline name renders the column wider — and Total, pinned by arithmetic
    // at 28 + the declared width, then sits on top of that label. Measured in
    // Chromium before the clamp, with a long discipline name and the table
    // scrolled: both a 40px and a 60px role column rendered 156.9, hiding 117px
    // and 97px of the label behind Total respectively.
    seedRoleWidth(60);
    renderTotals();
    const roleTh = screen.getAllByRole("columnheader")[1];
    expect(roleTh.style.maxWidth).toBe("60px");
    const roleTd = within(screen.getAllByRole("row")[1]).getAllByRole("cell")[1];
    expect(roleTd.style.maxWidth).toBe("60px");
    expect(roleTd.style.width).toBe("60px");
    expect(roleTd.className).toContain("truncate");
  });

  test("the RAG-dot header names its column without occupying it", () => {
    // The visible word rendered the column at 41.3px against a declared
    // DOT_COL_PX of 28, so the role column — pinned at 28 — sat over its right
    // 13px once scrolled. Widening the constant would tune it to one string;
    // taking the label out of layout makes 28 true whatever the translation.
    // The accessible name must survive (Budget is axe-scanned, and an unnamed
    // header is a WCAG 1.3.1 failure).
    renderTotals();
    const dotTh = screen.getAllByRole("columnheader")[0];
    expect(dotTh).toHaveAccessibleName(t("en-US", "budgetRoleStatus"));
    const labelSpan = within(dotTh).getByText(t("en-US", "budgetRoleStatus"));
    expect(labelSpan.className).toContain("sr-only");
  });

  test("Total's offset tracks a RESIZED role column, not the default 188", () => {
    // The previous test cannot tell a derived offset from a hardcoded 188: the
    // default role width is 160 and 28 + 160 is exactly 188, so both spellings
    // agree there. Only a NON-default width separates them — and the role column
    // is user-resizable, so this is the case that actually ships broken.
    seedRoleWidth(240);
    renderTotals();
    const headers = screen.getAllByRole("columnheader");
    expect(headers[1].style.left).toBe("28px"); // role still sits at the fixed dot width
    expect(headers[2].style.left).toBe("268px"); // 28 + the seeded 240
    // The body's pinned Total cells track the same width, or the column would
    // shear away from its own header.
    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(cells[2].style.left).toBe("268px");
  });

  test("the bucket table is sized to its content, not stretched to the pane", () => {
    // A `width: 100%` table whose columns sum to less than the container spreads
    // the leftover across ALL of them, pinned ones included — so the clamps
    // above are not enough on their own. Measured in Chromium WITH those clamps
    // applied, 3 periods in a 1400px container still rendered the 28px dot
    // column at 53 and a 60px role column at 113.5. Sizing to content leaves no
    // leftover to spread.
    renderTotals();
    const table = document.querySelector("table") as HTMLElement;
    expect(table.className).toContain("w-max");
    expect(table.className).not.toContain("w-full");
  });

  test("every pinned cell carries print:static", () => {
    // Now that `position: sticky` rides a class rather than the inline style
    // this actually overrides something: Tailwind emits `.print\:static` after
    // `.sticky` at equal specificity, so the print rule wins. Verified in
    // Chromium under emulated print media — inline sticky + class static
    // computes `sticky`; class sticky + class static computes `static`.
    // The print stylesheet resets `overflow` on every .print-root descendant,
    // which removes the scroll container these cells are positioned against —
    // a sticky cell with no scroller offsets against the page instead and lands
    // somewhere else entirely. report-table covers the role <th> via
    // SortResizeTh; nothing else covers the other five.
    renderTotals();
    for (const th of screen.getAllByRole("columnheader").slice(0, 3)) {
      expect(th.className).toContain("print:static");
    }
    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    for (const td of cells.slice(0, 3)) {
      expect(td.className).toContain("print:static");
    }
  });

  test("the total row's separating rule is on its CELLS, not the <tr>", () => {
    // globals.css puts this table in `border-collapse: separate`, where a border
    // set on a row is ignored — verified in Chrome, a `border-top` on a <tr>
    // paints nothing. On the <tr> the rule would be dead markup and the total
    // would read as just another allocation row.
    renderTotals();
    const totalRow = screen.getByText(t("en-US", "budgetTotal"), { selector: "td" }).closest("tr") as HTMLElement;
    expect(totalRow.className).not.toContain("border-t");
    for (const cell of within(totalRow).getAllByRole("cell")) {
      expect(cell.className).toContain("border-t-2");
    }
  });

  test("the pinned body cells carry an opaque background", () => {
    // Without it the scrolled period cells show straight through the pinned ones
    // — these rows carry no background of their own.
    renderTotals();
    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(cells[0].className).toContain("bg-surface");
    expect(cells[1].className).toContain("bg-surface");
    expect(cells[2].className).toContain("bg-surface");
  });
});

test("the non-destructive bucket actions render as bordered secondary buttons", () => {
  render(<BudgetPanel {...props} />);
  // ★★ Edit and Close ONLY. Remove is deliberately NOT in this loop — it renders
  //    `destructive` and is asserted in the test below. Adding it back here would
  //    fail, which is the point: the two variants must not silently converge.
  for (const key of ["budgetEditBucket", "budgetClose"] as const) {
    // ★ Qualified, not bare: these buttons take their accessible name from an
    //   `aria-label` carrying the bucket's row token (§246), so a bare-verb
    //   lookup finds nothing. The base fixture has ONE bucket, so its token is
    //   its unqualified name.
    const btn = screen.getByRole("button", { name: rowLabel(t("en-US", key), "PAM") });
    // ★★ Word-bounded, never `toContain` — see `src/test/button-variant.ts` for
    //    why the substring form is vacuous. NOT because "every variant ends in
    //    `hover:bg-surface-muted`" (an earlier revision of this comment claimed
    //    that and it is false — `primary` ends in `hover:opacity-90`,
    //    `destructive` in `dark:border-ui-pink/50`). Only `secondary` and
    //    `ghost` carry that hover class, which is enough: `ghost` is precisely
    //    what this test rejects, so the substring check would pass against it.
    // ★ `border-line` is the discriminating check — it kills BOTH a flip to
    //   `ghost` and a flip to `destructive` (which carries its own standalone
    //   `bg-surface`, so the `bg-surface` half does no work against that one).
    expectSecondaryButton(btn);
    // ★ Separately kills a revert to the pre-0.221.0 hand-rolled markup, which
    //   was `border border-transparent` + a hover-only `hover:border-ui-dark-blue`.
    //   Verified against the removed classes, so it is falsifiable rather than
    //   decorative — but it is site-specific, which is why it is not in the
    //   shared helper (the FX button below had DIFFERENT old markup).
    expect(btn.className).not.toContain("border-transparent");
  }
});

test("remove bucket renders as the destructive variant, not secondary", () => {
  render(<BudgetPanel {...props} />);
  // ★ Qualified for the same reason as the secondary-variant test above.
  const btn = screen.getByRole("button", { name: rowLabel(t("en-US", "budgetRemoveBucket"), "PAM") });
  // ★★ Removing a bucket is the only irreversible action in that row. Rendering
  //    it identically to Edit and Close is what this pins against — the killing
  //    mutation is flipping it back to `variant="secondary"`, which loses both
  //    tokens below.
  expectDestructiveButton(btn);
  // ★ The control assertion: `secondary`'s defining border must be ABSENT.
  //   Without this the test would still pass if some future variant carried the
  //   pink tokens AND `border-line`, i.e. if the two looks reconverged.
  expect(btn.className).not.toMatch(/(^|\s)border-line(\s|$)/);
});

test("the FX refresh control renders as a bordered secondary button", () => {
  render(<BudgetPanel {...props} />);
  // Accessible name comes from the label text — the ArrowPathIcon beside it is
  // `aria-hidden`, so it contributes nothing.
  const btn = screen.getByRole("button", { name: t("en-US", "budgetFxRefresh") });
  expectSecondaryButton(btn);
  // ★ This site's old markup was `border border-ui-dark-blue bg-surface …
  //   text-ui-dark-blue`, NOT the bucket actions' `border-transparent` — so
  //   copying their negative here would be UNFALSIFIABLE (the removed markup
  //   never contained that class). The two checks that actually discriminate
  //   against the revert are the helper's `border-line` and the accent negative
  //   below; note the helper's `bg-surface` half does NOT, because the old
  //   hand-rolled classes carried a standalone `bg-surface` too.
  expect(btn.className).not.toContain("border-ui-dark-blue");
  expect(btn.className).not.toContain("text-ui-dark-blue");
});

describe("BudgetPanel — per-person booking rows", () => {
  const peopleDisciplines = [{ id: 1, name: "Design" }, { id: 2, name: "Build" }];
  const peopleGrades = [{ id: 1, name: "Senior" }];
  const peopleRoles: Role[] = [
    { id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
    { id: 4, disciplineId: 2, gradeId: 1, internalRate: 100, externalRate: 150 },
  ];
  const peopleResources: Resource[] = [
    { id: 5, firstName: "Ada", lastName: "L", roleId: 3, utilizationMode: "percent", utilization: { "2026-01": 100 } },
  ];
  // TWO role lines, so the row-uniqueness of the trigger name is observable —
  // with one line every accessible-name collision test passes vacuously, which
  // is exactly how the axe gate misses this class.
  const peopleBuckets: BudgetBucket[] = [{
    id: 1, name: "PAM", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
    allocations: [
      { roleId: 3, resourceIds: [5], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } },
      { roleId: 4, resourceIds: [], budgetHours: { "2026-01": 50 }, actualHours: { "2026-01": 10 } },
    ],
  }];
  const renderPeople = (actualsByBucket?: Record<number, Record<string, { hours: number; billableHours: number; byResource?: Record<number, { hours: number; billableHours: number }> }>>, actualsFetchedAt?: string) =>
    render(
      <BudgetPanel {...props} buckets={peopleBuckets} roles={peopleRoles}
        disciplines={peopleDisciplines} grades={peopleGrades} resources={peopleResources}
        actualsByBucket={actualsByBucket} actualsFetchedAt={actualsFetchedAt} />,
    );

  test("each role line's label is a disclosure trigger with a row-unique name", () => {
    renderPeople();
    const triggers = screen.getAllByRole("button", { name: /Show people/ });
    expect(triggers).toHaveLength(2);
    // The two names must DIFFER — N identical "Show people" names is WCAG 2.4.6
    // and axe reports missing names, never duplicate ones.
    const names = triggers.map((b) => b.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(2);
    expect(names[0]).toContain("Design Senior");
    // The visible label still names the ROLE, and the accessible name states
    // what pressing ENABLES — it must not flip to "Hide people" when expanded.
    expect(triggers[0]).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(triggers[0]);
    expect(screen.getAllByRole("button", { name: /Show people/ })[0]).toHaveAttribute("aria-expanded", "true");
  });

  // ★★★ THE REAL DEFECT: two role lines in DIFFERENT buckets whose roleLabel()
  // text (discipline + grade) resolves to the SAME string. roleLabel() carries
  // no bucket or role identity, so the trigger names collided before the fix —
  // the test above cannot see this because its two role lines resolve to
  // DIFFERENT labels ("Design Senior" vs "Build Senior") by construction.
  test("role lines with the SAME discipline+grade text get row-unique names across buckets", () => {
    const collisionRoles: Role[] = [
      { id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
      { id: 4, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
    ];
    const collisionBuckets: BudgetBucket[] = [
      {
        id: 1, name: "Alpha", type: "tm", currency: "EUR",
        startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
        allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } }],
      },
      {
        id: 2, name: "Beta", type: "tm", currency: "EUR",
        startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
        allocations: [{ roleId: 4, resourceIds: [], budgetHours: { "2026-01": 50 }, actualHours: { "2026-01": 10 } }],
      },
    ];
    render(<BudgetPanel {...props} buckets={collisionBuckets} roles={collisionRoles}
      disciplines={peopleDisciplines.slice(0, 1)} grades={peopleGrades} />);
    const triggers = screen.getAllByRole("button", { name: /Show people/ });
    expect(triggers).toHaveLength(2);
    // Both VISIBLE labels stay identical — that is what makes this the real
    // collision (and why the fix must not spill the token into visible text).
    expect(triggers[0]).toHaveTextContent("Design Senior");
    expect(triggers[1]).toHaveTextContent("Design Senior");
    // ★ `expectRowUniqueNames`'s DEFAULT (document-wide) scope is not usable
    // here: two buckets also surface PRE-EXISTING, out-of-scope collisions on
    // "Edit bucket"/"Close bucket"/"Remove bucket" and the CCI tooltip hints,
    // none of which is bucket-qualified — a real WCAG 2.4.6 gap, but not the
    // one this task fixes. Scoped to just the disclosure triggers instead,
    // mirroring the Set-based check the sibling test above already uses.
    const names = triggers.map((b) => b.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(2);
  });

  test("the collapsed people body stays in the DOM so aria-controls resolves", () => {
    const { container } = renderPeople();
    const trigger = screen.getAllByRole("button", { name: /Show people/ })[0];
    const targetId = trigger.getAttribute("aria-controls")!;
    const body = container.querySelector(`#${CSS.escape(targetId)}`);
    expect(body).not.toBeNull();
    expect(body).toHaveAttribute("hidden");
    fireEvent.click(trigger);
    expect(container.querySelector(`#${CSS.escape(targetId)}`)).not.toHaveAttribute("hidden");
  });

  // ★★★ The people body is a SIBLING tbody of the role row's, never a tbody
  //     NESTED inside another one. Measured in Chromium via a DOM-built
  //     about:blank probe: React builds the nested shape verbatim (only the HTML
  //     parser reparents it, and this panel is `ssr: false`), and Chromium then
  //     lays the inner tbody out as its own anonymous table — its second cell
  //     landed at x=29 where the row above had it at x=220. jsdom has no layout,
  //     so this structural assertion is the ONLY thing standing between a future
  //     refactor and a silently destroyed column grid.
  test("mounts the people rows as a sibling tbody, not nested inside one", () => {
    const { container } = renderPeople();
    const trigger = screen.getAllByRole("button", { name: /Show people/ })[0];
    const body = container.querySelector(`#${CSS.escape(trigger.getAttribute("aria-controls")!)}`)!;
    expect(body.tagName).toBe("TBODY");
    expect(body.parentElement?.tagName).toBe("TABLE");
    // …and the role row above it sits in its own tbody, also directly in the table.
    for (const tbody of container.querySelectorAll("tbody")) {
      expect(tbody.parentElement?.tagName).toBe("TABLE");
    }
  });

  // ★ Both people-cell reads below exclude `[data-people-source]` — the §122 cue row
  //   that names which "booked" source these figures come from. It leads the tbody, so
  //   an unscoped `td` query reads its text as the first person cell.
  test("booked reads as unknown, never zero, when no actuals breakdown is supplied", () => {
    const { container } = renderPeople();
    const trigger = screen.getAllByRole("button", { name: /Show people/ })[0];
    fireEvent.click(trigger);
    const body = container.querySelector(`#${CSS.escape(trigger.getAttribute("aria-controls")!)}`)!;
    // Ada is on the plan line, so planned is real (176 workday hours at 100 %)
    // while booked is "—": the panel has no per-resource breakdown to report.
    const cells = [...body.querySelectorAll("tr:not([data-people-source]) td")].map((td) => td.textContent);
    expect(cells[1]).toBe("Ada L");
    expect(cells[2]).toBe("— / 176");
  });

  // ★★★ THE PANEL-LEVEL WIRING OF THE §122 CUE, WHICH NOTHING ELSE PINS.
  //    `budget-panel-people-rows.test.tsx` renders `BucketPeopleRows` DIRECTLY with an
  //    explicit `fetchedAt`, so it proves the component, never that the panel passes it.
  //    Without this, `fetchedAt={undefined}` here leaves the whole suite green while every
  //    user permanently reads "No TimeLog fetch on this device".
  test("passes the cache timestamp through, so the people cue names the source", () => {
    const { container } = renderPeople(
      { 1: { "2026-01": { hours: 6, billableHours: 6, byResource: { 5: { hours: 6, billableHours: 6 } } } } },
      "2026-06-23T10:00:00Z",
    );
    fireEvent.click(screen.getAllByRole("button", { name: /Show people/ })[0]);
    const cue = container.querySelector("[data-people-source]");
    expect(cue).not.toBeNull();
    expect(cue?.textContent).toContain("TimeLog bookings");
    expect(cue?.textContent).not.toContain("No TimeLog fetch");
  });

  test("booked reports the per-resource breakdown when one is supplied", () => {
    const { container } = renderPeople({
      1: { "2026-01": { hours: 6, billableHours: 6, byResource: { 5: { hours: 6, billableHours: 6 } } } },
    });
    const trigger = screen.getAllByRole("button", { name: /Show people/ })[0];
    fireEvent.click(trigger);
    const body = container.querySelector(`#${CSS.escape(trigger.getAttribute("aria-controls")!)}`)!;
    expect([...body.querySelectorAll("tr:not([data-people-source]) td")].map((td) => td.textContent)[2]).toBe("6 / 176");
  });
});

describe("BudgetPanel — the hours hints are stated once, not per cell (§246)", () => {
  // §246: `HoursCell` used to render an InfoTooltip on BOTH its "Budget" and its
  // "Actual" label, and one HoursCell renders per period per role row — so a
  // bucket table put 2 x periods x roles focusable tab stops (InfoTooltip is
  // tabIndex={0}) into one table, every one of them announcing one of the same
  // two sentences. The fix is DELETION plus a single panel-wide legend, not
  // qualification: there is nothing to tell the copies apart, because they say
  // the same thing about the same two columns.
  //
  // The fixture is deliberately 2 buckets x 2 roles x 2 periods. With ONE bucket
  // a per-bucket legend is indistinguishable from a panel-wide one, and with ONE
  // period the per-cell repetition never materialises at all.
  const hintRoles: Role[] = [
    { id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
    { id: 4, disciplineId: 1, gradeId: 2, internalRate: 100, externalRate: 150 },
  ];
  const twoPeriodAllocations = [
    { roleId: 3, resourceIds: [], budgetHours: { "2026-01": 40, "2026-02": 40 }, actualHours: { "2026-01": 30, "2026-02": 35 } },
    { roleId: 4, resourceIds: [], budgetHours: { "2026-01": 20, "2026-02": 20 }, actualHours: { "2026-01": 25, "2026-02": 25 } },
  ];
  const hintBuckets: BudgetBucket[] = [
    {
      id: 1, name: "PAM", type: "tm", currency: "EUR", startDate: "2026-01-01",
      endDate: "2026-02-28", status: "open", order: 0, allocations: twoPeriodAllocations,
    },
    {
      id: 2, name: "DEV", type: "tm", currency: "EUR", startDate: "2026-01-01",
      endDate: "2026-02-28", status: "open", order: 1, allocations: twoPeriodAllocations,
    },
  ];
  const budgetHint = t("en-US", "budgetBudgetHoursHint");
  const actualHint = t("en-US", "budgetActualHoursHint");
  const renderHints = () => render(<BudgetPanel {...props} roles={hintRoles} buckets={hintBuckets} />);

  test("states the Budget-hours hint exactly once across the whole panel", () => {
    renderHints();
    // The load-bearing assertion, and the reason the legend lives OUTSIDE the
    // bucket map: rendering it once per BUCKET makes this 2 on this fixture.
    expect(screen.getAllByLabelText(budgetHint)).toHaveLength(1);
  });

  test("no hours hint is repeated inside a bucket table", () => {
    renderHints();
    const tables = screen.getAllByRole("table");
    // Non-vacuity floor: both buckets must actually have rendered a table, or
    // the loop below would pass over nothing.
    expect(tables.length).toBeGreaterThan(1);
    for (const table of tables) {
      expect(within(table).queryAllByLabelText(budgetHint)).toHaveLength(0);
      expect(within(table).queryAllByLabelText(actualHint)).toHaveLength(0);
    }
  });

  test("states the Actual-hours hint exactly once, in the legend", () => {
    renderHints();
    // ★ TIGHTENED from `hintBuckets.length + 1` to 1. `budgetActualHoursHint`
    // had a SECOND source — each bucket's "Actual hours" summary tile carried
    // the bare hint from INSIDE the bucket map, so the count was one legend plus
    // one tile per bucket. That tile's trigger is now qualified with the
    // bucket's row token, so its accessible name is no longer this string and
    // the panel-wide legend is the only unqualified instance left.
    // ★ `getAllByLabelText` matches the WHOLE accessible name, so a qualified
    // "<hint> – PAM" does not match here — that is what makes this 1 rather
    // than an assertion that silently stopped counting anything.
    // The bucket-scoped names are covered by the collision test below.
    expect(screen.getAllByLabelText(actualHint)).toHaveLength(1);
  });

  // §246: with two buckets, EVERY control inside the bucket map renders twice —
  // the four CCI hint triggers, the three summary-tile hints, the manual-percent
  // hint, the role sort header and the three bucket buttons. Before this fix
  // eleven names were shared by two controls each.
  //
  // ★★ `requireCollisionSeed` is ON because this test CLAIMS to cover a
  // collision. Without it a fixture cut to one bucket would still pass and
  // certify nothing — and it is the only guard that can catch that, since
  // `minControls` counts CONTROLS, not buckets.
  //
  // ★ The floor is the MEASURED count for this fixture, not a guess. Re-measure
  // and BUMP it if the panel grows a control; never lower it to make a run
  // green, because a floor below the real count is what lets a silently emptied
  // scope read as a pass. Read the real number off this helper's own error by
  // setting the floor absurdly high.
  // ★★★ BOTH BUCKETS ARE NAMED "PAM", and that is the whole point of this
  // fixture rather than reusing `hintBuckets` (whose two names differ). With
  // distinct names, interpolating a bare `bucket.name` would ALSO pass — so the
  // test could not tell the shipped fix from the wrong one. Bucket names are
  // free text with no uniqueness constraint, so only the `buildRowTokens`
  // occurrence index ("PAM (1)"/"PAM (2)") actually disambiguates here.
  const collidingBuckets: BudgetBucket[] = hintBuckets.map((b) => ({ ...b, name: "PAM" }));

  test("gives every bucket-scoped control a bucket-unique accessible name", () => {
    const { container } = render(
      <BudgetPanel {...props} roles={hintRoles} buckets={collidingBuckets} />,
    );
    expectRowUniqueNames({
      minControls: 40,
      scope: container,
      roles: ["button"],
      requireCollisionSeed: true,
    });
  });
});

// WCAG-neutral, data-integrity (open-followups §70). A bucket's Total column and
// total row are built from `rowsForTotals`, which `filterSortAllocations` has
// ALREADY narrowed by the role filter — while the CCI tiles directly above them
// read the whole-bucket report straight off the engine. Two scopes, stacked, and
// the label just said "Total".
//
// ★★ THE FIGURES WERE NEVER WRONG. A total of what you are looking at is the right
//    reading for a filtered table and is what every other filtered table in the app
//    does; what was missing was anything on screen saying WHICH scope it meant. So
//    this pins the disclosure AND the scope together — asserting the label alone
//    would pass against a build that had quietly switched the totals to unfiltered.
//
// ★ Before this, NOTHING pinned the scope in either direction, so a future edit
//   could have flipped these totals to the unfiltered list with a green suite.
describe("BudgetPanel — a filtered bucket total says that it is filtered (§70)", () => {
  const twoRoleProps = {
    ...props,
    roles: [
      { id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
      { id: 7, disciplineId: 2, gradeId: 1, internalRate: 120, externalRate: 180 },
    ],
    disciplines: [{ id: 1, name: "Consulting" }, { id: 2, name: "Engineering" }],
    grades: [{ id: 1, name: "Senior" }],
    buckets: [{
      ...buckets[0],
      allocations: [
        { roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } },
        { roleId: 7, resourceIds: [], budgetHours: { "2026-01": 40 }, actualHours: { "2026-01": 20 } },
      ],
    }],
  };

  // ★ "Total" is also a COLUMN HEADER, so a bare text query matches two elements.
  //   The total ROW is the one `BucketTotalRow` marks `font-medium`; scoping to it
  //   is what makes this about the row rather than the header.
  const totalRowText = () => {
    const labels = screen.getAllByText(
      (txt) => txt === t("en-US", "budgetTotal") || txt === t("en-US", "budgetTotalFiltered"),
    );
    const label = labels.find((el) => el.closest("tr")?.classList.contains("font-medium"));
    if (!label) throw new Error("no total ROW found; only headers matched");
    return { label: label.textContent, row: label.closest("tr")?.textContent ?? "" };
  };

  test("says Total over every row, and Total (filtered) once the role filter narrows them", () => {
    render(<BudgetPanel {...twoRoleProps} />);

    const before = totalRowText();
    expect(before.label).toBe(t("en-US", "budgetTotal"));
    // Both allocations are in scope: 100 + 40 budget hours.
    expect(before.row).toContain("140");

    fireEvent.change(screen.getByPlaceholderText(t("en-US", "budgetRoleFilter")), {
      target: { value: "Engineering" },
    });

    const after = totalRowText();
    expect(after.label).toBe(t("en-US", "budgetTotalFiltered"));
    // Now a subtotal of the one matching role — and no longer the whole bucket.
    // ★ "20" is the filtered ACTUAL and is a substring of neither 140 nor 100, so it
    //   is an independent pin. "40" would NOT be: "140" contains it, so it is
    //   satisfied in both states and asserts nothing.
    expect(after.row).not.toContain("140");
    expect(after.row).toContain("20");
  });

  // ★ `filterSortAllocations` compares on `filter.trim()`, so whitespace narrows
  //   NOTHING. The label has to use the same predicate or it announces a filter
  //   that is not in effect.
  test("a whitespace-only filter narrows nothing and does not relabel the total", () => {
    render(<BudgetPanel {...twoRoleProps} />);
    fireEvent.change(screen.getByPlaceholderText(t("en-US", "budgetRoleFilter")), {
      target: { value: "   " },
    });
    const after = totalRowText();
    expect(after.label).toBe(t("en-US", "budgetTotal"));
    expect(after.row).toContain("140");
  });
});

// open-followups §68. The rule has to sit on the CELLS: `globals.css` puts every
// `aipm-cockpit-thead` table into the SEPARATED borders model, where a border set on a
// `<tr>` is ignored outright.
//
// ★★★ THIS EXISTS BECAUSE THE FIRST FIX SHIPPED BROKEN AND GREEN. It used the shared
//    `ROW_RULE_CLASS`, whose `last:` is `:last-child` — a question about the DOM PARENT.
//    Every role row is the ONLY child of its own `<tbody>` (the people disclosure's
//    `aria-controls` target must be a `<tbody>`), so every row was `:last-child`,
//    `border-b-0` won on all of them, and the DEFAULT planning mode drew no separators.
//    The class was present on every row, so class-placement assertions passed; jsdom has
//    no layout, so nothing else could see it either.
//
// ★★ The index-driven form is what makes this testable AT ALL: with `last:` the class
//    string is byte-identical on every row, so no assertion can distinguish a working
//    table from a broken one. Here only the LAST row differs, and that is the assertion.
//
// ★ This still cannot see a PAINTED border — jsdom has no layout. It pins the placement
//   and the last-row exemption; the appearance stays eye-verified.
describe("BudgetPanel — row separators sit on the cells, and only the last row is exempt (§68)", () => {
  const twoRoles = {
    ...props,
    roles: [
      { id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
      { id: 7, disciplineId: 2, gradeId: 1, internalRate: 120, externalRate: 180 },
    ],
    disciplines: [{ id: 1, name: "Consulting" }, { id: 2, name: "Engineering" }],
    grades: [{ id: 1, name: "Senior" }],
    buckets: [{
      ...buckets[0],
      allocations: [
        { roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } },
        { roleId: 7, resourceIds: [], budgetHours: { "2026-01": 40 }, actualHours: { "2026-01": 20 } },
      ],
    }],
  };

  /** The role rows, in render order — each is the sole `<tr>` of its own `<tbody>`. */
  const roleRows = (container: HTMLElement) =>
    [...container.querySelectorAll("tr")].filter((tr) =>
      tr.className.includes("[&>td]:border-b") || tr.querySelector("[aria-controls^='bucket-people-']"),
    );

  test("every role row but the last carries the cell rule; the last carries none", () => {
    const { container } = render(<BudgetPanel {...twoRoles} />);
    const rows = roleRows(container);
    // Anti-vacuity: two allocations must actually render, or "the last has none"
    // is satisfied by an empty list.
    expect(rows).toHaveLength(2);

    expect(rows[0].className).toContain("[&>td]:border-b");
    expect(rows[0].className).toContain("[&>td]:border-line");
    expect(rows[1].className).not.toContain("border-b");
  });

  // ★ The rule must never ride the `<tr>` itself, which is the original defect.
  //   `[&>td]:border-b` contains the substring "border-b", so this checks for a BARE
  //   `border-b`/`border-t` token rather than any occurrence.
  test("no role row carries a bare row-level border utility", () => {
    const { container } = render(<BudgetPanel {...twoRoles} />);
    for (const tr of roleRows(container)) {
      const tokens = tr.className.split(/\s+/);
      expect(tokens).not.toContain("border-b");
      expect(tokens).not.toContain("border-t");
      expect(tokens).not.toContain("border-line");
    }
  });
});
