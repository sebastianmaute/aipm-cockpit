import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import { BurndownChartPanel } from "./burndown-chart-panel";
import { SETTINGS_KEY } from "./use-settings";
import { defaultSettings } from "./settings-types";
import { CHART_FORECAST, CHART_FORECAST_HOURS, CHART_SERIES } from "../test/chart-fixtures";
import type { BudgetHistorySummary } from "./budget-history";

const bundle = { eur: CHART_FORECAST, hours: CHART_FORECAST_HOURS, evHistory: { available: true as const, points: [] }, history: null };

const HISTORY: BudgetHistorySummary = {
  baselineDate: "2026-01-05",
  baseline: { hours: 90, value: 9_000 },
  attributed: { hours: 30, value: 3_000 },
  changes: [{
    id: "a", at: "2026-01-20T09:00:00.000Z", date: "2026-01-20", kind: "updated",
    bucketId: 1, bucketName: "Vendor", deltaHours: 30, deltaValue: 3_000,
    projectBacHours: 120, projectBacValue: 12_000,
  }],
};

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

  it("renders the change table beside the chart, with the pace split in the displayed unit", async () => {
    render(
      <BurndownChartPanel
        lang="en-US" series={CHART_SERIES} bundle={{ ...bundle, history: HISTORY }}
        today="2026-02-14" planEnd="2026-03-31" currency="EUR"
      />,
    );
    await act(async () => {});
    // Scoped to the table: the chart's own end label carries the same figure.
    const perf = () => within(within(screen.getByRole("table", { name: /Budget changes/ }))
      .getByRole("rowheader", { name: "Performance" }).closest("tr") as HTMLElement);
    // CHART_FORECAST: BAC 9,000, pace EAC 10,000 → performance = baseline 9,000 − 10,000.
    expect(perf().getByText("-€1,000")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Hours" }));
    // CHART_FORECAST_HOURS: BAC 90, pace EAC 100 → performance = baseline 90 − 100.
    expect(perf().getByText("-10 h")).toBeInTheDocument();
  });

  it("stacks the chart and table even at desktop width when compact (dashboard tile), never side-by-side", async () => {
    const { container: normal } = render(
      <BurndownChartPanel
        lang="en-US" series={CHART_SERIES} bundle={{ ...bundle, history: HISTORY }}
        today="2026-02-14" planEnd="2026-03-31" currency="EUR"
      />,
    );
    await act(async () => {});
    const normalRow = normal.querySelector(".flex.flex-col.gap-3");
    expect(normalRow?.className).toContain("md:flex-row");
    expect(normal.querySelector(".md\\:w-80")).not.toBeNull();

    const { container: compact } = render(
      <BurndownChartPanel
        lang="en-US" series={CHART_SERIES} bundle={{ ...bundle, history: HISTORY }}
        today="2026-02-14" planEnd="2026-03-31" currency="EUR" compact
      />,
    );
    await act(async () => {});
    const compactRow = compact.querySelector(".flex.flex-col.gap-3");
    expect(compactRow?.className).not.toContain("md:flex-row");
    expect(compact.querySelector(".md\\:w-80")).toBeNull();
  });

  it("renders no change table when nothing has been recorded", async () => {
    renderPanel();
    await act(async () => {});
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders the chart without forecast lines when no bundle is available", async () => {
    render(<BurndownChartPanel lang="en-US" series={CHART_SERIES} bundle={null} today="2026-02-14" planEnd="2026-03-31" currency="EUR" />);
    await act(async () => {});
    expect(screen.getByText("Budget remaining")).toBeInTheDocument();
    expect(screen.queryByText("At current pace")).toBeNull();
  });
});
