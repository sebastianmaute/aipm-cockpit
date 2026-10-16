import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import { BurndownChartPanel, BurndownChangeTableBlock } from "./burndown-chart-panel";
import { SETTINGS_KEY } from "./use-settings";
import { defaultSettings } from "./settings-types";
import { CHART_FORECAST, CHART_FORECAST_HOURS, CHART_SERIES, CHART_SIM } from "../test/chart-fixtures";
import type { BudgetSim } from "./budget-sim";
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

describe("BurndownChartPanel — dashboard tile row", () => {
  beforeEach(() => localStorage.clear());

  it("puts the caller's controls in the switches' row", async () => {
    render(
      <BurndownChartPanel
        lang="en-US" series={CHART_SERIES} bundle={bundle} today="2026-02-14" planEnd="2026-03-31" currency="EUR"
        compact toolbarEnd={<button type="button">Extra</button>}
      />,
    );
    await act(async () => {});
    const row = screen.getByRole("radiogroup", { name: "Chart orientation" }).parentElement!;
    expect(within(row).getByRole("button", { name: "Extra" })).toBeInTheDocument();
  });

  it("puts the chart notes behind the info trigger when compact, and under the legend otherwise", async () => {
    const frameBundle = { ...bundle, eur: { ...CHART_FORECAST, facts: { ...CHART_FORECAST.facts, bac: 9_500 } } };
    const { unmount } = render(
      <BurndownChartPanel lang="en-US" series={CHART_SERIES} bundle={frameBundle} today="2026-02-14" planEnd="2026-03-31" currency="EUR" compact />,
    );
    await act(async () => {});
    expect(screen.getByRole("button", { name: (n: string) => n.startsWith("Notes on this chart") })).toBeInTheDocument();
    unmount();
    render(<BurndownChartPanel lang="en-US" series={CHART_SERIES} bundle={frameBundle} today="2026-02-14" planEnd="2026-03-31" currency="EUR" />);
    await act(async () => {});
    expect(screen.queryByRole("button", { name: (n: string) => n.startsWith("Notes on this chart") })).toBeNull();
  });

  it("keeps the caller's controls when neither unit has a budget to draw", async () => {
    const empty = { ...CHART_SERIES, totalBudgetValue: 0, totalBudgetHours: 0 };
    render(
      <BurndownChartPanel
        lang="en-US" series={empty} bundle={bundle} today="2026-02-14" planEnd="2026-03-31" currency="EUR"
        compact toolbarEnd={<button type="button">Extra</button>}
      />,
    );
    await act(async () => {});
    expect(screen.queryByRole("radiogroup", { name: "Chart orientation" })).toBeNull();
    expect(screen.getByRole("button", { name: "Extra" })).toBeInTheDocument();
  });
});

describe("BurndownChartPanel — simulated cost on the burn tile (§502)", () => {
  beforeEach(() => localStorage.clear());
  const renderTile = (sim: BudgetSim | null | undefined, compact = true) => render(
    <BurndownChartPanel
      lang="en-US" series={CHART_SERIES} bundle={{ ...bundle, sim }} today="2026-02-14" planEnd="2026-03-31" currency="EUR"
      compact={compact}
    />,
  );
  const tileLine = () => screen.queryByRole("group", { name: "Cost at finish, simulated" });

  it("shows the P80 cost at finish and the chance over budget under the chart, marked sim", async () => {
    renderTile(CHART_SIM);
    await act(async () => {});
    const line = tileLine();
    expect(line).toHaveAttribute("data-sim", "true");
    expect(line).toHaveTextContent("Cost at finish (P80) €10,200 · 70% chance over budget");
  });

  it("drops the chance half when there is no chance over budget", async () => {
    renderTile({ ...CHART_SIM, eur: { ...CHART_SIM.eur, chanceOverBudget: null } });
    await act(async () => {});
    // The value span holds the sentence alone; the badge beside it is the decorative "sim".
    expect(tileLine()?.querySelector("span.text-sm")).toHaveTextContent(/^Cost at finish \(P80\) €10,200$/);
  });

  it("reads the hours simulation in the hours unit", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...defaultSettings, budgetChartUnit: "hours" }));
    renderTile(CHART_SIM);
    await act(async () => {});
    // "Hours at finish": "Cost" beside an "h" figure misreads (§502 fix 4).
    const line = screen.getByRole("group", { name: "Hours at finish, simulated" });
    expect(line).toHaveTextContent("Hours at finish (P80) 103 h · 65% chance over budget");
    expect(tileLine()).toBeNull();
    expect(screen.queryByText(/Cost at finish/)).toBeNull();
  });

  it("shows the missing-input line instead when the cost range is unavailable", async () => {
    renderTile({ ...CHART_SIM, eur: { kind: "unavailable", reason: "spend-history", spendDays: 4, neededSpendDays: 10 } });
    await act(async () => {});
    expect(tileLine()).toBeNull();
    expect(screen.getByText("Needs 10 working days of booking history in the window (has 4).")).toBeInTheDocument();
  });

  it("shows the no-spend line when the window holds no bookings", async () => {
    renderTile({ ...CHART_SIM, eur: { kind: "unavailable", reason: "no-spend", spendDays: 60, neededSpendDays: 10 } });
    await act(async () => {});
    expect(tileLine()).toBeNull();
    expect(screen.getByText("No bookings in the history window yet.")).toBeInTheDocument();
  });

  it("shows nothing simulated when the simulation is off, and no tile line outside the tile", async () => {
    const { unmount } = renderTile(undefined);
    await act(async () => {});
    expect(tileLine()).toBeNull();
    unmount();
    renderTile(null);
    await act(async () => {});
    expect(tileLine()).toBeNull();
    expect(document.querySelector("[data-sim]")).toBeNull();
  });

  it("puts the simulated cost row in the change table, in the displayed unit, outside the tile", async () => {
    render(
      <BurndownChartPanel
        lang="en-US" series={CHART_SERIES} bundle={{ ...bundle, history: HISTORY, sim: CHART_SIM }}
        today="2026-02-14" planEnd="2026-03-31" currency="EUR"
      />,
    );
    await act(async () => {});
    expect(tileLine()).toBeNull();
    const table = screen.getByRole("table");
    expect(within(table).getByRole("group", { name: "Cost at finish (sim), simulated" })).toHaveTextContent("€9,500 – €11,000");
  });
});
