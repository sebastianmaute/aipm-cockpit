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
    render(<BurndownCharts series={series} lang="en-US" currency="EUR" />);
    expect(screen.getByText("Hours remaining")).toBeTruthy();
    expect(screen.getByText("Budget remaining")).toBeTruthy();
  });
  it("renders two chart svg elements", () => {
    const { container } = render(<BurndownCharts series={series} lang="en-US" currency="EUR" />);
    // The legend adds 3 aria-hidden inline SVGs; only the two Chart SVGs carry role="img".
    expect(container.querySelectorAll("svg[role='img']").length).toBe(2);
  });
  it("draws the actual line pink when the latest actual remaining is negative (over budget)", () => {
    const over: BurndownSeries = {
      ...series,
      actualRemainingHours: [180, -40, null],
      actualRemainingValue: [36000, -8000, null],
    };
    const { container } = render(<BurndownCharts series={over} lang="en-US" currency="EUR" />);
    const pink = container.querySelectorAll("polyline.stroke-AIPM-pink");
    const green = container.querySelectorAll("polyline.stroke-AIPM-green");
    expect(pink.length).toBe(2); // both actual lines pink
    expect(green.length).toBe(0);
  });
  it("shows the no-data hint when total budget is zero", () => {
    const empty: BurndownSeries = {
      ...series, totalBudgetHours: 0, totalBudgetValue: 0,
      plannedRemainingHours: [0, 0, 0], plannedRemainingValue: [0, 0, 0],
      actualRemainingHours: [0, 0, null], actualRemainingValue: [0, 0, null],
    };
    render(<BurndownCharts series={empty} lang="en-US" currency="EUR" />);
    expect(screen.getByText("No budget configured")).toBeTruthy();
  });

  it("labels the hours axis with the max value and a period date", () => {
    const SERIES: BurndownSeries = {
      periods: ["2026-01", "2026-02", "2026-03"],
      plannedRemainingHours: [100, 50, 0],
      actualRemainingHours: [100, 60, null],
      plannedRemainingValue: [10000, 5000, 0],
      actualRemainingValue: [10000, 6000, null],
      todayIndex: 1,
      totalBudgetHours: 100,
      totalBudgetValue: 10000,
    };
    const { getAllByText } = render(
      <BurndownCharts series={SERIES} lang="en-US" currency="EUR" />,
    );
    expect(getAllByText("100h").length).toBeGreaterThan(0);
    expect(getAllByText("2026-01").length).toBeGreaterThan(0);
    expect(getAllByText("2026-03").length).toBeGreaterThan(0);
    expect(getAllByText(/10,000/).length).toBeGreaterThan(0);
  });
});
