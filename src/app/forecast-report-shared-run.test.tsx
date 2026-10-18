// §502 spec §4 — the Reports view runs the 10,000-trial schedule ONCE per input change. `useAppForecast` (the
// embedded Budget report's run, as workspace-section calls it on this tab) and the Forecast section's As-is share
// `computeAppForecast`'s memo: the section hands `computeAppScheduleRun`'s result to `computeScenarioComparison`
// instead of running As is again. The lever search is stubbed in the first test; the second and third run it for real
// and drain its timers, so its prepare step's As-is is counted too (P-T5-1: it takes the shared run, `sharedAsIsRun`).
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useMemo } from "react";
import type { ScenarioRunInput } from "./forecast-scenario-compare";
import type { ScenarioDirectory } from "./forecast-added-people";
import { DEFAULT_HISTORY_WINDOW } from "./forecast/constants";
import type { Milestone, ResourcePlan, Task } from "./types";
import { workingDaysBefore } from "./working-days";

// Call-through spy: the engine runs for real, the spy only counts.
const fc = vi.hoisted(() => ({ engine: vi.fn(), realLevers: false }));
vi.mock("./forecast/index", async (orig) => {
  const real = await orig<typeof import("./forecast/index")>();
  fc.engine.mockImplementation(real.computeScheduleForecast as never);
  return { ...real, computeScheduleForecast: fc.engine };
});
vi.mock("./use-lever-search", async (orig) => {
  const real = await orig<typeof import("./use-lever-search")>();
  return { ...real, useLeverSearch: (args: Parameters<typeof real.useLeverSearch>[0]) => (fc.realLevers ? real.useLeverSearch(args) : new Map()) };
});

import { useAppForecast } from "./use-app-forecast";
import { ForecastReportSection } from "./forecast-report-section";
import { ForecastPanel } from "./forecast-panel";
import { WorkspaceTabProvider } from "./workspace-tab-context";

/** The engine calls that are an As-is run (no scenario changes); a lever probe always carries its changes. */
const asIsCalls = () => fc.engine.mock.calls.filter(([args]) => !("changes" in (args as object))).length;
/** Every lever search runs to the end: prepare first, then one probe per macrotask. */
async function drainLeverSearch() {
  for (let i = 0; i < 200 && vi.getTimerCount() > 0; i++) await act(async () => { vi.runOnlyPendingTimers(); });
  expect(vi.getTimerCount()).toBe(0);
}
afterEach(() => { fc.realLevers = false; vi.useRealTimers(); });

const TODAY = "2026-10-14";
const NONE: ReadonlySet<string> = new Set();
const HISTORY = [...workingDaysBefore(TODAY, 59, NONE), TODAY];
const PLAN_END = "2026-12-31";
const MILESTONES: Milestone[] = [{ id: 1, name: "Go-live", date: "2026-11-20", linkedTaskIds: [1, 2] }];
const DIRECTORY: ScenarioDirectory = {
  resources: [], roles: [], shifts: [], absences: [], budgets: [], fxRates: null, workdayHours: 8, baseCurrency: "EUR",
};
const SETTINGS = { target: 80 as const, proposalId: null, setTarget: vi.fn(), setProposal: vi.fn() };

/** A fresh task list each call: the app memo is module-wide, so a reused list would hit an earlier test's entry. */
function tasks(open: number): Task[] {
  return [
    ...HISTORY.map((d, i) => ({ id: 1000 + i, taskName: `d${i}`, assignee: "", assigneeEmail: "", status: "Done", completedDate: d }) as Task),
    ...Array.from({ length: open }, (_, i) => ({ id: 1 + i, taskName: `o${i}`, assignee: "", assigneeEmail: "", status: "To Do" }) as Task),
  ];
}

