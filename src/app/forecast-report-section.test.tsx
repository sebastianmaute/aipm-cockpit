// The Reports Forecast section (§502 part 4, spec §3.2). The engine runs for real (one As-is run per render input);
// the lever search is stubbed, as in `forecast-panel.levers.test.tsx`, so each test names exactly the levers a row
// shows and can read the arguments the section searched with.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ForecastReportSection, type ForecastReportProps } from "./forecast-report-section";
import { ForecastReportProposal } from "./forecast-report-proposal";
import * as compareModule from "./forecast-scenario-compare";
import * as groupModule from "./forecast-by-group";
import type { WhatItTakes } from "./forecast-levers";
import type { LeverSearchArgs } from "./use-lever-search";
import type { ForecastSettingsApi } from "./use-forecast-settings";
import type { ForecastFacts, ForecastFactsByUnit } from "./budget-forecast";
import type { ForecastScenario } from "./forecast-scenarios";
import type { ScenarioDirectory } from "./forecast-added-people";
import { DEFAULT_HISTORY_WINDOW } from "./forecast/constants";
import type { Milestone, Resource, Role, Task } from "./types";
import { rowLabel } from "./row-tokens";
import { workingDaysBefore } from "./working-days";

const stub = vi.hoisted(() => ({ values: new Map<string, unknown>(), calls: [] as unknown[] }));
vi.mock("./use-lever-search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-lever-search")>()),
  useLeverSearch: (args: unknown) => {
    stub.calls.push(args);
    return stub.values;
  },
}));

const TODAY = "2026-10-14"; // a Wednesday
const NONE: ReadonlySet<string> = new Set();
const HISTORY = [...workingDaysBefore(TODAY, 59, NONE), TODAY];
const done = (id: number, completedDate: string, assignee = ""): Task =>
  ({ id, taskName: `d${id}`, assignee, assigneeEmail: "", status: "Done", completedDate }) as Task;
const open = (id: number): Task => ({ id, taskName: `o${id}`, assignee: "", assigneeEmail: "", status: "To Do" }) as Task;
const OPEN = Array.from({ length: 12 }, (_, i) => open(1 + i));
const TASKS: Task[] = [
  ...HISTORY.map((d, i) => done(1000 + i, d, i === 0 ? "Ola Nord" : i === 1 ? "Per Sand" : "")),
  ...OPEN,
];
// About one task finishes a day. Go-live needs ten in four working days (well below 80%); Wrap-up needs its one
// task by year end (on target); Old is overdue (no chance, so no lever and no Explore). Listed best-last on purpose.
const MILESTONES: Milestone[] = [
  { id: 3, name: "Old", date: "2026-10-01", linkedTaskIds: [OPEN[10].id] },
  { id: 2, name: "Wrap-up", date: "2026-12-31", linkedTaskIds: [OPEN[11].id] },
  { id: 1, name: "Go-live", date: "2026-10-20", linkedTaskIds: OPEN.slice(0, 10).map((t) => t.id) },
];
const PLAN_END = "2026-10-23";
const ROLE: Role = { id: 1, disciplineId: 1, gradeId: 1, internalRate: 80, externalRate: 120 };
const RESOURCES: Resource[] = [
  { id: 7, firstName: "Ola", lastName: "Nord", roleId: 1, utilizationMode: "percent", utilization: {} } as Resource,
  { id: 8, firstName: "Per", lastName: "Sand", roleId: 1, utilizationMode: "percent", utilization: {} } as Resource,
];
const DIRECTORY: ScenarioDirectory = {
  resources: RESOURCES, roles: [ROLE], shifts: [], absences: [], budgets: [], fxRates: null, workdayHours: 8, baseCurrency: "EUR",
};
const FACTS: ForecastFacts = {
  bac: 2000, ac: 800, ev: null, pv: 0, bucketsMissingPercent: [],
  dated: HISTORY.map((date) => ({ date, bookedFrom: date, value: 16, spread: false })),
  planEnd: PLAN_END, today: TODAY, holidaySet: NONE, hasFixedPrice: false,
};
const BUDGET_FACTS: ForecastFactsByUnit = { eur: FACTS, hours: FACTS };

const GO_LIVE_LEVERS: WhatItTakes = {
  target: { kind: "milestone", id: 1 }, chance: 0.31, prioritised: 0.58,
  people: { state: "reaches", n: 2, chance: 0.81, hours: null }, tasks: { state: "reaches", n: 9, chance: 0.8, hours: null },
};
const SCENARIOS: ForecastScenario[] = [
  { id: 5, name: "Drop two", changes: [{ kind: "scope", tasks: -2, on: TODAY }] },
  { id: 6, name: "Slower", changes: [{ kind: "availability", percent: 50, from: TODAY, until: "" }] },
];

