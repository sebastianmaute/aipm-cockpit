import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { BudgetChangeTable } from "./budget-change-table";
import { formatCurrency } from "./resource-cost";
import { loadI18n } from "./i18n";
import type { BudgetHistoryEntry, BudgetHistorySummary, VarianceSplit } from "./budget-history";

const eur = (v: number) => formatCurrency(v, "EUR", "en-US");

const VENDOR_UP: BudgetHistoryEntry = {
  id: "a", at: "2026-01-20T09:00:00.000Z", date: "2026-01-20", kind: "updated",
  bucketId: 1, bucketName: "Vendor", deltaHours: 30, deltaValue: 3_000,
  projectBacHours: 120, projectBacValue: 12_000,
};
const OPS_GONE: BudgetHistoryEntry = {
  id: "b", at: "2026-02-10T09:00:00.000Z", date: "2026-02-10", kind: "deleted",
  bucketId: 2, bucketName: "Ops", deltaHours: -8, deltaValue: -800,
  projectBacHours: 112, projectBacValue: 11_200,
};

// Deliberately OUT of chronological order: `mergeBudgetHistories` unions
// prev-then-new ids, so a reload from a second device hands the entries back
// in whatever order the union produced. Both the row order and the cumulative
// column must be computed over the ORDERED list, not over this array.
const HISTORY: BudgetHistorySummary = {
  baselineDate: "2026-01-05",
  baseline: { hours: 90, value: 9_000 },
  attributed: { hours: 22, value: 2_200 },
  changes: [OPS_GONE, VENDOR_UP],
};

const SPLIT: VarianceSplit = { vac: -1_000, performance: -500, attributed: 2_200, unattributed: -2_700 };

function draw(over: { lang?: "en-US" | "de"; split?: VarianceSplit | null; unit?: "eur" | "hours" } = {}) {
  return render(
    <BudgetChangeTable
      lang={over.lang ?? "en-US"}
      history={HISTORY}
      split={over.split === undefined ? SPLIT : over.split}
      unit={over.unit ?? "eur"}
      currency="EUR"
    />,
  );
}

const bodyRows = (container: HTMLElement) => [...container.querySelectorAll("tbody tr")];
const cells = (row: Element) => [...row.querySelectorAll("th,td")].map((c) => c.textContent ?? "");

describe("BudgetChangeTable", () => {
  it("names the displayed unit in its caption", () => {
    const { container } = draw();
    expect(container.querySelector("caption")).toHaveTextContent("Budget changes (€)");
    const hours = draw({ unit: "hours" });
    expect(hours.container.querySelector("caption")).toHaveTextContent("Budget changes (Hours)");
  });

  // axe's scrollable-region-focusable (serious) flagged the unfocusable
  // `overflow-x-auto` wrapper once the e2e seed carried budget history (§557):
  // its cells hold no control, so a keyboard user could not scroll it.
  it("makes its horizontal scroll wrapper a keyboard-focusable region named by the caption", () => {
    const { container } = draw();
    const region = screen.getByRole("region", { name: "Budget changes (€)" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveClass("overflow-x-auto");
    expect(region).toContainElement(container.querySelector("table"));
  });

  it("lists the changes in chronological order, not in the array's order", () => {
    const { container } = draw();
    const rows = bodyRows(container);
    expect(rows).toHaveLength(2);
    expect(cells(rows[0])[0]).toBe("Jan 20, 2026");
    expect(cells(rows[1])[0]).toBe("Feb 10, 2026");
  });

  it("runs the cumulative column over the ordered list, not over each entry's own delta", () => {
    const { container } = draw();
    const rows = bodyRows(container);
    // Change column then cumulative column.
    expect(cells(rows[0]).slice(2)).toEqual([`+${eur(3_000)}`, `+${eur(3_000)}`]);
    expect(cells(rows[1]).slice(2)).toEqual([eur(-800), `+${eur(2_200)}`]);
  });

  it("reads the hours side of the same entries", () => {
    const { container } = draw({ unit: "hours" });
    const rows = bodyRows(container);
    expect(cells(rows[0]).slice(2)).toEqual(["+30 h", "+30 h"]);
    expect(cells(rows[1]).slice(2)).toEqual(["-8 h", "+22 h"]);
  });

  it("labels the deleted bucket's row", () => {
    const { container } = draw();
    const rows = bodyRows(container);
    expect(cells(rows[1])[1]).toContain("Ops");
    expect(cells(rows[1])[1]).toContain("removed");
    // Anti-vacuity: the surviving bucket's row carries no such label.
    expect(cells(rows[0])[1]).not.toContain("removed");
  });

  it("shows the pace split in its footer, with the note that names the forecast", () => {
    const { container } = draw();
    // Scoped to the footer: the cumulative column's last row carries the same
    // "+€2,200" text, so a document-wide query could pass on the wrong node.
    const foot = within(container.querySelector("tfoot") as HTMLElement);
    const footRow = (name: string) => foot.getByRole("rowheader", { name }).closest("tr") as HTMLElement;
    expect(within(footRow("Performance")).getByText(eur(-500))).toBeInTheDocument();
    expect(within(footRow("Added scope")).getByText(`+${eur(2_200)}`)).toBeInTheDocument();
    expect(within(footRow("Unexplained budget change")).getByText(eur(-2_700))).toBeInTheDocument();
    expect(screen.getByText("Split against the pace forecast.")).toBeInTheDocument();
  });

  it("drops the footer when no pace split is available, keeping the rows", () => {
    const { container } = draw({ split: null });
    expect(container.querySelector("tfoot")).toBeNull();
    expect(screen.queryByText("Split against the pace forecast.")).toBeNull();
    expect(bodyRows(container)).toHaveLength(2);
  });

  it("renders the German caption and column headers with umlauts", async () => {
    await loadI18n("de");
    const { container } = draw({ lang: "de" });
    expect(container.querySelector("caption")).toHaveTextContent("Budgetänderungen (€)");
    expect(screen.getByRole("columnheader", { name: "Änderung" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Zusätzlicher Umfang bisher" })).toBeInTheDocument();
    expect(screen.getByText("Aufteilung gegen die Tempo-Prognose.")).toBeInTheDocument();
  });
});