/** Reports as workspace-section wires it: `useAppForecast` on the tab, then the section with the SAME references. */
function ReportsTab({ list }: { list: readonly Task[] }) {
  useAppForecast({ tasks: list, milestones: MILESTONES, planEnd: PLAN_END, today: TODAY, holidaySet: NONE, active: true });
  const input = useMemo<ScenarioRunInput>(() => ({
    tasks: list, milestones: MILESTONES, today: TODAY, holidaySet: NONE, window: DEFAULT_HISTORY_WINDOW, unit: "tasks",
    planEnd: PLAN_END, directory: DIRECTORY, budgetFacts: null, costOn: false,
  }), [list]);
  return <ForecastReportSection lang="en-US" input={input} scenarios={[]} settings={SETTINGS} history={[]} currency="EUR" readOnly={false} />;
}

describe("Reports — one schedule run per input change (§502 spec §4)", () => {
  test("the app run and the section's As is are one engine call, and a new input is one more", () => {
    fc.engine.mockClear();
    const first = tasks(5);
    const { rerender, getByTestId } = render(<ReportsTab list={first} />);
    // Positive control: the section really rendered a forecast (its tiles), so the count is not vacuous.
    expect(getByTestId("forecast-report-tiles")).toBeTruthy();
    expect(fc.engine).toHaveBeenCalledTimes(1);

    rerender(<ReportsTab list={first} />);
    expect(fc.engine).toHaveBeenCalledTimes(1);

    rerender(<ReportsTab list={tasks(6)} />);
    expect(fc.engine).toHaveBeenCalledTimes(2);
  });

  test("with the lever search running, its prepare step adds no As-is: still one per input change", async () => {
    vi.useFakeTimers();
    fc.realLevers = true;
    fc.engine.mockClear();
    const { rerender, getByTestId } = render(<ReportsTab list={tasks(5)} />);
    expect(getByTestId("forecast-report-tiles")).toBeTruthy();
    // Positive control: the search really prepared (a pending timer is its first step), so the count is not vacuous.
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await drainLeverSearch();
    expect(asIsCalls()).toBe(1);

    rerender(<ReportsTab list={tasks(6)} />);
    await drainLeverSearch();
    expect(asIsCalls()).toBe(2);
  });
});

const PLAN = { startDate: "2026-01-01", endDate: PLAN_END, granularity: "week", currency: "EUR" } as ResourcePlan;
const FORECAST_SETTINGS = { ...SETTINGS };
const SCENARIOS = {
  api: {
    scenarios: [], canCreate: true, mintId: () => 9,
    createScenario: () => null, updateScenario: () => false, renameScenario: () => false, deleteScenario: () => {},
  },
  directory: DIRECTORY,
  readOnly: false,
};

/** The Forecast view as the app mounts it, with the app run warm (the history recorder holds the same references). */
function ForecastTab({ list }: { list: readonly Task[] }) {
  useAppForecast({ tasks: list, milestones: MILESTONES, planEnd: PLAN_END, today: TODAY, holidaySet: NONE, active: true });
  return (
    <ForecastPanel
      lang="en-US" tasks={list as Task[]} milestones={MILESTONES} plan={PLAN} today={TODAY} holidaySet={NONE} showSimulation
      budgetFacts={null} scenarios={SCENARIOS} forecastSettings={FORECAST_SETTINGS}
    />
  );
}

describe("Forecast view — the lever search's prepare takes the shared run (§502 spec §4, P-T5-1)", () => {
  // ★ The view's own Quick run is NOT the app call (it carries the How-many target the user picks), so it is one As-is
  //   of its own; the lever search's As-is is the app run, which the app already holds. Before P-T5-1 the prepare ran a
  //   third identical As-is here.
  test("the view's run plus the shared app run, and nothing more from the search, per input change", async () => {
    vi.useFakeTimers();
    fc.realLevers = true;
    fc.engine.mockClear();
    const { rerender, getByRole } = render(<ForecastTab list={tasks(5)} />, { wrapper: WorkspaceTabProvider });
    expect(getByRole("columnheader", { name: /what it would take/i })).toBeTruthy();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await drainLeverSearch();
    expect(asIsCalls()).toBe(2);

    rerender(<ForecastTab list={tasks(6)} />);
    await drainLeverSearch();
    expect(asIsCalls()).toBe(4);
  });
});
