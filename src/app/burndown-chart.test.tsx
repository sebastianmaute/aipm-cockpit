import { describe, it, expect, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BurndownChart } from "./burndown-chart";
import { buildChartModel, estimatedLabelWidth, scaleDate, type ChartInput, type ChartModel } from "./burndown-geometry";
import { formatCurrency } from "./resource-cost";
import { loadI18n } from "./i18n";
import type { EvHistory } from "./budget-ev-history";
import type { BudgetHistorySummary } from "./budget-history";
import { CHART_FORECAST, CHART_FORECAST_HOURS, CHART_SERIES, CHART_SIM } from "../test/chart-fixtures";

const eur = (v: number) => formatCurrency(v, "EUR", "en-US");

const base: ChartInput = {
  series: CHART_SERIES, unit: "eur", orientation: "burndown", forecast: CHART_FORECAST,
  evHistory: null, history: null, today: "2026-02-14", planEnd: "2026-03-31",
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

// A raw ChartModel fixture for the hover-readout tests below, copied from
// `burndown-readout.test.ts`'s BASE — those tests exercise the readout's pure
// half against this exact shape, so reusing it keeps the two suites talking
// about the same stops.
const MODEL: ChartModel = {
  empty: false,
  xDomain: ["2026-01-01", "2026-03-01"],
  yDomain: [0, 100],
  total: 100,
  planned: [{ date: "2026-01-01", value: 100 }, { date: "2026-03-01", value: 0 }],
  actual: [{ date: "2026-01-01", value: 100 }, { date: "2026-02-01", value: 60 }],
  over: false,
  pace: {
    from: { date: "2026-02-01", value: 60 }, to: { date: "2026-03-01", value: 10 },
    endFigure: -10, vac: -10,
  },
  efficiency: {
    from: { date: "2026-02-01", value: 60 }, to: { date: "2026-03-01", value: 20 },
    endFigure: -5, vac: -5,
  },
  runOut: { date: "2026-02-15", value: 0 },
  ev: { date: "2026-02-01", value: 55 },
  evSegments: null,
  evJoins: [],
  evPartialNames: [],
  evUnavailable: null,
  bacSteps: null,
  bacBaseline: null,
  bacMarkers: [],
  bacLine: 100,
  today: "2026-02-01",
  planEnd: "2026-03-01",
  frameDiffers: false,
  simFinish: null,
  simCost: null,
  simCostP80: null,
};

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

  describe("earned-value legend entries follow the drawn segments (§552)", () => {
    const withSegments = (evSegments: NonNullable<ReturnType<typeof buildChartModel>["evSegments"]>) => render(
      <BurndownChart
        lang="en-US" currency="EUR" unit="eur" orientation="cumulative" periods={CHART_SERIES.periods}
        model={{ ...buildChartModel({ ...base, orientation: "cumulative", forecast: null }), evSegments }}
      />,
    );
    const seg = (partial: boolean) => ({ partial, points: [{ date: "2026-01-01", value: 0 }, { date: "2026-01-31", value: 100 }] });

    const tooltipTriggers = (container: HTMLElement) => container.querySelectorAll("[data-info-tooltip-trigger]");

    it("shows only the partial entry when every segment is partial, and keeps the explanation reachable there", () => {
      const { container } = withSegments([seg(true)]);
      expect(screen.queryByText("Earned value")).toBeNull();
      expect(screen.getByText("Partial earned value")).toBeInTheDocument();
      expect(tooltipTriggers(container)).toHaveLength(1);
    });

    it("shows neither entry for an empty segment list", () => {
      withSegments([]);
      expect(screen.queryByText("Earned value")).toBeNull();
      expect(screen.queryByText("Partial earned value")).toBeNull();
    });

    it("shows both entries for mixed segments, with one explanation", () => {
      const { container } = withSegments([seg(true), seg(false)]);
      expect(screen.getByText("Earned value")).toBeInTheDocument();
      expect(screen.getByText("Partial earned value")).toBeInTheDocument();
      expect(tooltipTriggers(container)).toHaveLength(1);
    });
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

    const twoJoins: EvHistory = {
      available: true,
      points: [
        { date: "2026-01-20", eur: 0, hours: 0, partial: [vendor, { ...vendor, id: 4, name: "Ops" }], joins: [] },
        {
          date: "2026-01-31", eur: 800, hours: 8, partial: [],
          joins: [{ id: 3, name: "Vendor", eur: 500, hours: 5 }, { id: 4, name: "Ops", eur: 300, hours: 3 }],
        },
        { date: "2026-02-14", eur: 1_000, hours: 10, partial: [], joins: [] },
      ],
    };

    it("uses the plural sentence when several buckets join at one point", () => {
      draw({ orientation: "cumulative", evHistory: twoJoins });
      expect(screen.getByText(`Vendor, Ops join (+${eur(800)})`)).toBeInTheDocument();
      draw({ unit: "hours", orientation: "cumulative", forecast: CHART_FORECAST_HOURS, evHistory: twoJoins });
      expect(screen.getByText("Vendor, Ops join (+8 h)")).toBeInTheDocument();
      expect(screen.queryByText(/Vendor, Ops joins/)).toBeNull();
    });

    it("explains both sources of the earned-value line in its tooltip", async () => {
      const { container } = draw({ orientation: "cumulative", evHistory: partialHistory() });
      fireEvent.focus(container.querySelector("[data-info-tooltip-trigger]")!);
      expect(await screen.findByRole("tooltip")).toHaveTextContent(
        "Earned value over time, from linked-task completion dates and the % complete recorded in snapshots for hand-entered buckets.",
      );
    });

    it("renders no join label for a join worth 0 in the current unit", () => {
      draw({ unit: "hours", orientation: "cumulative", forecast: CHART_FORECAST_HOURS, evHistory: partialHistory(40) });
      expect(screen.queryByText(/joins/)).toBeNull();
      // Anti-vacuity: the same history still draws its partial caption.
      expect(screen.getByText("Partial: Vendor not recorded")).toBeInTheDocument();
    });

    // §556: today's point (the last) may be partial or carry a join.
    it("dashes and captions a partial final span", () => {
      const partialToday: EvHistory = {
        available: true,
        points: [
          { date: "2026-01-31", eur: 800, hours: 8, partial: [], joins: [] },
          { date: "2026-02-14", eur: 1_000, hours: 10, partial: [vendor], joins: [] },
        ],
      };
      const { container } = draw({ orientation: "cumulative", evHistory: partialToday });
      expect(evLines(container).map((line) => line.getAttribute("stroke-dasharray"))).toEqual(["6 2 1 2", "2 4"]);
      expect(screen.getByText("Partial: Vendor not recorded")).toBeVisible();
      expect(ariaOf(container)).toContain("Earned value is partial for Vendor.");
    });

    it("labels a join on the final point", () => {
      const joinToday: EvHistory = {
        available: true,
        points: [
          { date: "2026-01-31", eur: 300, hours: 3, partial: [vendor], joins: [] },
          { date: "2026-02-14", eur: 1_000, hours: 10, partial: [], joins: [{ id: 3, name: "Vendor", eur: 500, hours: 5 }] },
        ],
      };
      draw({ orientation: "cumulative", evHistory: joinToday });
      expect(screen.getByText(`Vendor joins (+${eur(500)})`)).toBeInTheDocument();
    });

    // §553: the sign comes from `signedFigure`, never from the copy.
    it("renders a negative join amount with one minus sign and no plus", () => {
      draw({ orientation: "cumulative", evHistory: partialHistory(-500) });
      expect(screen.getByText(`Vendor joins (${eur(-500)})`)).toBeInTheDocument();
      draw({ unit: "hours", orientation: "cumulative", forecast: CHART_FORECAST_HOURS, evHistory: partialHistory(-500) });
      expect(screen.getByText("Vendor joins (-5 h)")).toBeInTheDocument();
      expect(screen.queryByText(/\+-/)).toBeNull();
      expect(eur(-500).startsWith("-")).toBe(true);
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
      expect(screen.getByText(/^Vendor kommt hinzu \(\+/)).toBeInTheDocument();
    });

    it("renders a negative German join amount with a single minus sign (§553)", async () => {
      await loadI18n("de");
      render(
        <BurndownChart
          lang="de" currency="EUR" unit="hours" orientation="cumulative" periods={CHART_SERIES.periods}
          model={buildChartModel({ ...base, unit: "hours", forecast: CHART_FORECAST_HOURS, orientation: "cumulative", evHistory: partialHistory(-500) })}
        />,
      );
      expect(screen.getByText("Vendor kommt hinzu (-5 h)")).toBeInTheDocument();
    });

    it("renders the German plural join sentence", async () => {
      await loadI18n("de");
      render(
        <BurndownChart
          lang="de" currency="EUR" unit="hours" orientation="cumulative" periods={CHART_SERIES.periods}
          model={buildChartModel({ ...base, unit: "hours", forecast: CHART_FORECAST_HOURS, orientation: "cumulative", evHistory: twoJoins })}
        />,
      );
      expect(screen.getByText("Vendor, Ops kommen hinzu (+8 h)")).toBeInTheDocument();
    });
  });

  describe("budget-at-completion steps", () => {
    const summary: BudgetHistorySummary = {
      baselineDate: "2026-01-05",
      baseline: { hours: 90, value: 9_000 },
      attributed: { hours: 22, value: 2_200 },
      changes: [
        {
          id: "a", at: "2026-01-20T09:00:00.000Z", date: "2026-01-20", kind: "updated",
          bucketId: 1, bucketName: "Vendor", deltaHours: 30, deltaValue: 3_000,
          projectBacHours: 120, projectBacValue: 12_000,
        },
        {
          id: "b", at: "2026-02-10T09:00:00.000Z", date: "2026-02-10", kind: "deleted",
          bucketId: 2, bucketName: "Ops", deltaHours: -8, deltaValue: -800,
          projectBacHours: 112, projectBacValue: 11_200,
        },
      ],
    };
    const stepped = (over: Partial<ChartInput> = {}) => draw({ orientation: "cumulative", history: summary, ...over });

    it("replaces the flat BAC line with a stepped one and draws the baseline reference", () => {
      const { container } = stepped();
      const steps = container.querySelector("polyline[data-bac-steps]");
      expect(steps).not.toBeNull();
      // Six geometry points: origin, two per change, and the run to the domain end.
      expect(steps!.getAttribute("points")!.trim().split(/\s+/)).toHaveLength(6);
      // The flat line is gone; the baseline reference took its place.
      expect(container.querySelector("line[data-bac-line]")).toBeNull();
      expect(container.querySelector("line[data-bac-baseline]")).not.toBeNull();
      expect(screen.getByText("Budget at start of recording")).toBeInTheDocument();
      // Anti-vacuity: without history the same orientation draws the flat line.
      const flat = draw({ orientation: "cumulative" });
      expect(flat.container.querySelector("line[data-bac-line]")).not.toBeNull();
      expect(flat.container.querySelector("polyline[data-bac-steps]")).toBeNull();
    });

    it("names the stepped line with its final BAC, beside the line end, so it never rides stroke weight alone", () => {
      const { container } = stepped();
      // The last recorded entry's own stored BAC, not an increment.
      const label = screen.getByText(`BAC ${eur(11_200)}`);
      expect(label.getAttribute("text-anchor")).toBe("end");
      // Beside its line end: below it (+9) by default, above it (−4) when a plotted line covers
      // the spot below (§737). Here the efficiency line ends inside the spot below, so it is above.
      const steps = container.querySelector("polyline[data-bac-steps]")!;
      const endY = Number(steps.getAttribute("points")!.trim().split(/\s+/).pop()!.split(",")[1]);
      // The polyline's points are rounded to 0.1px; the label's y is not.
      expect(Number(label.getAttribute("y"))).toBeCloseTo(endY - 4, 1);
      // It is its own element, not the baseline reference's label.
      expect(label).not.toBe(screen.getByText("Budget at start of recording"));
      // Anti-vacuity: the stepped label is absent without history, where the
      // flat line carries the same key at the chart total instead.
      const flat = draw({ orientation: "cumulative" });
      expect(flat.container.textContent).not.toContain(`BAC ${eur(11_200)}`);
      expect(flat.container.textContent).toContain(`BAC ${eur(9_000)}`);
    });

    it("labels each marker with its signed amount, its bucket and a removal wording", () => {
      stepped();
      expect(screen.getByText(`+${eur(3_000)} Vendor`)).toBeInTheDocument();
      expect(screen.getByText(`${eur(-800)} Ops removed`)).toBeInTheDocument();
    });

    it("draws the marker labels in the band above the plot, each tied to its tick by a leader", () => {
      const { container } = stepped();
      const svg = container.querySelector("svg[role='img']")!;
      // The y axis runs from the plot's top edge down; its x is the left padding.
      const axis = [...svg.querySelectorAll("line")].find((l) => l.getAttribute("x1") === l.getAttribute("x2") && l.getAttribute("x1") === "64")!;
      const plotTop = Number(axis.getAttribute("y1"));
      const labels = [...svg.querySelectorAll("text[data-bac-marker-label]")];
      expect(labels.map((l) => l.textContent)).toEqual([`+${eur(3_000)} Vendor`, `${eur(-800)} Ops removed`]);
      for (const label of labels) expect(Number(label.getAttribute("y"))).toBeLessThan(plotTop);
      expect(svg.querySelectorAll("line[data-bac-leader]")).toHaveLength(labels.length);
      // Anti-vacuity: without history there are no marker labels or leaders.
      const flat = draw({ orientation: "cumulative" }).container;
      expect(flat.querySelectorAll("text[data-bac-marker-label], line[data-bac-leader]")).toHaveLength(0);
    });

    it("haloes each marker label and paints every leader before any label", () => {
      const { container } = stepped();
      const svg = container.querySelector("svg[role='img']")!;
      const labels = [...svg.querySelectorAll("text[data-bac-marker-label]")];
      const leaders = [...svg.querySelectorAll("line[data-bac-leader]")];
      expect(labels.length).toBeGreaterThan(1);
      for (const label of labels) {
        // The stroke is drawn under the fill, in the card's surface colour.
        expect(label.getAttribute("paint-order")).toBe("stroke");
        expect(label).toHaveClass("stroke-surface");
        expect(Number(label.getAttribute("stroke-width"))).toBeGreaterThan(0);
      }
      // A later leader must not paint over an earlier label: every leader
      // precedes every label in document (paint) order.
      const lastLeader = leaders[leaders.length - 1];
      for (const label of labels) {
        expect(lastLeader.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
    });

    it("names the budget changes in the chart's accessible name", () => {
      const { container } = stepped();
      const aria = ariaOf(container);
      expect(aria).toContain("Budget changes:");
      expect(aria).toContain(`+${eur(3_000)} Vendor`);
      expect(aria).toContain(`${eur(-800)} Ops removed`);
      // Anti-vacuity: the sentence is absent when there is no recorded history.
      expect(ariaOf(draw({ orientation: "cumulative" }).container)).not.toContain("Budget changes:");
    });

    it("renders the German baseline caption and removal wording with umlauts", async () => {
      await loadI18n("de");
      render(
        <BurndownChart
          lang="de" currency="EUR" unit="hours" orientation="cumulative" periods={CHART_SERIES.periods}
          model={buildChartModel({ ...base, unit: "hours", forecast: CHART_FORECAST_HOURS, orientation: "cumulative", history: summary })}
        />,
      );
      expect(screen.getByText("Budget bei Aufzeichnungsbeginn")).toBeInTheDocument();
      expect(screen.getByText(/Ops entfernt$/)).toBeInTheDocument();
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

  describe("hover readout", () => {
    const RECT = { left: 0, top: 0, width: 640, height: 240, right: 640, bottom: 240, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

    afterEach(() => { vi.restoreAllMocks(); });

    it("is absent until the chart is hovered or focused", () => {
      render(<BurndownChart lang="en-US" currency="EUR" model={MODEL} unit="eur" orientation="cumulative" periods={["Jan", "Mar"]} />);
      // The box carries no ARIA role (`TooltipSurface`'s `decorative` prop), so a
      // role query would find nothing whether the box renders or not — that
      // would make this assertion pass vacuously. `[data-readout-box]` is the
      // box's real presence hook.
      expect(document.querySelector("[data-readout-box]")).toBeNull();
      expect(document.querySelector("[data-readout-guide]")).toBeNull();
    });

    it("shows the guide line, a dot per drawn point and the box on hover", async () => {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(RECT);
      const user = userEvent.setup();
      render(<BurndownChart lang="en-US" currency="EUR" model={MODEL} unit="eur" orientation="cumulative" periods={["Jan", "Mar"]} />);
      await user.pointer({ target: screen.getByRole("button", { name: /arrow keys/i }), coords: { clientX: 312, clientY: 100 } });
      expect(document.querySelector("[data-readout-box]")).toBeInTheDocument();
      expect(document.querySelector("[data-readout-guide]")).not.toBeNull();
      expect(document.querySelectorAll("[data-readout-dot]").length).toBeGreaterThan(0);
    });

    // Mutation checks 1 and 2 (the group half): removing `aria-hidden` from the
    // decorations group, or removing its own `print:hidden`, must each turn
    // this red. The box's own `print:hidden` lives on the PORTALED tooltip node
    // itself (`chart-readout.tsx`'s `TooltipSurface` className), not anywhere in
    // this component's own DOM, so that half is covered in
    // `chart-readout.test.tsx` instead — asserting it here would either miss
    // the portal target or pass for the wrong reason.
    it("keeps the guide line and dots out of the accessibility tree and hidden from print", async () => {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(RECT);
      const user = userEvent.setup();
      render(<BurndownChart lang="en-US" currency="EUR" model={MODEL} unit="eur" orientation="cumulative" periods={["Jan", "Mar"]} />);
      await user.pointer({ target: screen.getByRole("button", { name: /arrow keys/i }), coords: { clientX: 312, clientY: 100 } });
      const group = document.querySelector("[data-readout-guide]")!.closest("g")!;
      expect(group).toHaveAttribute("aria-hidden", "true");
      expect(group).toHaveClass("print:hidden");
    });

    it("steps with the keyboard and announces the stop politely", async () => {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(RECT);
      const user = userEvent.setup();
      render(<BurndownChart lang="en-US" currency="EUR" model={MODEL} unit="eur" orientation="cumulative" periods={["Jan", "Mar"]} />);
      await user.tab();
      await user.keyboard("{ArrowRight}");
      const live = document.querySelector("[data-readout-live]");
      expect(live).toHaveAttribute("aria-live", "polite");
      expect(live?.textContent ?? "").toContain("Planned");
    });

    it("keeps the chart's own description on the image", () => {
      render(<BurndownChart lang="en-US" currency="EUR" model={MODEL} unit="eur" orientation="cumulative" periods={["Jan", "Mar"]} />);
      expect(screen.getByRole("img").getAttribute("aria-label") ?? "").toContain("in ");
    });

    // The trigger button's own `aria-label` is its accessible NAME and is not
    // folded together with the nested image's `aria-label` — without
    // `aria-describedby` linking the two, a screen-reader user tabbing to the
    // button would never hear the chart's summary at all. Mutation: drop
    // `aria-describedby` from the button → this goes red on the id assertion.
    it("describes the trigger button with the chart's own accessible name via aria-describedby", () => {
      render(<BurndownChart lang="en-US" currency="EUR" model={MODEL} unit="eur" orientation="cumulative" periods={["Jan", "Mar"]} />);
      const button = screen.getByRole("button", { name: /arrow keys/i });
      const img = screen.getByRole("img");
      expect(button.getAttribute("aria-describedby")).toBe(img.id);
      expect(img.id).not.toBe("");
      // A distinctive substring, not the whole string — the full sentence is
      // pinned elsewhere and would make this test re-assert format, not linkage.
      expect(img.getAttribute("aria-label") ?? "").toContain("Runs out");
    });

    // §5: a budget-change marker carries a delta amount, not a chart y position,
    // so its readout row must be filtered out of the dot list. MODEL's own
    // `bacMarkers: []` never produces a "change" row, so this needs its own
    // fixture. Mutation: delete the `row.kind !== "change"` filter in
    // `burndown-chart.tsx` → the dot count goes to 6 and this goes red.
    it("draws no dot for a change row, which has no y position", async () => {
      const withChange = {
        ...MODEL,
        bacMarkers: [{ date: "2026-02-01", value: 60, amount: 500, label: "Vendor", removed: false }],
      };
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(RECT);
      const user = userEvent.setup();
      render(<BurndownChart lang="en-US" currency="EUR" model={withChange} unit="eur" orientation="cumulative" periods={["Jan", "Mar"]} />);
      await user.tab();
      // Sorted stops for this fixture: 2026-01-01, 2026-02-01, 2026-02-15,
      // 2026-03-01 — Home lands on the first, one ArrowRight on the second,
      // which is where the marker sits and where `actual`/`evPoint`/`pace`/
      // `efficiency`/`budget` (bacLine, unconditional here) all also land.
      await user.keyboard("{Home}{ArrowRight}");
      // Anti-vacuity: the box lists all six rows, the change row included —
      // only the CHART's dots must drop it.
      expect(screen.getAllByRole("listitem", { hidden: true })).toHaveLength(6);
      expect(document.querySelectorAll("[data-readout-dot]")).toHaveLength(5);
    });

    it("renders no trigger for an empty model", () => {
      render(<BurndownChart lang="en-US" currency="EUR" model={{ ...MODEL, empty: true }} unit="eur" orientation="cumulative" periods={[]} />);
      expect(screen.queryByRole("button")).toBeNull();
    });
  });
});

// §665 — seen on the seeded sample (Reports → budget history, cumulative): a join label naming a long
// chain of buckets ran leftward past the plot edge and printed over "Budget at start of recording".
describe("BurndownChart — join labels stay clear of the baseline label (§665)", () => {
  const names = "Build (fixed price), Discovery Phase (closed), Security Review (closed, rate override), Hypercare";
  const model: ChartModel = {
    ...MODEL,
    bacSteps: [{ date: "2026-01-01", value: 80 }, { date: "2026-02-15", value: 100 }],
    bacBaseline: 80,
    bacLine: null,
    evJoins: [{ date: "2026-02-20", value: 70, amount: 102_600, label: names, count: 4 }],
  };

  it("shortens the label to the room right of the baseline label, with the full text on hover", () => {
    const { container } = render(<BurndownChart lang="en-US" currency="EUR" model={model} unit="eur" orientation="cumulative" periods={["Jan", "Mar"]} />);
    const join = container.querySelector("text[data-ev-join-label]")!;
    const shown = join.lastChild!.textContent!;
    const full = join.querySelector("title")?.textContent ?? "";
    expect(full).toContain(names); // nothing is lost: the whole sentence is the hover text
    expect(shown).toContain("…");
    expect(shown.length).toBeLessThan(full.length);
    // The two labels' estimated x-ranges must not overlap. The baseline label starts at X0 + 4.
    const baseline = [...container.querySelectorAll("text")].find((el) => el.textContent === "Budget at start of recording")!;
    const baselineRight = Number(baseline.getAttribute("x")) + estimatedLabelWidth(baseline.textContent!);
    expect(join.getAttribute("text-anchor")).toBe("end");
    const joinLeft = Number(join.getAttribute("x")) - estimatedLabelWidth(shown);
    expect(joinLeft).toBeGreaterThan(baselineRight);
  });

  it("leaves a short label whole, with no hover title", () => {
    const short: ChartModel = { ...model, evJoins: [{ ...model.evJoins[0], label: "Hypercare", count: 1 }] };
    const { container } = render(<BurndownChart lang="en-US" currency="EUR" model={short} unit="eur" orientation="cumulative" periods={["Jan", "Mar"]} />);
    const join = container.querySelector("text[data-ev-join-label]")!;
    expect(join.querySelector("title")).toBeNull();
    expect(join.textContent).toContain("Hypercare");
    expect(join.textContent).not.toContain("…");
  });
});

// §737 — the labels inside the plot sat a few pixels from the line they name, so other lines ran
// through them. `MODEL` puts the "work left" label (beside the EV diamond, up and left) on the
// actual and planned lines, which both pass just left of and above the EV point.
describe("BurndownChart — label placement (§737)", () => {
  const drawModel = (model: ChartModel = MODEL) =>
    render(<BurndownChart lang="en-US" currency="EUR" model={model} unit="eur" orientation="burndown" periods={["Jan", "Mar"]} />);
  const evPoint = (svg: Element) => {
    // The diamond's path starts 5px above the EV point: "M x y-5 …".
    const d = svg.querySelector("path[class*='rag-amber']")!.getAttribute("d")!;
    const [, mx, my] = d.match(/^M ([\d.]+) ([\d.]+)/)!;
    return { x: Number(mx), y: Number(my) + 5 };
  };

  it("moves the work-left label off the lines that cross its usual spot and ties it to the EV point with a leader", () => {
    const { container } = drawModel();
    const svg = container.querySelector("svg[role='img']")!;
    const label = [...svg.querySelectorAll("text")].find((el) => el.textContent?.startsWith("work left"))!;
    const ev = evPoint(svg);
    // Its usual spot is 7px up and left of the point.
    expect(Number(label.getAttribute("y"))).not.toBe(ev.y - 7);
    const leader = svg.querySelector("line[data-label-leader]")!;
    expect(leader).not.toBeNull();
    expect(Number(leader.getAttribute("x1"))).toBeCloseTo(ev.x, 5);
    expect(Number(leader.getAttribute("y1"))).toBeCloseTo(ev.y, 5);
  });

  it("keeps the work-left label at its usual spot, with no leader, when nothing covers it", () => {
    // The same EV point with the lines that crossed its label taken away.
    const { container } = drawModel({ ...MODEL, planned: [], actual: [], pace: null, efficiency: null, runOut: null });
    const svg = container.querySelector("svg[role='img']")!;
    const label = [...svg.querySelectorAll("text")].find((el) => el.textContent?.startsWith("work left"))!;
    expect(Number(label.getAttribute("y"))).toBeCloseTo(evPoint(svg).y - 7, 5);
    expect(container.querySelector("line[data-label-leader]")).toBeNull();
  });

  it("draws each leader before the EV diamond, so the diamond covers the leader's start", () => {
    const { container } = drawModel();
    const svg = container.querySelector("svg[role='img']")!;
    const leader = svg.querySelector("line[data-label-leader]")!;
    const diamond = svg.querySelector("path[class*='rag-amber']")!;
    expect(leader.compareDocumentPosition(diamond) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(leader).toHaveClass("stroke-line");
  });

  it("haloes every label in the chart and paints every label after every plotted line", () => {
    const { container } = drawModel();
    const svg = container.querySelector("svg[role='img']")!;
    const labels = [...svg.querySelectorAll("text:not([data-axis])")];
    expect(labels.length).toBeGreaterThan(3);
    for (const label of labels) {
      expect(label.getAttribute("paint-order")).toBe("stroke");
      expect(label).toHaveClass("stroke-surface");
    }
    const lines = [...svg.querySelectorAll("polyline, line:not([data-label-leader]):not([data-readout-guide])")];
    const lastLine = lines[lines.length - 1];
    for (const label of labels) {
      expect(lastLine.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});

// The dashboard tile keeps its notes behind one info trigger beside the caption.
describe("BurndownChart — notes behind an info trigger", () => {
  const FRAME = /Chart totals differ from the forecast figures/;
  const withNotes = { ...MODEL, frameDiffers: true, evUnavailable: ["Design"] };
  const drawNotes = (model: ChartModel, notesAsInfo?: boolean) =>
    render(<BurndownChart lang="en-US" currency="EUR" model={model} unit="eur" orientation="burndown" periods={["Jan", "Mar"]} notesAsInfo={notesAsInfo} />);

  it("shows the notes as lines under the legend by default", () => {
    drawNotes(withNotes);
    expect(screen.getByText(FRAME).closest(".hidden")).toBeNull();
    expect(screen.queryByRole("button", { name: (n: string) => n.startsWith("Notes on this chart") })).toBeNull();
  });

  // The notes are only on screen in the bubble, so the trigger's name carries them, each a sentence.
  it("names the trigger with every note, each ending in a full stop", () => {
    drawNotes({ ...withNotes, evPartialNames: [{ names: "Vendor", created: false }] }, true);
    const name = screen.getByRole("button", { name: (n: string) => n.startsWith("Notes on this chart") }).getAttribute("aria-label")!;
    expect(name).toContain("Notes on this chart: Chart totals differ");
    expect(name).toContain("Partial: Vendor not recorded. No earned-value history yet for Design.");
  });

  it("puts every note behind one trigger beside the caption, and keeps them for print", () => {
    drawNotes(withNotes, true);
    // Only the print copy is in the page until the trigger opens.
    for (const el of screen.getAllByText(FRAME)) expect(el.closest(".hidden.print\\:block")).not.toBeNull();
    const trigger = screen.getByRole("button", { name: (n: string) => n.startsWith("Notes on this chart") });
    act(() => trigger.focus());
    const shown = screen.getAllByText(FRAME).filter((el) => el.closest(".hidden") === null);
    expect(shown).toHaveLength(1);
    expect(shown[0].textContent).toContain("No earned-value history yet for Design.");
  });

  it("renders no trigger when there is no note", () => {
    drawNotes(MODEL, true);
    expect(screen.queryByRole("button", { name: (n: string) => n.startsWith("Notes on this chart") })).toBeNull();
  });
});

// §502 part 3 — the simulated bands. The snapshot below was captured from the code BEFORE the bands existed
// (vitest wrote it on the first run, at aa08a3ec8), so it pins that a model built with the switch off draws
// byte-for-byte what it always drew. `useId` values depend on render order, so they are blanked.
const stableHtml = (container: HTMLElement) => container.innerHTML.replace(/_r_[0-9a-z]+_|«r[0-9a-z]+»|:r[0-9a-z]+:/g, "ID");
describe("BurndownChart — simulated bands (§502)", () => {
  it("switch off renders exactly as before", () => {
    const { container } = draw();
    expect(stableHtml(container)).toMatchInlineSnapshot(`"<div class="space-y-2"><div><div class="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">Budget remaining</div><button type="button" aria-label="Read the chart's values: press the left and right arrow keys to step through each recorded point." aria-describedby="ID" class="block w-full cursor-crosshair rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-green print:cursor-auto"><svg id="ID" viewBox="0 0 640 240" class="w-full" role="img" aria-label="Budget remaining in €. Runs out Mar 20, 2026 at current pace. Variance at plan end: -€1,000 at current pace, -€2,000 at current efficiency."><rect x="64" y="176.36363636363637" width="496" height="35.636363636363626" class="fill-ui-pink/10"></rect><line x1="64" y1="16" x2="64" y2="212" class="stroke-line" stroke-width="1"></line><line x1="64" y1="176.36363636363637" x2="560" y2="176.36363636363637" class="stroke-line" stroke-width="1"></line><text data-axis="y" x="60" y="215" text-anchor="end" class="fill-muted-foreground text-[8px] tabular-nums" aria-hidden="true">-€2,000</text><text data-axis="y" x="60" y="179.36363636363637" text-anchor="end" class="fill-muted-foreground text-[8px] tabular-nums" aria-hidden="true">€0</text><text data-axis="y" x="60" y="99.18181818181817" text-anchor="end" class="fill-muted-foreground text-[8px] tabular-nums" aria-hidden="true">€4,500</text><text data-axis="y" x="60" y="19" text-anchor="end" class="fill-muted-foreground text-[8px] tabular-nums" aria-hidden="true">€9,000</text><polyline points="64.0,16.0 231.2,69.5 387.2,122.9 560.0,176.4" fill="none" class="stroke-muted-foreground" stroke-width="2" stroke-dasharray="5 4"></polyline><polyline points="64.0,16.0 231.2,51.6 309.2,87.3" fill="none" class="stroke-ui-green" stroke-width="2.5"></polyline><line x1="309.2134831460674" y1="87.27272727272728" x2="560" y2="194.1818181818182" class="stroke-ui-dark-blue" stroke-width="2.5" stroke-dasharray="7 4"></line><line x1="309.2134831460674" y1="87.27272727272728" x2="560" y2="212" class="stroke-ui-purple" stroke-width="2.5" stroke-dasharray="2 3"></line><line x1="309.2134831460674" y1="16" x2="309.2134831460674" y2="212" class="stroke-muted-foreground" stroke-width="1" stroke-dasharray="3 3"></line><line x1="560" y1="16" x2="560" y2="212" class="stroke-line" stroke-width="1"></line><line data-label-leader="" x1="309.2134831460674" y1="80.14545454545456" x2="303.2134831460674" y2="97.14545454545456" class="stroke-line" stroke-width="0.75"></line><path d="M 309.2134831460674 75.14545454545456 l 5 5 l -5 5 l -5 -5 z" class="fill-[var(--rag-amber)]"></path><circle cx="498.69662921348316" cy="176.36363636363637" r="4" class="fill-ui-pink"></circle><text x="302.2134831460674" y="105.14545454545456" text-anchor="end" paint-order="stroke" stroke-width="3" stroke-linejoin="round" class="fill-muted-foreground stroke-surface text-[8px]" aria-hidden="true">work left €5,400</text><text x="564" y="197.1818181818182" paint-order="stroke" stroke-width="3" stroke-linejoin="round" class="fill-foreground stroke-surface text-[8px] tabular-nums" aria-hidden="true">-€1,000</text><text x="564" y="215" paint-order="stroke" stroke-width="3" stroke-linejoin="round" class="fill-foreground stroke-surface text-[8px] tabular-nums" aria-hidden="true">-€2,000</text><text x="68" y="208" paint-order="stroke" stroke-width="3" stroke-linejoin="round" class="fill-muted-foreground stroke-surface text-[8px]" aria-hidden="true">over</text><text x="64" y="232" text-anchor="start" paint-order="stroke" stroke-width="3" stroke-linejoin="round" class="fill-muted-foreground stroke-surface text-[8px] tabular-nums" aria-hidden="true">2026-01</text><text x="560" y="232" text-anchor="end" paint-order="stroke" stroke-width="3" stroke-linejoin="round" class="fill-muted-foreground stroke-surface text-[8px] tabular-nums" aria-hidden="true">2026-03</text></svg></button><span data-readout-live="" aria-live="polite" class="sr-only"></span></div><div class="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground"><span class="inline-flex items-center gap-1.5"><svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" class="stroke-muted-foreground" stroke-width="2" stroke-dasharray="5 4"></line></svg>Planned</span><span class="inline-flex items-center gap-1.5"><svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" class="stroke-ui-green" stroke-width="2.5"></line></svg>Actual</span><span class="inline-flex items-center gap-1.5"><svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" class="stroke-ui-dark-blue" stroke-width="2.5" stroke-dasharray="7 4"></line></svg>At current pace</span><span class="inline-flex items-center gap-1.5"><svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" class="stroke-ui-purple" stroke-width="2.5" stroke-dasharray="2 3"></line></svg>At current efficiency</span><span class="inline-flex items-center gap-1.5"><svg width="10" height="10" aria-hidden="true"><path d="M 5 0 l 5 5 l -5 5 l -5 -5 z" class="fill-[var(--rag-amber)]"></path></svg>Earned value (today)</span><span class="inline-flex items-center gap-1.5"><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" class="fill-ui-pink"></circle></svg>Runs out</span><span class="inline-flex items-center gap-1.5"><svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" class="stroke-muted-foreground" stroke-width="1" stroke-dasharray="3 3"></line></svg>today</span></div></div>"`);
  });

  it("renders the same with a null simulation as with none", () => {
    const html = stableHtml(draw().container);
    expect(stableHtml(draw({ sim: null }).container)).toBe(html);
  });

  it("draws the finish band, the P80 line and the cost wedge only with a simulation", () => {
    const off = draw().container;
    expect(off.querySelector("[data-sim-finish], [data-sim-p80], [data-sim-cost]")).toBeNull();
    const on = draw({ sim: CHART_SIM }).container;
    expect(on.querySelectorAll("[data-sim-finish]")).toHaveLength(1);
    expect(on.querySelectorAll("[data-sim-p80]")).toHaveLength(1);
    expect(on.querySelectorAll("[data-sim-cost]")).toHaveLength(1);
  });

  it("names the two simulated ranges in the legend, marked sim", () => {
    draw({ sim: CHART_SIM });
    expect(screen.getByText("Finish range (sim)")).toBeInTheDocument();
    expect(screen.getByText("Cost range (sim)")).toBeInTheDocument();
  });

  it("names the range as hours in the hours unit", () => {
    draw({ sim: CHART_SIM, unit: "hours" });
    expect(screen.getByText("Hours range (sim)")).toBeInTheDocument();
    expect(screen.queryByText("Cost range (sim)")).toBeNull();
  });

  it("leaves the cost entry out of the legend when no wedge is drawn", () => {
    draw({ sim: { ...CHART_SIM, eur: { ...CHART_SIM.eur, p95: "beyond" } } });
    expect(screen.getByText("Finish range (sim)")).toBeInTheDocument();
    expect(screen.queryByText("Cost range (sim)")).toBeNull();
  });

  it("adds one sentence with the P80 finish and the P80 cost to the text alternative", () => {
    const aria = ariaOf(draw({ sim: CHART_SIM }).container);
    expect(aria).toContain(`Simulated: finish (P80) Apr 10, 2026, cost at finish (P80) ${eur(10_200)}.`);
    expect(ariaOf(draw().container)).not.toContain("Simulated");
  });

  it("says hours at finish, not cost, in the hours unit (§502 fix 4)", () => {
    const aria = ariaOf(draw({ sim: CHART_SIM, unit: "hours" }).container);
    expect(aria).toContain("Simulated: finish (P80) Apr 10, 2026, hours at finish (P80) ");
    expect(aria).not.toContain("cost at finish");
  });

  it("says the P95 finish is beyond the horizon when only P95 is, so the band edge is not read as P95 = P80", () => {
    const aria = ariaOf(draw({ sim: { ...CHART_SIM, finish: { ...CHART_SIM.finish, p95: null } } }).container);
    expect(aria).toContain("The latest likely finish (P95) is beyond the horizon.");
    expect(ariaOf(draw({ sim: CHART_SIM }).container)).not.toContain("latest likely finish");
  });

  it("says the P80 finish is beyond the horizon rather than naming the clamped date", () => {
    const beyond = { kind: "sim" as const, p50: 9_500, p80: "beyond" as const, p95: "beyond" as const, chanceOverBudget: 1, spendDays: 20 };
    const aria = ariaOf(draw({ sim: { finish: { p50: "2026-03-20", p80: null, p95: null }, eur: beyond, hours: beyond } }).container);
    expect(aria).toContain("Simulated: finish (P80) beyond the horizon.");
  });

  // The cap (one plan length past plan end: 2026-06-28 here) clamps the drawing, never the words.
  it("names the real P80 and P95 dates and says they are beyond the chart when the cap clamps them", () => {
    const far = { ...CHART_SIM, finish: { p50: "2026-05-15", p80: "2028-01-10", p95: "2031-06-30" } };
    const { container } = draw({ sim: far });
    const aria = ariaOf(container);
    // The wedge is left out (its P80 date is past the chart), but the P80 cost still reaches the text.
    expect(aria).toContain(`Simulated: finish (P80) Jan 10, 2028, cost at finish (P80) ${eur(10_200)}.`);
    expect(aria).toContain("The finish (P80) is beyond the chart's end.");
    expect(aria).toContain("The latest likely finish (P95), Jun 30, 2031, is beyond the chart's end.");
    expect(aria).not.toContain("Jun 28, 2026");
    expect(container.querySelector("[data-sim-cost]")).toBeNull();
    expect(screen.queryByText("Cost range (sim)")).toBeNull();
    // Inside the cap nothing is added.
    expect(ariaOf(draw({ sim: CHART_SIM }).container)).not.toContain("beyond the chart");
  });

  // A clamped band ends at the plot's right edge, which reads as the date: a cue in words says it runs on.
  it("marks a finish the cap clamps with a visible cue at the right edge, hidden from the text alternative", async () => {
    const cue = (container: HTMLElement) => [...container.querySelectorAll("[data-sim-past-chart]")];
    const far = { ...CHART_SIM, finish: { p50: "2026-05-15", p80: "2028-01-10", p95: "2031-06-30" } };
    const [shown] = cue(draw({ sim: far }).container);
    expect(shown).toHaveTextContent("later →");
    expect(shown).toHaveAttribute("aria-hidden", "true");
    expect(shown).toHaveAttribute("text-anchor", "end");
    expect(Number(shown.getAttribute("x"))).toBeCloseTo(558);
    // P95 alone past the cap still clamps the band's end.
    expect(cue(draw({ sim: { ...CHART_SIM, finish: { ...CHART_SIM.finish, p95: "2029-01-01" } } }).container)).toHaveLength(1);
    // Inside the cap, and with the switch off, there is none.
    expect(cue(draw({ sim: CHART_SIM }).container)).toHaveLength(0);
    expect(cue(draw().container)).toHaveLength(0);
    await loadI18n("de");
    const de = render(
      <BurndownChart lang="de" currency="EUR" model={buildChartModel({ ...base, sim: far })} unit="eur" orientation="burndown" periods={base.series.periods} />,
    );
    expect(cue(de.container)[0]).toHaveTextContent("später →");
  });

  // The x domain runs on to the simulated P95 (2026-05-01) while the segments end at plan end (2026-03-31),
  // which is also the plan's last period end: the labels must follow what they mark, not the plot's right
  // edge (X1 = 560).
  const labelX = (container: HTMLElement, text: string) => {
    const found = [...container.querySelectorAll("svg[role='img'] text:not([data-axis])")].filter((el) => el.textContent === text);
    expect(found).toHaveLength(1);
    return Number(found[0].getAttribute("x"));
  };
  const planEndX = scaleDate("2026-03-31", ["2026-01-01", "2026-05-01"], 64, 560);

  it("anchors the end figures at the segments' end, plan end, when the x domain runs on to the simulated finish", () => {
    const { container } = draw({ sim: CHART_SIM });
    expect(labelX(container, eur(-1_000))).toBeCloseTo(planEndX + 4);
    expect(labelX(container, eur(-2_000))).toBeCloseTo(planEndX + 4);
  });

  it("puts the last period label at that period's end, not at the stretched right edge", () => {
    const { container } = draw({ sim: CHART_SIM });
    expect(labelX(container, "2026-03")).toBeCloseTo(planEndX);
  });

  it("keeps both labels at the right edge with the switch off", () => {
    const { container } = draw();
    expect(labelX(container, eur(-1_000))).toBe(564);
    expect(labelX(container, "2026-03")).toBe(560);
  });
});
