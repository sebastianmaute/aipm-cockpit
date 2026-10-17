import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ScenarioComparisonTable, ScenarioMilestoneTable, type ComparedColumn } from "./forecast-scenario-tables";
import type { ScenarioColumn } from "./forecast-scenario-compare";
import type { ScenarioSchedule } from "./forecast-scenario-schedule";
import type { ScheduleForecastResult } from "./forecast";
import type { MilestoneChance } from "./forecast/milestones";
import type { CostAtFinish } from "./forecast/cost";
import type { Milestone } from "./types";

const EN = "en-US" as const;

function forecast(milestones: MilestoneChance[] = []): ScheduleForecastResult {
  return {
    kind: "forecast",
    when: [{ p: 50, date: "2027-01-28" }, { p: 80, date: "2027-02-12" }, { p: 95, date: null }],
    milestones,
  } as unknown as ScheduleForecastResult;
}
const SIM_COST: CostAtFinish = { kind: "sim", p50: 90_000, p80: 100_000, p95: 120_000, chanceOverBudget: 0.3, spendDays: 60 };

function column(over: Partial<ScenarioColumn> = {}): ScenarioColumn {
  return { forecast: forecast(), chanceOnTime: 0.42, cost: null, schedule: null, ...over };
}
function schedule(rows: ScenarioSchedule["rows"], addedShareAtFullSpeed = 0): ScenarioSchedule {
  return { rows, addedShareAtFullSpeed } as unknown as ScenarioSchedule;
}
const asIs = (over: Partial<ScenarioColumn> = {}): ComparedColumn => ({ key: "as-is", name: "As is", column: column(over) });
const planB = (over: Partial<ScenarioColumn> = {}): ComparedColumn => ({ key: "7", name: "Plan B", column: column({ schedule: schedule([]), ...over }) });

