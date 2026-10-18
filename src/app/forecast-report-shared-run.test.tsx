// §502 spec §4 — the Reports view runs the 10,000-trial schedule ONCE per input change. `useAppForecast` (the
// embedded Budget report's run, as workspace-section calls it on this tab) and the Forecast section's As-is share
// `computeAppForecast`'s memo: the section hands `computeAppScheduleRun`'s result to `computeScenarioComparison`
// instead of running As is again. The lever search is stubbed (its own runs are off the render path, Task 3).
import { describe, expect, test, vi } from "vitest";
import { render } from "@testing-library/react";
import { useMemo } from "react";
import type { ScenarioRunInput } from "./forecast-scenario-compare";
import type { ScenarioDirectory } from "./forecast-added-people";
import { DEFAULT_HISTORY_WINDOW } from "./forecast/constants";
import type { Milestone, Task } from "./types";
import { workingDaysBefore } from "./working-days";

// Call-through spy: the engine runs for real, the spy only counts.
const fc = vi.hoisted(() => ({ engine: vi.fn() }));
vi.mock("./forecast/index", async (orig) => {
  const real = await orig<typeof import("./forecast/index")>();
  fc.engine.mockImplementation(real.computeScheduleForecast as never);
  return { ...real, computeScheduleForecast: fc.engine };
});
vi.mock("./use-lever-search", async (orig) => ({
  ...(await orig<typeof import("./use-lever-search")>()),
  useLeverSearch: () => new Map(),
}));

import { useAppForecast } from "./use-app-forecast";
import { ForecastReportSection } from "./forecast-report-section";

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
});
