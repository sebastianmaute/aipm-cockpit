import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BudgetReportPanel, BucketDetailTable, detailRowRateSource } from "./budget-report-panel";
import { loadI18n, t } from "./i18n";
import { SETTINGS_KEY } from "./use-settings";
import { defaultSettings } from "./settings-types";
import type { BucketReport, CciValue } from "./budget-report";
import type { SnapshotRecord } from "./snapshot";
import type { BudgetHistoryEntry } from "./budget-history";
import type { BudgetBucket, FxRates, ResourcePlan, Role } from "./types";

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
      disciplines={[]}
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

// §474 (rollup half): the same disclosure `BudgetFxRollupNotice` renders on
// budget-panel.tsx's rollup must also appear on this panel's project-total
// tiles — both sum every bucket's EUR-reported figure the same way.
describe("BudgetReportPanel — the project rollup discloses unresolved-rate summands", () => {
  it("names the count for a mixed project", () => {
    const mixed: BudgetBucket[] = [
      buckets[0], // EUR — resolved
      // Fixed-price: only a contract amount is converted, so only these are summed at par.
      { ...buckets[1], id: 4, name: "Delta", type: "fixed", fixedPriceAmount: 10000, currency: "USD" }, // unresolved (fxRates null)
      { ...buckets[2], id: 5, name: "Epsilon", type: "fixed", fixedPriceAmount: 10000, currency: "GBP" }, // unresolved
    ];
    renderPanel({ buckets: mixed, fxRates: null });
    const rollup = screen.getByText(/project total/i).closest("div") as HTMLElement;
    expect(within(rollup).getByText(t("en-US", "budgetFxRollupUnresolved", "2"))).toBeInTheDocument();
  });

  it("renders nothing when every bucket resolves", () => {
    renderPanel(); // default fixture: three EUR buckets only
    const rollup = screen.getByText(/project total/i).closest("div") as HTMLElement;
    expect(within(rollup).queryByText(/without an FX rate/i)).toBeNull();
  });
});