describe("ScenarioComparisonTable", () => {
  it("every figure is a SimValue named by row and column", () => {
    const { container } = render(
      <ScenarioComparisonTable lang={EN} columns={[asIs({ cost: SIM_COST }), planB({ cost: SIM_COST })]} currency="EUR" />,
    );
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["As is", "Plan B"]);
    const rows = ["Even odds (P50)", "Safe to commit (P80)", "Cautious (P95)", "On time by plan end", "Cost at finish (P80)", "Chance over budget"];
    for (const row of rows) {
      for (const col of ["As is", "Plan B"]) {
        expect(screen.getByRole("group", { name: `${row}, ${col}, simulated` })).toBeInTheDocument();
      }
    }
    // Every figure cell, and nothing else, wears the sim marking.
    expect(container.querySelectorAll("[data-sim]")).toHaveLength(rows.length * 2);
    expect(within(screen.getByRole("group", { name: "Cautious (P95), Plan B, simulated" })).getByText("> 5 y")).toBeInTheDocument();
  });

  it("the P95 row reads Cautious (P95)", () => {
    render(<ScenarioComparisonTable lang={EN} columns={[asIs()]} currency="EUR" />);
    expect(screen.getAllByRole("rowheader").map((h) => h.textContent)).toEqual([
      "Even odds (P50)", "Safe to commit (P80)", "Cautious (P95)", "On time by plan end",
    ]);
  });

  it("cost rows only with a cost", () => {
    const { unmount } = render(<ScenarioComparisonTable lang={EN} columns={[asIs(), planB()]} currency="EUR" />);
    expect(screen.queryByRole("rowheader", { name: "Cost at finish (P80)" })).toBeNull();
    expect(screen.queryByRole("rowheader", { name: "Chance over budget" })).toBeNull();
    unmount();
    render(<ScenarioComparisonTable lang={EN} columns={[asIs({ cost: SIM_COST }), planB({ cost: SIM_COST })]} currency="EUR" />);
    expect(screen.getByRole("rowheader", { name: "Cost at finish (P80)" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Chance over budget" })).toBeInTheDocument();
  });

  it("an unavailable cost reads the missing-input line", () => {
    const cost: CostAtFinish = { kind: "unavailable", reason: "spend-history", spendDays: 4, neededSpendDays: 10 };
    render(<ScenarioComparisonTable lang={EN} columns={[asIs({ cost }), planB({ cost })]} currency="EUR" />);
    const lines = screen.getAllByText("Needs 10 working days of booking history in the window (has 4).");
    // One line per column, spanning both cost rows.
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.closest("td")).toHaveAttribute("rowspan", "2");
    expect(screen.getByRole("rowheader", { name: "Chance over budget" })).toBeInTheDocument();
  });

  it("each inert reason shows once under its column's header", () => {
    const gone = { kind: "addPeople" as const, status: { kind: "inert" as const, reason: "person-gone" as const } };
    const hours = { kind: "addPeople" as const, status: { kind: "inert" as const, reason: "needs-booked-hours" as const } };
    const { container } = render(
      <ScenarioComparisonTable lang={EN} columns={[asIs(), planB({ schedule: schedule([gone, gone, hours], 1.4) })]} currency="EUR" />,
    );
    const notes = container.querySelector<HTMLElement>('[data-column-notes="7"]');
    if (!notes) throw new Error("no notes cell for the scenario");
    expect(within(notes).getAllByText("An added person is no longer in the directory.")).toHaveLength(1);
    expect(within(notes).getAllByText("Needs booked hours to size added people.")).toHaveLength(1);
    expect(within(notes).getByText(/more than double the team/)).toBeInTheDocument();
    expect(container.querySelector('[data-column-notes="as-is"]')?.textContent).toBe("");
    // Under the header: in the table head, not among the figures.
    expect(notes.closest("thead")).not.toBeNull();
  });

  it("names a no-rate person below the table, once", () => {
    const sized = {
      kind: "addPeople" as const,
      status: { kind: "sized" as const, name: "Kim", weeklyHours: 40, ratePerHour: 0, rateNote: "no-rate" as const, shareAtFullSpeed: 0.2 },
    };
    render(<ScenarioComparisonTable lang={EN} columns={[asIs({ cost: SIM_COST }), planB({ cost: SIM_COST, schedule: schedule([sized, sized]) })]} currency="EUR" />);
    expect(screen.getAllByText("Plan B: no rate for Kim, so their cost counts as 0.")).toHaveLength(1);
  });

  it("an insufficient scenario column is one line", () => {
    const insufficient = { kind: "insufficient" } as unknown as ScheduleForecastResult;
    render(<ScenarioComparisonTable lang={EN} columns={[asIs(), planB({ forecast: insufficient, chanceOnTime: null })]} currency="EUR" />);
    expect(screen.getByText("Not enough history for this scenario.").closest("td")).toHaveAttribute("rowspan", "4");
  });
});

describe("ScenarioMilestoneTable", () => {
  const ms = (id: number, name: string, date: string) => ({ id, name, date }) as Milestone;
  const MILESTONES = [ms(1, "Alpha", "2027-01-10"), ms(2, "Beta", "2026-12-01"), ms(3, "Gamma", "2027-02-01"), ms(4, "Delta", "2026-11-15")];

  it("milestones sort by the As-is chance, worst first, states last", () => {
    const chances: MilestoneChance[] = [
      { id: 1, state: "chance", chance: 0.9, chancePrioritised: 0.95 },
      { id: 2, state: "overdue" },
      { id: 3, state: "chance", chance: 0.2, chancePrioritised: 0.3 },
      { id: 4, state: "no-linked-tasks" },
    ];
    const better: MilestoneChance[] = chances.map((c) => (c.state === "chance" ? { ...c, chance: 0.999 } : c));
    render(
      <ScenarioMilestoneTable lang={EN} milestones={MILESTONES} columns={[asIs({ forecast: forecast(chances) }), planB({ forecast: forecast(better) })]} />,
    );
    expect(screen.getAllByRole("rowheader").map((h) => h.textContent)).toEqual(["Gamma", "Alpha", "Delta", "Beta"]);
    expect(screen.getByRole("group", { name: "Gamma, As is, simulated" })).toHaveTextContent("20%");
    expect(screen.getByRole("group", { name: "Gamma, Plan B, simulated" })).toHaveTextContent("≥ 99%");
    // A state reads as text, never as a simulated figure.
    expect(screen.getAllByText("Overdue")).toHaveLength(2);
    expect(screen.queryByRole("group", { name: /^Beta,/ })).toBeNull();
  });
});
