import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BurndownCharts } from "./burndown-chart";
import type { BurndownSeries } from "./budget-burndown";

const series: BurndownSeries = {
  periods: ["2026-01", "2026-02", "2026-03"],
  plannedRemainingHours: [200, 100, 0],
  plannedRemainingValue: [40000, 20000, 0],
  actualRemainingHours: [180, 90, null],
  actualRemainingValue: [36000, 18000, null],
  todayIndex: 1,
  totalBudgetHours: 300,
  totalBudgetValue: 60000,
};

describe("BurndownCharts", () => {
  it("renders both chart captions", () => {
    render(<BurndownCharts series={series} lang="en-US" />);
    expect(screen.getByText("Hours remaining")).toBeTruthy();
    expect(screen.getByText("Budget remaining")).toBeTruthy();
  });
  it("renders two svg elements", () => {
    const { container } = render(<BurndownCharts series={series} lang="en-US" />);
    expect(container.querySelectorAll("svg").length).toBe(2);
  });
  it("shows the no-data hint when total budget is zero", () => {
    const empty: BurndownSeries = {
      ...series, totalBudgetHours: 0, totalBudgetValue: 0,
      plannedRemainingHours: [0, 0, 0], plannedRemainingValue: [0, 0, 0],
      actualRemainingHours: [0, 0, null], actualRemainingValue: [0, 0, null],
    };
    render(<BurndownCharts series={empty} lang="en-US" />);
    expect(screen.getByText("No budget configured")).toBeTruthy();
  });
});