function input(over: Partial<compareModule.ScenarioRunInput> = {}): compareModule.ScenarioRunInput {
  return {
    tasks: TASKS, milestones: MILESTONES, today: TODAY, holidaySet: NONE, window: DEFAULT_HISTORY_WINDOW, unit: "tasks",
    planEnd: PLAN_END, directory: DIRECTORY, budgetFacts: BUDGET_FACTS, costOn: false, ...over,
  };
}
function settings(over: Partial<ForecastSettingsApi> = {}): ForecastSettingsApi {
  return { target: 80, proposalId: null, setTarget: vi.fn(), setProposal: vi.fn(), ...over };
}
function renderSection(over: Partial<ForecastReportProps> = {}) {
  const props: ForecastReportProps = {
    input: input(), scenarios: SCENARIOS, settings: settings(), history: [], currency: "EUR", readOnly: false, ...over,
  };
  return render(<ForecastReportSection lang="en-US" {...props} />);
}
const lastSearch = () => stub.calls[stub.calls.length - 1] as LeverSearchArgs;
const rowNames = () => screen.getAllByRole("rowheader").map((th) => th.getAttribute("aria-label") ?? th.textContent);

beforeEach(() => {
  stub.values = new Map<string, unknown>([["m:1", GO_LIVE_LEVERS]]);
  stub.calls = [];
});

describe("ForecastReportSection — below the history floor", () => {
  test("shows the insufficient state and starts no lever search", () => {
    // Two finished tasks: well short of the floor.
    renderSection({ input: input({ tasks: [done(1000, HISTORY[0]), done(1001, HISTORY[1]), ...OPEN] }) });
    expect(screen.getByText("Not enough history to forecast yet")).toBeTruthy();
    expect(stub.calls.length).toBeGreaterThan(0);
    expect(stub.calls.every((c) => (c as LeverSearchArgs).enabled === false)).toBe(true);
    expect(lastSearch().targets).toEqual([]);
    expect(screen.queryByTestId("forecast-report-tiles")).toBeNull();
    expect(screen.queryByTestId("forecast-verdict")).toBeNull();
  });
});

describe("ForecastReportSection — a forecast", () => {
  test("searches the plan end and every milestone with a chance, never an overdue one", () => {
    renderSection();
    expect(lastSearch().enabled).toBe(true);
    expect(lastSearch().goal).toBe(80);
    const { targets } = lastSearch();
    expect(targets[0]).toEqual({ kind: "planEnd" });
    // Overdue "Old" (id 3) has no chance, so it is never searched (Ruling A).
    expect(targets.flatMap((t) => (t.kind === "milestone" ? [t.id] : [])).sort()).toEqual([1, 2]);
  });

  test("states the verdict against the target", () => {
    renderSection();
    const banner = screen.getByTestId("forecast-verdict");
    expect(banner.textContent).toMatch(/^Below target\. Plan end .+ has a .+ chance \(target 80%\)\. 1 of 3 milestones is below target\.$/);
  });

  test("lists milestones worst first, the overdue one last", () => {
    renderSection();
    const order = [...document.querySelectorAll("[data-milestone-row]")].map((r) => r.getAttribute("data-milestone-row"));
    expect(order).toEqual(["1", "2", "3"]);
    // The row names carry the dot's meaning as text (Ruling F): colour alone says nothing to a screen reader.
    expect(rowNames()).toEqual(["Go-live, below 50%", "Wrap-up, at or above target", "Old"]);
  });

  test("an on-target row reads On target; a below-target row shows its levers; an overdue row has neither", () => {
    renderSection();
    const row = (id: number) => document.querySelector(`[data-milestone-row="${id}"]`) as HTMLElement;
    expect(within(row(2)).getByText("On target")).toBeTruthy();
    expect(within(row(1)).getByText("+2 people (team average)")).toBeTruthy();
    expect(within(row(3)).getByText("Overdue")).toBeTruthy();
    expect(within(row(3)).queryByRole("button")).toBeNull();
  });

  test("Explore asks for a draft with the row's target, its lever and the alternative", async () => {
    const onExplore = vi.fn();
    renderSection({ onExplore });
    await userEvent.click(screen.getByRole("button", { name: rowLabel("Explore in Forecast", "Go-live") }));
    expect(onExplore).toHaveBeenCalledWith({ target: { kind: "milestone", id: 1 }, kind: "people", n: 2, alt: { kind: "tasks", n: 9 } });
  });

  test("a read-only section offers no Explore and a disabled proposal select", () => {
    renderSection({ onExplore: vi.fn(), readOnly: true });
    expect(screen.queryByRole("button", { name: rowLabel("Explore in Forecast", "Go-live") })).toBeNull();
    expect((screen.getByLabelText("Proposal") as HTMLSelectElement).disabled).toBe(true);
  });

  test("the cost tile shows only with the cost simulation on", () => {
    const { unmount } = renderSection({ input: input({ costOn: true }) });
    const tiles = () => screen.getByTestId("forecast-report-tiles");
    // Positive control: with cost on, the tile is there — so its absence below is the gate, not a missing figure.
    expect(within(tiles()).getByText("Cost at finish (P80)")).toBeTruthy();
    unmount();
    renderSection({ input: input({ costOn: false }) });
    expect(within(tiles()).queryByText("Cost at finish (P80)")).toBeNull();
    expect(within(tiles()).getByText("On time")).toBeTruthy();
  });
});

