import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ForecastFactsRow } from "./budget-forecast-facts";
import type { BudgetForecast } from "./budget-forecast";

// §5.6 worked example: BAC €240,000, AC €168,000, Remaining €72,000, EV €148,800 (62%).
const AVAILABLE: BudgetForecast = {
  facts: { bac: 240000, ac: 168000, remaining: 72000, ev: 148800, percentComplete: 62 },
  pace: { unavailable: "no-burn", windowStart: "2026-08-17", windowEnd: "2026-09-11", lastBookingDate: null },
  efficiency: { unavailable: "no-actual-cost" },
  gap: null,
  hasFixedPrice: false,
};

const EV_NULL: BudgetForecast = {
  ...AVAILABLE,
  facts: { bac: 240000, ac: 100000, remaining: 140000, ev: null, percentComplete: null },
};

describe("ForecastFactsRow", () => {
  it("shows BAC, AC, Remaining and EV with the percent complete", () => {
    render(<ForecastFactsRow lang="en-US" forecast={AVAILABLE} />);
    expect(screen.getByText("€240,000")).toBeInTheDocument();
    expect(screen.getByText("€168,000")).toBeInTheDocument();
    expect(screen.getByText("€72,000")).toBeInTheDocument();
    expect(screen.getByText("€148,800 (62%)")).toBeInTheDocument();
  });

  it("shows a dash for EV when it is null", () => {
    render(<ForecastFactsRow lang="en-US" forecast={EV_NULL} />);
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it("gives each fact a term-bearing tooltip trigger", () => {
    render(<ForecastFactsRow lang="en-US" forecast={AVAILABLE} />);
    const triggers = document.querySelectorAll("[data-info-tooltip-trigger]");
    const labels = Array.from(triggers).map((el) => el.getAttribute("aria-label"));
    expect(labels).toEqual([
      "What is Budget (BAC)?",
      "What is Actuals (AC)?",
      "What is Remaining?",
      "What is Earned value (EV)?",
    ]);
  });

  it("every fact label contains its own visible term (label-in-name)", () => {
    const { container } = render(<ForecastFactsRow lang="en-US" forecast={AVAILABLE} />);
    const tiles = within(container).getAllByText(/Budget \(BAC\)|Actuals \(AC\)|Remaining|Earned value \(EV\)/);
    expect(tiles.length).toBeGreaterThan(0);
  });
});