describe("BudgetReportPanel", () => {
  it("shows the project rollup (revenue + cost in EUR)", () => {
    renderPanel();
    // revenue = 80*180 + 50*150 + 120*150 = 39900 ; cost = 80*120 + 50*100 + 120*100 = 26600
    // Every bucket here is T&M, where consumed value IS revenue, so the figure
    // renders TWICE: once on the revenue tile, once on the consumption tile.
    // Pinned exactly — a bare "at least one" would not notice a third.
    // ★ The forecast facts row's own scope: every bucket here is also T&M, so its
    // AC happens to equal the same 39,900 — scope to the EXISTING
    // tiles grid so this assertion stays about the rollup tiles, not a
    // coincidence of the fixture. ★★ Find that grid through a label that
    // lives only in it ("Consumption"), never through its classes: the
    // Earned-value grid carries the very same `grid-cols-2 gap-3
    // sm:grid-cols-4` classes and renders after it, and the facts row's grid
    // class changes with the rate fact, so a class selector's "last match"
    // depends on which of those happen to render.
    const existingTilesGrid = screen.getByText(t("en-US", "budgetCciConsumption")).closest(".grid") as HTMLElement;
    expect(within(existingTilesGrid).getAllByText(/€?39,900|39\.900/)).toHaveLength(2);
    expect(within(existingTilesGrid).getByText(/€?26,600|26\.600/)).toBeInTheDocument();
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
    // The "Where the hours went" disclosure renders whenever the rate
    // mix is non-null (the default fixture's mix is non-null but does not
    // trigger), so a second `<table>` (native <details> whose closed content
    // jsdom still exposes to role queries) co-exists with the bucket table —
    // scope to the "By bucket" Section the same way the forecast-section test
    // further below ("shows the facts row and forecast cards inside their own
    // Forecast section") scopes to "Forecast" (Finding 7).
    const byBucketHeading = screen.getByRole("heading", { name: t("en-US", "budgetReportByBucket") });
    const byBucketSection = byBucketHeading.parentElement as HTMLElement;
    const table = within(within(byBucketSection).getByRole("table"));
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

  it("renders the chart and its switches inside the Forecast section, with no Burn-down section of its own", () => {
    renderPanel();
    const forecastSection = screen.getByRole("heading", { name: t("en-US", "forecastTitle") }).parentElement as HTMLElement;
    // Spec B, Decision 6: the two sections merged into one.
    expect(screen.queryByRole("heading", { name: "Burn-down" })).toBeNull();
    expect(within(forecastSection).getByRole("radio", { name: "Burn-down" })).toBeInTheDocument();
    expect(within(forecastSection).getByRole("radio", { name: "Hours" })).toBeInTheDocument();
    // The default device view (vitest.setup.ts clears localStorage after every test).
    expect(within(forecastSection).getByText("Budget remaining")).toBeInTheDocument();
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

  it("labels the burn-down value axis in EUR even when the plan names another currency", () => {
    // ★★ `computeBurndownSeries` builds every T&M bucket's value as
    // `budgetHours × role.rates.external`, and a fixed-price bucket's from its
    // contract amount via `currencyToEur` (§472) — either way nothing it
    // produces is converted a second time, and the engine's money unit is EUR.
    // So the series is EUR whatever the plan's `currency` says — narrowing
    // that field to the `BudgetCurrency` union did NOT make it safe to label
    // with, because the union still admits `USD`/`GBP`: it states the plan's
    // base currency, never the unit of an unconverted engine figure. This
    // file's own top-level `buckets` fixture is all `type: "tm"`, so this test
    // exercises the rate-derived half only; §472's fixed-price contract basis
    // is pinned separately in `budget-burndown.test.ts`. This file's `money`
    // helper already hardcodes `formatCurrency(n, "EUR", …)` for the
    // co-rendered cost/EVM tiles, which are rate-derived in exactly the same way.
    renderPanel({ plan: { ...plan, currency: "USD" } });
    // Scoped to the € chart: `BurndownChart` renders `<div>{caption}</div><svg>`,
    // so the caption's parent is that chart alone ("Budget remaining" is the
    // default burn-down × € view).
    const valueChart = screen.getByText(/Budget remaining/i).parentElement!;

    // ★★★ THE POSITIVE CONTROL. `queryByText(/\$/) === null` passes just as
    // happily when the query is wrong, the scope is empty, or the chart failed
    // to render. The exact count proves the axis is populated. Y ticks only
    // (`data-axis="y"`): forecast end labels are money too and would blur the
    // claim. Ticks are `[yMin if below zero, 0, total/2, total]`, and this
    // fixture is OVER budget (Gamma books 120 h against 80, so actual spend
    // exceeds the budget and the actual line ends below zero) → 4.
    const money = Array.from(valueChart.querySelectorAll("svg text[data-axis='y']")).map((el) => el.textContent ?? "");
    expect(money).toHaveLength(4);
    expect(money.filter((s) => s.includes("$"))).toEqual([]);
    expect(money.every((s) => s.includes("€"))).toBe(true);
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

// The summary tiles at the top of this view were gated; the detail table
// directly beneath them was not — the same fix applied one section too high.
// `contributionMargin` is computed regardless of `costIsKnowable`, so an
// unstaffed fixed-price bucket yields a literal 100 (not null) and printed as a
// genuine reading, and its full contract value printed as a win.
describe("BudgetReportPanel — detail table with an uncostable bucket", () => {
  const unstaffedFixed: BudgetBucket = {
    id: 9, name: "Unstarted contract", type: "fixed", currency: "EUR",
    fixedPriceAmount: 50000, startDate: "2026-01-01", endDate: "2026-01-31",
    status: "open", allocations: [],
  };

  function rowFor(name: string): HTMLElement {
    return screen.getByText(name).closest("tr")!;
  }

  it("does not print a margin for an unstaffed fixed-price bucket", () => {
    render(
      <BudgetReportPanel
        lang="en-US" buckets={[unstaffedFixed]} plan={plan} roles={roles} disciplines={[]} resources={[]}
        absences={[]} holidaySet={new Set<string>()} workdayHours={8} fxRates={null}
        tasks={[]} today="2026-06-02"
      />,
    );
    const row = rowFor("Unstarted contract");
    expect(within(row).queryByText("100.0%")).not.toBeInTheDocument();
    expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("does not print a full-contract win for it either", () => {
    render(
      <BudgetReportPanel
        lang="en-US" buckets={[unstaffedFixed]} plan={plan} roles={roles} disciplines={[]} resources={[]}
        absences={[]} holidaySet={new Set<string>()} workdayHours={8} fxRates={null}
        tasks={[]} today="2026-06-02"
      />,
    );
    // Scoped to the LAST cell: the budget column legitimately shows the
    // €50,000 contract value, so a row-wide match would fail for the wrong
    // reason. Win/loss is the trailing column.
    const cells = rowFor("Unstarted contract").querySelectorAll("td");
    const winLoss = cells[cells.length - 1];
    expect(winLoss.textContent).toBe("—");
  });

  it("still prints a real margin for a costable bucket", () => {
    renderPanel();
    const row = rowFor("Beta");
    expect(within(row).queryByText("—")).not.toBeInTheDocument();
  });
});

// The margin sort key was gated when the detail table was fixed; the win/loss
// key two lines below it was not. An unstaffed fixed-price bucket has
// winLossValue = revenue - 0 = the whole contract, so sorting descending put a
// row DISPLAYING A DASH above every genuine win — the same "phantom figure
// leads the table" defect the margin fix named, on the adjacent column.
describe("BudgetReportPanel — detail table sorting with an uncostable bucket", () => {
  const unstaffedFixed: BudgetBucket = {
    id: 9, name: "Unstarted contract", type: "fixed", currency: "EUR",
    fixedPriceAmount: 50000, startDate: "2026-01-01", endDate: "2026-01-31",
    status: "open", allocations: [],
  };

  it("does not sort an unknown win/loss above real ones", async () => {
    const user = userEvent.setup();
    render(
      <BudgetReportPanel
        lang="en-US" buckets={[...buckets, unstaffedFixed]} plan={plan} roles={roles}
        disciplines={[]} resources={[]} absences={[]} holidaySet={new Set<string>()} workdayHours={8}
        fxRates={null} tasks={[]} today="2026-06-02"
      />,
    );
    const header = screen.getByRole("button", { name: /win\/loss/i });
    // Two clicks to reach descending, where the phantom 50,000 would lead.
    await user.click(header);
    await user.click(header);
    // The NAME is td[1] — td[0] is the leading status badge. Reading td[0]
    // makes this pass no matter how the table is ordered.
    const names = screen.getAllByRole("row").slice(1)
      .map((r) => (r.querySelectorAll("td")[1] as HTMLElement)?.textContent ?? "");
    // Guard the fixture: the phantom row must actually be present to be misplaced.
    expect(names).toContain("Unstarted contract");
    expect(names[0]).not.toBe("Unstarted contract");
  });

  it("does not sort an unknown win/loss above real losses on the FIRST click", async () => {
    // A newly-selected column starts ASCENDING, so this is the default
    // interaction — and ascending win/loss is precisely the "who is losing the
    // most" scan. A sentinel that sinks unknowns in descending floats them here.
    const user = userEvent.setup();
    render(
      <BudgetReportPanel
        lang="en-US" buckets={[...buckets, unstaffedFixed]} plan={plan} roles={roles}
        disciplines={[]} resources={[]} absences={[]} holidaySet={new Set<string>()} workdayHours={8}
        fxRates={null} tasks={[]} today="2026-06-02"
      />,
    );
    await user.click(screen.getByRole("button", { name: /win\/loss/i }));
    const names = screen.getAllByRole("row").slice(1)
      .map((r) => (r.querySelectorAll("td")[1] as HTMLElement)?.textContent ?? "");
    expect(names).toContain("Unstarted contract");
    // Gamma carries a real loss (-6000) and must lead a worst-first view.
    expect(names[0]).not.toBe("Unstarted contract");
  });
});

// The mirror image of the budget panel's round-trip test. There the engine's
// EUR figure is converted back OUT to the bucket currency before display; this
// table converts NOTHING and heads its money columns "(EUR)", so the very same
// engine figure must arrive here already converted. Both halves of the fixture
// are load-bearing: a NON-EUR bucket and a rate != 1. `renderPanel` passes
// `fxRates={null}`, at which `resolveRate` returns 1 and `currencyToEur` is
// the identity function — so every other test in this file passes
// byte-identically whether the engine's conversion exists or not.
describe("BudgetReportPanel — a non-EUR fixed-price bucket", () => {
  const usdRates: FxRates = {
    base: "EUR", date: "2026-01-01", fetchedAt: "2026-01-01T00:00:00Z",
    rates: { EUR: 1, USD: 1.1 },
  };
  const usdFixed: BudgetBucket = {
    id: 9, name: "USD contract", type: "fixed", currency: "USD", fixedPriceAmount: 10000,
    startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
    allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: {} }],
  };

  it("prints the CONVERTED contract in the EUR-labelled Budget column", () => {
    // `money` hardcodes `formatCurrency(n, "EUR", …)` and the column is
    // literally headed "Budget (EUR)", so whatever `budgetValue` holds is
    // printed as euros with no conversion of its own. 10,000 USD at 1.1 is
    // 9,090.91 EUR, rendered "€9,091" (`maximumFractionDigits: 0`). Without
    // the engine's inward conversion the foreign 10,000 prints verbatim under
    // a euro sign — "€10,000", a number that is simply not the contract's
    // value in the unit its own column header claims.
    renderPanel({ buckets: [usdFixed], fxRates: usdRates });
    // Derived, not hardcoded: the leading status <th> makes the header and
    // body indices line up 1:1, so a column inserted anywhere left of this one
    // shifts both together and this test keeps testing the same column.
    const headers = screen.getAllByRole("columnheader");
    const col = headers.findIndex((h) => h.textContent?.includes("Budget (EUR)"));
    // Scope guard, not a second claim: a renamed header would otherwise make
    // `cells[-1]` throw a TypeError that names nothing.
    expect(col).toBeGreaterThan(-1);

    const cells = screen.getByText("USD contract").closest("tr")!.querySelectorAll("td");
    expect(cells[col].textContent).toBe("€9,091");
  });
});

// §474: a non-EUR bucket with neither a manual override nor a cached ECB
// rate is summed into the EUR rollup at par (rate 1), and its Currency
// column cell used to be indistinguishable from a bucket whose resolved
// rate genuinely is 1 — both render the bare currency code, since
// `rate !== 1` was the only thing that gated the `(×rate)` suffix.
describe("BudgetReportPanel — §474 the currency column discloses an unresolved FX rate", () => {
  const parRates: FxRates = {
    base: "EUR", date: "2026-01-01", fetchedAt: "2026-01-01T00:00:00Z",
    rates: { EUR: 1, USD: 1 },
  };
  const rateless: BudgetBucket = {
    id: 9, name: "Rateless contract", type: "fixed", currency: "USD", fixedPriceAmount: 10000,
    startDate: "2026-01-01", endDate: "2026-01-31", status: "open", allocations: [],
  };

  function currencyCellFor(name: string): HTMLElement {
    const headers = screen.getAllByRole("columnheader");
    const col = headers.findIndex((h) => h.textContent?.includes("Currency"));
    // Scope guard — see the round-trip test above for why this matters.
    expect(col).toBeGreaterThan(-1);
    const cells = screen.getByText(name).closest("tr")!.querySelectorAll("td");
    return cells[col] as HTMLElement;
  }

  it("marks a bucket with no override and no cached rate", () => {
    renderPanel({ buckets: [rateless], fxRates: null });
    expect(currencyCellFor("Rateless contract")).toHaveTextContent(/USD.*1:1/);
  });

  it("does not mark a bucket whose CACHED rate genuinely resolves to 1", () => {
    // The mutant this guards against: a helper reading `rate !== 1` alone
    // would treat this identically to the unresolved case above.
    renderPanel({ buckets: [rateless], fxRates: parRates });
    const cell = currencyCellFor("Rateless contract");
    expect(cell).not.toHaveTextContent(/1:1/);
    expect(cell.textContent).toBe("USD");
  });

  it("does not mark an EUR bucket", () => {
    renderPanel(); // default `buckets` (Alpha/Beta/Gamma) are all EUR
    expect(currencyCellFor("Alpha")).not.toHaveTextContent(/1:1/);
  });

  // This table's money columns are EUR and a T&M row's figures (hours × EUR
  // role rates) were never converted, so "converted at 1:1" would claim a
  // conversion that did not happen. Only the fixed-price row's contract
  // amount went through `currencyToEur` at par. Both rows in ONE render so
  // the pair differs by `type` alone.
  it("marks the rateless fixed-price row but not the rateless T&M row", () => {
    const ratelessTm: BudgetBucket = {
      id: 10, name: "Rateless T&M", type: "tm", currency: "USD",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open", allocations: [],
    };
    renderPanel({ buckets: [rateless, ratelessTm], fxRates: null });
    expect(currencyCellFor("Rateless contract")).toHaveTextContent(/USD.*1:1/);
    const tmCell = currencyCellFor("Rateless T&M");
    expect(tmCell).not.toHaveTextContent(/1:1/);
    expect(tmCell.textContent).toBe("USD");
  });
});

describe("BudgetReportPanel burn-down chain warning", () => {
  it("stays silent when no bucket was ever chained", () => {
    // The default fixture links nothing — parallel buckets are the normal budget
    // model, so a permanent warning here is a false alarm on every project.
    renderPanel();
    expect(screen.queryByText(/not linked into one chain/)).toBeNull();
    expect(screen.queryByText(/Burn-down covers the whole plan period/)).toBeNull();
  });

  it("warns when a half-built chain leaves a bucket outside it", () => {
    renderPanel({ buckets: [{ ...buckets[0], successorId: 2 }, buckets[1], buckets[2]] });
    expect(screen.getByText(/not linked into one chain/)).toBeInTheDocument();
  });

  it("warns when a bucket points at a successor that no longer exists", () => {
    renderPanel({ buckets: [{ ...buckets[0], successorId: 99 }, buckets[1], buckets[2]] });
    expect(screen.getByText(/successor that no longer exists \(Alpha\)/)).toBeInTheDocument();
  });

  it("does not warn once the buckets are chained", () => {
    renderPanel({
      buckets: [
        { ...buckets[0], successorId: 2 },
        { ...buckets[1], successorId: 3 },
        buckets[2],
      ],
    });
    expect(screen.queryByText(/not linked into one chain/)).toBeNull();
  });
});

/**
 * The EUR HALF of the win/loss hint pair, pinned in German at its own site.
 *
 * ★★ THE PAIR ONLY WORKS IF BOTH HALVES ARE PINNED. This string and
 * `budgetWinLossHint` are word-for-word identical but for one clause — "In
 * EUR" here, "In der Währung des Budgetpostens" on the panel tile — because
 * this column really is EUR and that tile really is converted. Pinning one
 * half alone leaves the distinction resting on an unpinned string, and the
 * twin's own test (`budget-panel.test.tsx`) argues from exactly this
 * difference. The spec's testing policy asks for both.
 *
 * ★ `loadI18n("de")` first: the DE dictionary is lazy and `t("de", …)` serves
 * English until it resolves. ★ `SortResizeTh` passes no `nameContext` here —
 * one table in the view, nothing to disambiguate against — so `InfoTooltip`
 * falls back to `aria-label={text}` and the accessible name is the bare hint,
 * with no row token appended.
 */
describe("BudgetReportPanel — the German win/loss column hint", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("states both branches and names EUR, not the bucket currency", () => {
    renderPanel({ lang: "de" });
    const hint = "Festpreis: Erlös minus Kosten. Time-and-Material: Budget minus Verbrauch, also das verbleibende Budget. In EUR; negativ bedeutet, dass der Bucket mit Verlust läuft.";
    // Both props, as in the twin's test: the `aria-label` locates the trigger,
    // the portalled body is what the reader actually sees, and the call site
    // passes the key to each separately.
    const trigger = screen.getByLabelText(hint);
    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent(hint);
  });
});

// §474 (rollup follow-up): `BucketDetailTable`'s row-mapping fell back to a
// literal `"eur"` rate source for a bucket missing from `bucketById` — a
// state that "should not happen in practice" (the file's own comment), but
// labelling an UNKNOWN state as a CONFIRMED EUR reading was itself the false
// claim §474 exists to remove, one row up. Fixed by resolving to `null`
// instead, which the row-mapper reads as "render the bare currency code",
// matching what "eur" always rendered anyway (this row's `rate` is hardcoded
// to 1, and `bucketCurrencyLabel` never appends a suffix at rate 1).
describe("§474 — the missing-bucket fallback does not claim EUR", () => {
  const detailColWidths = {
    bucket: 160, mode: 90, type: 80, status: 80, currency: 110,
    budgetH: 80, planH: 80, actualH: 80, budgetEur: 110, consumedEur: 120, margin: 90, winLoss: 110,
  };
  const emptyCci: CciValue = { amount: 0, percent: null };
  const ghostRow: BucketReport = {
    bucketId: 999, name: "Ghost", currency: "USD", type: "tm", status: "open",
    budgetHours: 0, plannedHours: 0, actualHours: 0,
    budgetValue: 0, consumedValue: 0, revenue: 0, cost: 0, budgetCost: 0,
    winLossHours: 0, winLossValue: 0, spilloverInHours: 0, spilloverInValue: 0,
    ownBudget: { budgetHours: 0, budgetValue: 0, winLossHours: 0, winLossValue: 0 },
    contributionMargin: emptyCci, costPerformance: emptyCci, consumption: emptyCci,
    earnedValue: null, costPerformanceIndex: null, budgetMirrorsPlan: false,
    costUnknownReason: "no-rows", unpricedDisciplineIds: [],
  };

  it("resolves to null for a missing bucket record, never the \"eur\" source", () => {
    expect(detailRowRateSource(undefined, null)).toBeNull();
  });

  it("resolves normally through resolveRateSource for a present bucket", () => {
    const b: BudgetBucket = {
      id: 1, name: "B", type: "tm", currency: "USD", startDate: "", endDate: "", status: "open", allocations: [],
    };
    expect(detailRowRateSource(b, null)).toBe("unresolved");
  });

  it("renders the same bare currency code as before for a row whose bucket is missing", () => {
    render(
      <BucketDetailTable
        lang="en-US"
        rows={[ghostRow]}
        bucketById={new Map()}
        fxRates={null}
        colResize={{
          colWidths: detailColWidths,
          sizedWidths: {},
          startColResize: () => {},
          resetColWidths: () => {},
        }}
        money={(n) => `€${n}`}
      />,
    );
    const row = screen.getByText("Ghost").closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("USD");
    // Rendering is unchanged: no suffix, no "1:1" marker, nothing claiming EUR.
    expect(row).not.toHaveTextContent(/1:1/);
    expect(row).not.toHaveTextContent(/EUR/);
  });
});

// The facts row, forecast cards, banner and the section order.
describe("BudgetReportPanel — forecast section order", () => {
  it("orders sections Project total, Forecast, By bucket, Earned value", () => {
    renderPanel();
    // Only the report's own SECTION headings — every `Section` title is an
    // h3; the forecast card title is an h4 (nested under the Forecast
    // section's h3, not a sibling of it), so a bare heading-role query would
    // still pick it up. Filtering to the known, distinct Section title
    // texts keeps this scoped to sections regardless of level. The
    // Burn-down section no longer exists: its chart lives in Forecast.
    const sectionTitles = [
      t("en-US", "budgetReportProjectTotal"),
      t("en-US", "forecastTitle"),
      t("en-US", "budgetReportByBucket"),
      // Pinned via the live key (currently "Earned value · effort"), not a
      // hardcoded literal, so a future rename of the heading text keeps this
      // assertion valid.
      t("en-US", "evmTitle"),
    ];
    const headingTexts = screen.getAllByRole("heading").map((h) => h.textContent ?? "");
    const found = headingTexts.filter((text) => sectionTitles.includes(text));
    expect(found).toEqual(sectionTitles);
  });

  it("shows the reading switch and the chosen card inside their own Forecast section", () => {
    renderPanel();
    const forecastHeading = screen.getByRole("heading", { name: t("en-US", "forecastTitle") });
    // Finding 7: `within` the actual Forecast section, not a bare "exists
    // somewhere on the page" check — the heading's parent IS the `Section`
    // wrapper (`report-table.tsx`'s `Section` renders `<h3>{title}</h3>` as a
    // sibling of its children inside one wrapping `<div>`).
    const forecastSection = forecastHeading.parentElement as HTMLElement;
    expect(within(forecastSection).getByRole("radiogroup", { name: t("en-US", "forecastViewLabel") })).toBeInTheDocument();
    // Finding 2: the region's accessible name is the exact EN title.
    expect(within(forecastSection).getByRole("region", { name: t("en-US", "forecastPaceTitle") })).toBeInTheDocument();
    // One card at a time; pace is the default device reading
    // (vitest.setup.ts clears localStorage after every test).
    expect(within(forecastSection).queryByRole("region", { name: t("en-US", "forecastEfficiencyTitle") })).toBeNull();
  });
});

// Threads `snapshots` into `bucketProgressSeries` -> `progress`, so a
// hand-entered bucket's recorded history reaches the earned-value chart. The
// ev-history line only draws in the "cumulative" chart orientation
// (`burndown-geometry.ts`'s `!down` gate), so these tests persist that device
// choice to `localStorage` before rendering, mirroring
// `burndown-chart-panel.test.tsx`'s "opens on a persisted device choice".
describe("BudgetReportPanel — snapshot progress feeds the earned-value chart", () => {
  beforeAll(() => loadI18n("en-US"));
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...defaultSettings, budgetChartView: "cumulative" }));
  });

  function snapshotRecord(over: Partial<SnapshotRecord> = {}): SnapshotRecord {
    return {
      id: "2026-01-01T00:00:00.000Z", capturedAt: "2026-01-01T00:00:00.000Z",
      bucket: "2026-01", cadence: "monthly", trigger: "manual", isBaseline: false,
      remainingHours: null, remainingCost: null, pctComplete: 30,
      forecastEndDate: "2026-06-30", planEndDate: "2026-06-30", spi: null, cpi: null,
      overallRag: "", scheduleRag: "", budgetRag: "", scopeRag: "",
      milestones: [], series: [], bucketProgress: [{ bucketId: 1, pctComplete: 30 }],
      ...over,
    };
  }
  const manualPlan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-06-30", granularity: "month", currency: "EUR" };
  const manualBucket: BudgetBucket = {
    id: 1, name: "Manual", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-06-30", status: "open", percentComplete: 60,
    allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 40 } }],
  } as unknown as BudgetBucket;

  it("without a matching snapshot record, the bucket's pre-today points stay partial", async () => {
    renderPanel({ buckets: [manualBucket], plan: manualPlan, today: "2026-06-02" });
    await act(async () => {});
    expect(screen.getByText(t("en-US", "burndownEvPartial"))).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "burndownEvPartialNotRecorded", "Manual"))).toBeInTheDocument();
  });

  it("draws a solid earned-value line, with no partial legend/aria sentence, once the bucket's recorded snapshot is threaded", async () => {
    const { container } = renderPanel({
      buckets: [manualBucket], plan: manualPlan, today: "2026-06-02",
      snapshots: [snapshotRecord()],
    });
    await act(async () => {});
    // Previously (progress stubbed to an empty Map — the stop-gap this task
    // replaces), every point before today had no record to read and stayed
    // partial; assert on both the chart's accessible name (aria-label) and
    // the visible legend/caption.
    const aria = container.querySelector("svg[role='img']")?.getAttribute("aria-label") ?? "";
    expect(aria).not.toContain(t("en-US", "burndownAriaEvPartial", "Manual"));
    expect(screen.queryByText(t("en-US", "burndownEvPartial"))).toBeNull();
    expect(screen.queryByText(t("en-US", "burndownEvPartialNotRecorded", "Manual"))).toBeNull();
    // Positive control: absence of the partial markers is also what an
    // UNAVAILABLE history (no line drawn at all) would look like, so assert
    // a line was actually drawn — the "Earned value history" legend swatch
    // is present, and the "no history yet" note is absent.
    expect(screen.getByText(t("en-US", "burndownEvHistory"))).toBeInTheDocument();
    expect(screen.queryByText(/No earned-value history yet/i)).toBeNull();
  });
});