describe("ForecastReportSection — the proposal", () => {
  test("the select lists None and every scenario; choosing one sets the proposal", async () => {
    const setProposal = vi.fn();
    renderSection({ settings: settings({ setProposal }) });
    const select = screen.getByLabelText("Proposal") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["None", "Drop two", "Slower"]);
    await userEvent.selectOptions(select, "Slower");
    expect(setProposal).toHaveBeenCalledWith(6);
    expect(screen.getByTestId("forecast-proposal-empty")).toBeTruthy();
  });

  test("a live proposal shows As is against it", () => {
    renderSection({ settings: settings({ proposalId: 5 }) });
    expect((screen.getByLabelText("Proposal") as HTMLSelectElement).value).toBe("5");
    const table = screen.getByTestId("forecast-proposal-table");
    expect(within(table).getByRole("rowheader", { name: "As is" })).toBeTruthy();
    expect(within(table).getByRole("rowheader", { name: "Proposal" })).toBeTruthy();
    // The one below-target milestone has its own column.
    expect(within(table).getByRole("columnheader", { name: "Go-live" })).toBeTruthy();
    expect(screen.queryByTestId("forecast-proposal-empty")).toBeNull();
  });

  test("a stale proposal id (its scenario deleted) reads as no proposal", () => {
    renderSection({ settings: settings({ proposalId: 99 }) });
    // The select SHOWS None — not a blank select pointing at an id no option carries.
    expect([...(screen.getByLabelText("Proposal") as HTMLSelectElement).selectedOptions].map((o) => o.textContent)).toEqual(["None"]);
    expect(screen.getByTestId("forecast-proposal-empty").textContent)
      .toBe("No proposal chosen. Save one in Forecast → Scenarios and pick it here.");
    expect(screen.queryByTestId("forecast-proposal-table")).toBeNull();
  });

  test("a stale proposal id runs no proposal column", () => {
    const spy = vi.spyOn(compareModule, "computeScenarioColumn");
    renderSection({ settings: settings({ proposalId: 99 }) });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    // Positive control: a live one does run it.
    const live = vi.spyOn(compareModule, "computeScenarioColumn");
    renderSection({ settings: settings({ proposalId: 5 }) });
    expect(live).toHaveBeenCalled();
    live.mockRestore();
  });

  test("the proposal block itself refuses an id naming no scenario, even when handed a column", () => {
    const column = compareModule.computeScenarioComparison(input(), []).asIs;
    render(
      <ForecastReportProposal
        lang="en-US" scenarios={SCENARIOS} proposalId={99} onChange={vi.fn()} disabled={false}
        asIs={column} proposal={column} milestones={MILESTONES} goal={80} currency="EUR"
      />,
    );
    expect(screen.getByTestId("forecast-proposal-empty")).toBeTruthy();
    expect(screen.queryByTestId("forecast-proposal-table")).toBeNull();
  });
});

describe("ForecastReportSection — Forecast by group", () => {
  test("runs the per-group forecasts only once the fold-out is opened", () => {
    const spy = vi.spyOn(groupModule, "forecastByGroup");
    renderSection();
    const fold = screen.getByTestId("forecast-by-group") as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    act(() => {
      fold.open = true;
      fold.dispatchEvent(new Event("toggle"));
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(within(fold).getByText(/Each group is forecast on its own/)).toBeTruthy();
    spy.mockRestore();
  });
});

describe("ForecastReportSection — while the holiday calendar loads", () => {
  test("shows the target control and a placeholder, and runs nothing", () => {
    renderSection({ input: null });
    expect(screen.getByRole("radiogroup", { name: "Target confidence" })).toBeTruthy();
    expect(stub.calls).toEqual([]);
  });
});
