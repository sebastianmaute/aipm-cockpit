import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import { BurndownChartPanel, BurndownChangeTableBlock } from "./burndown-chart-panel";
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

/** jsdom has no layout, so placement is pinned by the classes that produce it. */
function ancestorWithClass(el: Element, cls: string): HTMLElement | null {
  for (let n = el.parentElement; n; n = n.parentElement) if (n.classList.contains(cls)) return n;
  return null;
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

  // Spec §5.2 / D7: the dashboard tile shows the headline only. The chart (with
  // its BAC markers) stays; the change table and its variance footer do not.
  it("renders no change table when compact (dashboard tile), while the same props non-compact do", async () => {
    const { container: normal, unmount } = render(
      <BurndownChartPanel
        lang="en-US" series={CHART_SERIES} bundle={{ ...bundle, history: HISTORY }}
        today="2026-02-14" planEnd="2026-03-31" currency="EUR"
      />,
    );
    await act(async () => {});
    expect(screen.getByRole("table", { name: /Budget changes/ })).toBeInTheDocument();
    expect(normal.querySelector("svg[role='img']")).not.toBeNull();
    unmount();

    const { container: compact } = render(
      <BurndownChartPanel
        lang="en-US" series={CHART_SERIES} bundle={{ ...bundle, history: HISTORY }}
        today="2026-02-14" planEnd="2026-03-31" currency="EUR" compact
      />,
    );
    await act(async () => {});
    expect(screen.queryByRole("table")).toBeNull();
    // The chart itself is untouched — this suppresses the table, not the tile.
    expect(compact.querySelector("svg[role='img']")).not.toBeNull();
  });

  it("renders no change table when nothing has been recorded", async () => {
    renderPanel();
    await act(async () => {});
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("keeps the table beside the chart from 2xl when not detached (every existing caller's behaviour)", async () => {
    render(
      <BurndownChartPanel
        lang="en-US" series={CHART_SERIES} bundle={{ ...bundle, history: HISTORY }}
        today="2026-02-14" planEnd="2026-03-31" currency="EUR"
      />,
    );
    await act(async () => {});
    const region = screen.getByRole("region", { name: /Budget changes/ });
    expect(ancestorWithClass(region, "2xl:w-[30rem]")).not.toBeNull();
    expect(ancestorWithClass(region, "2xl:flex-row")).not.toBeNull();
  });

  it("renders no change table when detached, while keeping the chart and both switches", async () => {
    const { container } = render(
      <BurndownChartPanel
        lang="en-US" series={CHART_SERIES} bundle={{ ...bundle, history: HISTORY }}
        today="2026-02-14" planEnd="2026-03-31" currency="EUR" detachChangeTable
      />,
    );
    await act(async () => {});
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "Chart orientation" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Chart unit" })).toBeInTheDocument();
    expect(container.querySelector("svg[role='img']")).not.toBeNull();
  });

  it("renders the chart without forecast lines when no bundle is available", async () => {
    render(<BurndownChartPanel lang="en-US" series={CHART_SERIES} bundle={null} today="2026-02-14" planEnd="2026-03-31" currency="EUR" />);
    await act(async () => {});
    expect(screen.getByText("Budget remaining")).toBeInTheDocument();
    expect(screen.queryByText("At current pace")).toBeNull();
  });
});

describe("BurndownChangeTableBlock", () => {
  beforeEach(() => localStorage.clear());

  it("renders the change table in the chart's displayed unit, and follows the panel's unit switch", async () => {
    const withHistory = { ...bundle, history: HISTORY };
    render(
      <>
        <BurndownChartPanel
          lang="en-US" series={CHART_SERIES} bundle={withHistory}
          today="2026-02-14" planEnd="2026-03-31" currency="EUR" detachChangeTable
        />
        <BurndownChangeTableBlock lang="en-US" series={CHART_SERIES} bundle={withHistory} currency="EUR" />
      </>,
    );
    await act(async () => {});
    const perf = () => within(within(screen.getByRole("table", { name: /Budget changes/ }))
      .getByRole("rowheader", { name: "Performance" }).closest("tr") as HTMLElement);
    // CHART_FORECAST: BAC 9,000, pace EAC 10,000 → performance = baseline 9,000 − 10,000.
    expect(perf().getByText("-€1,000")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Hours" }));
    // The two components are separate useSettings instances; the settings
    // listener registry carries the panel's write to the block.
    await waitFor(() => expect(perf().getByText("-10 h")).toBeInTheDocument());
  });

  it("renders nothing without a recorded change, or when neither unit has a budget — the panel's own rule", async () => {
    const { container, rerender } = render(
      <BurndownChangeTableBlock lang="en-US" series={CHART_SERIES} bundle={bundle} currency="EUR" />,
    );
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
    rerender(
      <BurndownChangeTableBlock
        lang="en-US" series={{ ...CHART_SERIES, totalBudgetValue: 0, totalBudgetHours: 0 }}
        bundle={{ ...bundle, history: HISTORY }} currency="EUR"
      />,
    );
    expect(container).toBeEmptyDOMElement();
    // Positive control: the same history with a budget does render — so the
    // two empty results above are the rule, not a broken block.
    rerender(<BurndownChangeTableBlock lang="en-US" series={CHART_SERIES} bundle={{ ...bundle, history: HISTORY }} currency="EUR" />);
    expect(screen.getByRole("table", { name: /Budget changes/ })).toBeInTheDocument();
  });
});
