import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BurndownChart } from "./burndown-chart";
import { buildChartModel, type ChartInput } from "./burndown-geometry";
import { formatCurrency } from "./resource-cost";
import { loadI18n } from "./i18n";
import type { EvHistory } from "./budget-ev-history";
import { CHART_FORECAST, CHART_FORECAST_HOURS, CHART_SERIES } from "../test/chart-fixtures";

const eur = (v: number) => formatCurrency(v, "EUR", "en-US");

const base: ChartInput = {
  series: CHART_SERIES, unit: "eur", orientation: "burndown", forecast: CHART_FORECAST,
  evHistory: null, today: "2026-02-14", planEnd: "2026-03-31",
};
function draw(over: Partial<ChartInput> = {}) {
  const input = { ...base, ...over };
  return render(
    <BurndownChart
      lang="en-US" currency="EUR" model={buildChartModel(input)}
      unit={input.unit} orientation={input.orientation} periods={input.series.periods}
    />,
  );
}
const ariaOf = (container: HTMLElement) =>
  container.querySelector("svg[role='img']")?.getAttribute("aria-label") ?? "";

describe("BurndownChart", () => {
  it.each([
    ["eur", "burndown", "Budget remaining"], ["hours", "burndown", "Hours remaining"],
    ["eur", "cumulative", "Spend, cumulative"], ["hours", "cumulative", "Hours, cumulative"],
  ] as const)("captions %s × %s as %s", (unit, orientation, caption) => {
    draw({ unit, orientation, forecast: unit === "eur" ? CHART_FORECAST : CHART_FORECAST_HOURS });
    expect(screen.getByText(caption)).toBeInTheDocument();
  });

  it("renders one chart svg whose name summarises orientation, unit, run-out and plan-end VAC", () => {
    const { container } = draw();
    expect(container.querySelectorAll("svg[role='img']")).toHaveLength(1);
    const aria = ariaOf(container);
    expect(aria).toContain("Budget remaining in €.");
    expect(aria).toContain("Runs out Mar 20, 2026 at current pace.");
    expect(aria).toContain(`Variance at plan end: ${eur(-1_000)} at current pace, ${eur(-2_000)} at current efficiency.`);
  });

  it("names the VAC, not the EAC, in the cumulative orientation's svg name", () => {
    // CHART_FORECAST: pace EAC 10,000 / VAC −1,000; efficiency EAC 11,000 / VAC −2,000.
    // The cumulative segments' `endFigure` is the EAC; the name must still carry the VAC.
    const { container } = draw({ orientation: "cumulative" });
    const aria = ariaOf(container);
    expect(aria).toContain("Spend, cumulative in €.");
    expect(aria).toContain(`Variance at plan end: ${eur(-1_000)} at current pace, ${eur(-2_000)} at current efficiency.`);
    expect(aria).not.toContain(eur(10_000));
    expect(aria).not.toContain(eur(11_000));
  });

  it("names the forecast card's VAC, not a chart-frame figure, when the chart total differs from BAC", () => {
    // BAC 9,500 against a 9,000 chart total (frameDiffers). EACs stay 10,000 / 11,000, so the
    // card VACs are BAC − EAC = −500 / −1,500, while a chart-frame recomputation
    // (total − EAC) would give −1,000 / −2,000.
    const forecast = {
      ...CHART_FORECAST,
      facts: { ...CHART_FORECAST.facts, bac: 9_500 },
      pace: { ...CHART_FORECAST.pace, vac: -500 },
      efficiency: { ...CHART_FORECAST.efficiency, vac: -1_500 },
    };
    const { container } = draw({ orientation: "cumulative", forecast });
    const aria = ariaOf(container);
    expect(screen.getByText(/Chart totals differ from the forecast figures/)).toBeInTheDocument();
    expect(aria).toContain(`Variance at plan end: ${eur(-500)} at current pace, ${eur(-1_500)} at current efficiency.`);
    // Chart-frame figures (total 9,000 − EAC 10,000 / 11,000) must not be named.
    expect(aria).not.toContain(eur(-1_000));
    expect(aria).not.toContain(eur(-2_000));
  });

  it("names only the pace VAC when the efficiency forecast is unavailable", () => {
    const { container } = draw({ forecast: { ...CHART_FORECAST, efficiency: { unavailable: "no-earned-value" } } });
    expect(ariaOf(container)).toContain(`Variance at plan end: ${eur(-1_000)} at current pace.`);
    expect(screen.queryByText("At current efficiency")).toBeNull();
  });

  it("names only the efficiency VAC when the pace forecast is unavailable", () => {
    // The two availability predicates are independent, so this state is real —
    // before the third branch existed the name carried no end figure at all.
    const { container } = draw({
      forecast: {
        ...CHART_FORECAST,
        pace: { unavailable: "no-burn", windowStart: "2026-01-19", windowEnd: "2026-02-13", lastBookingDate: null },
      },
    });
    const aria = ariaOf(container);
    expect(aria).toContain(`Variance at plan end: ${eur(-2_000)} at current efficiency.`);
    expect(aria).not.toContain("at current pace");
  });

  it("labels the y axis below zero and the first and last period", () => {
    const { container } = draw();
    // yDomain [−2,000 (efficiency end), 9,000] → ticks −2,000 · 0 · 4,500 · 9,000.
    expect(container.querySelectorAll("svg[role='img'] text[data-axis='y']")).toHaveLength(4);
    expect(screen.getAllByText("2026-01").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2026-03").length).toBeGreaterThan(0);
  });

  it("draws the actual line pink when over budget, green otherwise", () => {
    expect(draw().container.querySelectorAll("polyline.stroke-ui-green")).toHaveLength(1);
    const over = draw({ series: { ...CHART_SERIES, actualRemainingValue: [7_000, -500, null] } });
    expect(over.container.querySelectorAll("polyline.stroke-ui-pink")).toHaveLength(1);
  });

  it("lists only drawn series in the legend", () => {
    draw({ forecast: null });
    expect(screen.queryByText("At current pace")).toBeNull();
    expect(screen.getByText("Planned")).toBeInTheDocument();
  });

  it("renders an overdue project cleanly: no forecast legend entries and no plan-end figures in its name", () => {
    // Plan end before the last actual point → the model drops pace, efficiency and run-out.
    const { container } = draw({ planEnd: "2026-01-31" });
    expect(container.querySelectorAll("svg[role='img']")).toHaveLength(1);
    expect(container.querySelectorAll("polyline.stroke-ui-green")).toHaveLength(1);
    expect(screen.queryByText("At current pace")).toBeNull();
    expect(screen.queryByText("At current efficiency")).toBeNull();
    expect(screen.queryByText("Runs out")).toBeNull();
    const aria = ariaOf(container);
    expect(aria).toBe("Budget remaining in €.");
  });

  it("draws the earned-value history line in the cumulative orientation only", () => {
    const evHistory = { available: true as const, points: [{ date: "2026-01-31", eur: 2_000, hours: 20, partial: [], joins: [] }] };
    draw({ orientation: "cumulative", evHistory });
    expect(screen.getByText("Earned value")).toBeInTheDocument();
    draw({ orientation: "burndown", evHistory });
    expect(screen.getAllByText("Earned value")).toHaveLength(1);
  });

  it("shows the frame note and the no-history note when they apply", () => {
    draw({ forecast: { ...CHART_FORECAST, facts: { ...CHART_FORECAST.facts, bac: 9_500 } } });
    expect(screen.getByText(/Chart totals differ from the forecast figures/)).toBeInTheDocument();
    draw({ orientation: "cumulative", evHistory: { available: false, reason: "no-earned-value", buckets: [{ id: 2, name: "Design" }] } });
    expect(screen.getByText("No earned-value history yet for Design.")).toBeInTheDocument();
  });

  describe("partial earned value and joins", () => {
    const vendor = { id: 3, name: "Vendor", createdDate: null, startDate: "2026-01-01" };
    const partialHistory = (joinEur = 500): EvHistory => ({
      available: true,
      points: [
        { date: "2026-01-20", eur: 0, hours: 0, partial: [vendor], joins: [] },
        { date: "2026-01-31", eur: 800, hours: 8, partial: [], joins: [{ id: 3, name: "Vendor", eur: joinEur, hours: joinEur / 100 }] },
        { date: "2026-02-14", eur: 1_000, hours: 10, partial: [], joins: [] },
      ],
    });
    const evLines = (container: HTMLElement) => [...container.querySelectorAll("svg[role='img'] polyline.stroke-\\[var\\(--rag-amber\\)\\]")];

    it("dashes a partial span differently from the solid history, and captions it", () => {
      const { container } = draw({ orientation: "cumulative", evHistory: partialHistory() });
      const dashes = evLines(container).map((line) => line.getAttribute("stroke-dasharray"));
      expect(dashes).toEqual(["2 4", "6 2 1 2"]);
      expect(screen.getByText("Partial: Vendor not recorded")).toBeVisible();
      expect(screen.getByText("Partial earned value")).toBeInTheDocument();
    });

    it("says 'created later' when the bucket was created after its start", () => {
      const created = { ...vendor, createdDate: "2026-01-25" };
      const history = partialHistory();
      if (!history.available) throw new Error("fixture");
      draw({ orientation: "cumulative", evHistory: { ...history, points: [{ ...history.points[0], partial: [created] }, ...history.points.slice(1)] } });
      expect(screen.getByText("Partial: Vendor created later")).toBeInTheDocument();
    });

    it("labels the join with its amount in the current unit", () => {
      draw({ orientation: "cumulative", evHistory: partialHistory() });
      expect(screen.getByText(`Vendor joins (+${eur(500)})`)).toBeInTheDocument();
      draw({ unit: "hours", orientation: "cumulative", forecast: CHART_FORECAST_HOURS, evHistory: partialHistory() });
      expect(screen.getByText("Vendor joins (+5 h)")).toBeInTheDocument();
    });

    it("renders no join label for a join worth 0 in the current unit", () => {
      draw({ unit: "hours", orientation: "cumulative", forecast: CHART_FORECAST_HOURS, evHistory: partialHistory(40) });
      expect(screen.queryByText(/joins/)).toBeNull();
      // Anti-vacuity: the same history still draws its partial caption.
      expect(screen.getByText("Partial: Vendor not recorded")).toBeInTheDocument();
    });

    it("names the partial buckets in the chart's accessible name", () => {
      const { container } = draw({ orientation: "cumulative", evHistory: partialHistory() });
      expect(ariaOf(container)).toContain("Earned value is partial for Vendor.");
      const complete = draw({ orientation: "cumulative", evHistory: { available: true, points: [{ date: "2026-01-31", eur: 800, hours: 8, partial: [], joins: [] }] } });
      expect(ariaOf(complete.container)).not.toContain("partial");
    });

    it("says each partial sentence once when two spans name the same bucket", () => {
      const history: EvHistory = {
        available: true,
        points: [
          { date: "2026-01-10", eur: 0, hours: 0, partial: [vendor], joins: [] },
          { date: "2026-01-20", eur: 100, hours: 1, partial: [], joins: [] },
          { date: "2026-01-31", eur: 100, hours: 1, partial: [vendor], joins: [] },
          { date: "2026-02-14", eur: 1_000, hours: 10, partial: [], joins: [] },
        ],
      };
      const { container } = draw({ orientation: "cumulative", evHistory: history });
      // Anti-vacuity: the model really has two partial spans.
      expect(evLines(container).filter((line) => line.getAttribute("stroke-dasharray") === "2 4")).toHaveLength(2);
      expect(screen.getAllByText("Partial: Vendor not recorded")).toHaveLength(1);
      expect(ariaOf(container).split("Earned value is partial for Vendor.")).toHaveLength(2);
    });

    it("renders the German caption with umlauts", async () => {
      await loadI18n("de");
      render(
        <BurndownChart
          lang="de" currency="EUR" unit="eur" orientation="cumulative" periods={CHART_SERIES.periods}
          model={buildChartModel({ ...base, orientation: "cumulative", evHistory: partialHistory() })}
        />,
      );
      expect(screen.getByText("Unvollständig: Vendor nicht erfasst")).toBeInTheDocument();
      expect(screen.getByText("Unvollständiger Earned Value")).toBeInTheDocument();
    });
  });

  it("keeps the two end labels at least 10px apart when both forecasts end at the same value", () => {
    // Equal ETCs put both segment ends on one y (at the plot bottom here); the
    // two end labels must neither overlap nor leave the plot.
    const forecast = {
      ...CHART_FORECAST,
      pace: { ...CHART_FORECAST.pace, vac: -1_200 },
      efficiency: { ...CHART_FORECAST.efficiency, etc: 6_000, vac: -1_500 },
    };
    const { container } = draw({ forecast });
    const labels = [...container.querySelectorAll("svg[role='img'] text:not([data-axis])")];
    const yOf = (text: string) => Number(labels.find((el) => el.textContent === text)!.getAttribute("y"));
    const paceY = yOf(eur(-1_200));
    const efficiencyY = yOf(eur(-1_500));
    expect(Math.abs(paceY - efficiencyY)).toBeGreaterThanOrEqual(10);
    // Plot bottom: H 240 − PAD_B 28.
    expect(Math.max(paceY, efficiencyY)).toBeLessThanOrEqual(212);
  });

  it("shows the no-budget hint for an empty chart", () => {
    draw({ series: { ...CHART_SERIES, totalBudgetValue: 0 } });
    expect(screen.getByText("No budget configured")).toBeInTheDocument();
  });
});
