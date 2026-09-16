import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { BurndownChartPanel } from "./burndown-chart-panel";
import { SETTINGS_KEY } from "./use-settings";
import { defaultSettings } from "./settings-types";
import { CHART_FORECAST, CHART_FORECAST_HOURS, CHART_SERIES } from "../test/chart-fixtures";

const bundle = { eur: CHART_FORECAST, hours: CHART_FORECAST_HOURS, evHistory: { available: true as const, points: [] } };

function renderPanel() {
  return render(
    <BurndownChartPanel lang="en-US" series={CHART_SERIES} bundle={bundle} today="2026-02-14" planEnd="2026-03-31" currency="EUR" />,
  );
}

describe("BurndownChartPanel", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to burn-down in €, switches with the two segmented controls and persists the choice", async () => {
    renderPanel();
    await act(async () => {});
    expect(screen.getByRole("radiogroup", { name: "Chart orientation" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Chart unit" })).toBeInTheDocument();
    expect(screen.getByText("Budget remaining")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Cumulative" }));
    expect(screen.getByText("Spend, cumulative")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Hours" }));
    expect(screen.getByText("Hours, cumulative")).toBeInTheDocument();
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
      expect(stored.budgetChartView).toBe("cumulative");
      expect(stored.budgetChartUnit).toBe("hours");
    });
  });

  it("opens on a persisted device choice", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...defaultSettings, budgetChartView: "cumulative", budgetChartUnit: "hours" }));
    renderPanel();
    await act(async () => {});
    expect(screen.getByText("Hours, cumulative")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Cumulative" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Hours" })).toHaveAttribute("aria-checked", "true");
  });

  it("shows only the no-budget hint, without switches, when neither unit has a budget", async () => {
    render(
      <BurndownChartPanel lang="en-US" series={{ ...CHART_SERIES, totalBudgetValue: 0, totalBudgetHours: 0 }} bundle={null} today="2026-02-14" planEnd="2026-03-31" currency="EUR" />,
    );
    await act(async () => {});
    expect(screen.getByText("No budget configured")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("keeps the switches when only the € unit lacks a budget, so hours stay reachable", async () => {
    render(
      <BurndownChartPanel lang="en-US" series={{ ...CHART_SERIES, totalBudgetValue: 0 }} bundle={null} today="2026-02-14" planEnd="2026-03-31" currency="EUR" />,
    );
    await act(async () => {});
    expect(screen.getByText("No budget configured")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Hours" }));
    expect(screen.getByText("Hours remaining")).toBeInTheDocument();
  });

  it("renders the chart without forecast lines when no bundle is available", async () => {
    render(<BurndownChartPanel lang="en-US" series={CHART_SERIES} bundle={null} today="2026-02-14" planEnd="2026-03-31" currency="EUR" />);
    await act(async () => {});
    expect(screen.getByText("Budget remaining")).toBeInTheDocument();
    expect(screen.queryByText("At current pace")).toBeNull();
  });
});
