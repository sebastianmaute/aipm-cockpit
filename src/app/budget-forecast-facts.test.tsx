import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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

  it("shows a dash for EV (and no percent) when ev/percentComplete are null, while BAC/AC/Remaining still show real figures", () => {
    render(<ForecastFactsRow lang="en-US" forecast={EV_NULL} />);
    // Exactly one dash on the page — the EV tile's value — and the other
    // three facts still render their real money figures (EV_NULL uses
    // distinct bac/ac/remaining so this can't pass by accidental overlap).
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("€240,000")).toBeInTheDocument();
    expect(screen.getByText("€100,000")).toBeInTheDocument();
    expect(screen.getByText("€140,000")).toBeInTheDocument();
    expect(screen.queryByText(/%\)$/)).toBeNull();
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

  // Finding 6: label-in-name is already covered exactly by "gives each fact a
  // term-bearing tooltip trigger" above — each label is literally
  // `What is <term>?`, so an exact match on the label IMPLIES it contains the
  // term. A separate containment check here would be vacuous (it would pass
  // even if the labels were unrelated to their tiles, since `within(container)`
  // finds the tile's own visible term text regardless of what the tooltip
  // label says). Deleted rather than kept as a weaker duplicate.
});