// Spec B: one Forecast section — banners, rate-mix note, then a row holding the
// chosen card (30%) and the chart (70%), then the recorded-change table at full
// width below the row. jsdom has no layout, so placement is pinned by structure
// and by the classes that produce it.
describe("BudgetReportPanel — the forecast row (spec B)", () => {
  // Default fixture: 230 budget hours worth 37,500 € at external rates; the
  // history records a baseline and one later change, so the table has a row.
  const HISTORY: BudgetHistoryEntry[] = [
    {
      id: "h1", at: "2026-01-01T00:00:00.000Z", date: "2026-01-01", kind: "baseline",
      bucketId: null, bucketName: "", projectBacHours: 200, projectBacValue: 33000, deltaHours: 0, deltaValue: 0,
    },
    {
      id: "h2", at: "2026-01-10T09:00:00.000Z", date: "2026-01-10", kind: "updated",
      bucketId: 3, bucketName: "Gamma", projectBacHours: 230, projectBacValue: 37500, deltaHours: 30, deltaValue: 4500,
    },
  ];
  const forecastSectionOf = () =>
    screen.getByRole("heading", { name: t("en-US", "forecastTitle") }).parentElement as HTMLElement;
  const ancestorWithClass = (el: Element, cls: string): HTMLElement | null => {
    for (let n = el.parentElement; n; n = n.parentElement) if (n.classList.contains(cls)) return n;
    return null;
  };
  const rowIn = (section: HTMLElement) => {
    const card = within(section).getByRole("region", { name: t("en-US", "forecastPaceTitle") });
    const row = ancestorWithClass(card, "xl:flex-row");
    expect(row).not.toBeNull();
    return row!;
  };

  it("puts the chosen card beside the chart in one row, card first, with the caption under the chart", () => {
    renderPanel();
    const row = rowIn(forecastSectionOf());
    const [cardCol, chartCol] = Array.from(row.children) as HTMLElement[];
    expect(row.children).toHaveLength(2);
    expect(cardCol).toHaveClass("xl:w-[30%]");
    expect(cardCol).toContainElement(screen.getByRole("region", { name: t("en-US", "forecastPaceTitle") }));
    expect(chartCol).toHaveClass("min-w-0", "flex-1");
    const orientation = within(chartCol).getByRole("radiogroup", { name: "Chart orientation" });
    const caption = within(chartCol).getByText(t("en-US", "dashboardBurnCaption"));
    expect(orientation.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chartCol.lastElementChild).toBe(caption);
  });

  it("puts the recorded-change table full width below the row, never beside the chart", () => {
    renderPanel({ budgetHistory: HISTORY });
    const section = forecastSectionOf();
    const row = rowIn(section);
    const tables = within(section).getAllByRole("region", { name: /Budget changes/ });
    expect(tables).toHaveLength(1);
    const table = tables[0];
    expect(row.contains(table)).toBe(false);
    expect(row.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The panel's own 2xl side-by-side slot is not used in the report.
    expect(ancestorWithClass(table, "2xl:flex-row")).toBeNull();
    // The caption stays with the chart, above the table.
    const caption = within(section).getByText(t("en-US", "dashboardBurnCaption"));
    expect(caption.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
