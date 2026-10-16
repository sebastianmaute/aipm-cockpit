// §502 spec §3.4 — ONE engine run per input change while every simulation surface is mounted
// together: the Dashboard (KPI strip, Forecast tile, milestone chips), the next-actions sim signal, the
// history recorder and the Budget report (through `useAppForecast`). Each calls `computeAppForecast` with the SAME references, so its single-entry
// memo serves all but the first. A surface that passed a copy (a `.filter()`, a `?? []`) would rerun
// the 10,000 trials, and this count would show it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { defaultSettings, defaultNextActionsConfig } from "./settings-types";
import type { DashboardModel } from "./dashboard";
import type { Milestone, ResourcePlan, Task } from "./types";
import { showForecastView } from "../test/forecast-view";

const { computeNextActions, buildActionInput, buildWorkloadAlerts } = vi.hoisted(() => ({
  computeNextActions: vi.fn(() => []),
  buildActionInput: vi.fn((a: unknown) => a),
  buildWorkloadAlerts: vi.fn(() => []),
}));
vi.mock("./next-actions", async (orig) => ({ ...(await orig<typeof import("./next-actions")>()), computeNextActions }));
vi.mock("./next-actions-input", () => ({ buildActionInput }));
vi.mock("./next-actions-workload", () => ({ buildWorkloadAlerts }));
// Call-through spies: the forecast runs for real, the spies only count.
// `callers` records which module asked, from the call stack, so the test can tell the three surfaces apart.
const fc = vi.hoisted(() => ({ engine: vi.fn(), app: vi.fn(), callers: [] as string[] }));
const SURFACES = vi.hoisted(() => ["dashboard-panel", "use-next-actions", "use-forecast-history-recorder", "use-app-forecast"]);
vi.mock("./forecast/index", async (orig) => {
  const real = await orig<typeof import("./forecast/index")>();
  fc.engine.mockImplementation(real.computeScheduleForecast as never);
  return { ...real, computeScheduleForecast: fc.engine };
});
vi.mock("./forecast/app-forecast", async (orig) => {
  const real = await orig<typeof import("./forecast/app-forecast")>();
  fc.app.mockImplementation(((args: Parameters<typeof real.computeAppForecast>[0]) => {
    // The innermost frame that names a surface is the caller.
    const frames = (new Error().stack ?? "").split("\n");
    const frame = frames.find((l) => SURFACES.some((m) => l.includes(m)));
    const hit = frame && SURFACES.find((m) => frame.includes(m));
    if (hit) fc.callers.push(hit);
    return real.computeAppForecast(args);
  }) as never);
  return { ...real, computeAppForecast: fc.app };
});

import { DashboardPanel } from "./dashboard-panel";
import { useNextActions } from "./use-next-actions";
import { useForecastHistoryRecorder } from "./use-forecast-history-recorder";
import { useAppForecast } from "./use-app-forecast";
import { isSimulationActive } from "./forecast-simulation";
import { BudgetReportPanel } from "./budget-report-panel";

const TODAY = "2026-06-02";
const PLAN = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" } as unknown as ResourcePlan;
const MILESTONES = [{ id: 1, name: "Go-Live", date: "2026-09-01", linkedTaskIds: [] }] as unknown as Milestone[];
const HOLIDAYS = new Set<string>();
const EPOCH_0 = () => 0;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

/** What task-manager and workspace-section wire: one `tasks`, `milestones`, `holidaySet` and `today` for every surface. */
function AllSurfaces({ tasks }: { tasks: readonly Task[] }) {
  const { settingsOverrides, setSettingsOverrides, forecastHistory, setForecastHistory } = useWorkspace();
  useNextActions({
    isPopout: false, tasks: tasks as Task[], raid: [], changes: [], milestones: MILESTONES, stakeholders: [],
    steeringCommittee: undefined, resources: [], absences: [], shifts: [], plan: PLAN,
    dashboardModel: {} as DashboardModel, commsReminders: [], features: defaultSettings.features,
    project: undefined, portfolioCurrentId: null, today: TODAY, workdayHours: 8, holidaySet: HOLIDAYS,
    holidaysReady: true, settingsOverrides, effectiveNotifications: defaultSettings.notifications,
    effectiveNextActions: defaultNextActionsConfig, actionTrends: undefined, learnedBias: {},
    recordLearning: async () => {}, requestOpen: () => {},
  });
  useForecastHistoryRecorder({
    hydrated: true, isPopout: false, loadPending: false, holidaysReady: true, today: TODAY, tasks,
    milestones: MILESTONES, planEnd: PLAN.endDate ?? "", holidaySet: HOLIDAYS, settingsOverrides,
    features: defaultSettings.features, forecastHistory, setForecastHistory, getScopeEpoch: EPOCH_0, sharedStorage: false,
  });
  // As workspace-section does for the Budget report: the same references, through `useAppForecast`.
  const simulation = useAppForecast({
    tasks, milestones: MILESTONES, planEnd: PLAN.endDate ?? "", today: TODAY, holidaySet: HOLIDAYS,
    active: isSimulationActive(settingsOverrides, defaultSettings.features),
  });
  return (
    <>
    <button type="button" onClick={() => setSettingsOverrides({ forecast: { showSimulation: true } })}>turn on</button>
    <DashboardPanel
      lang="en-US" tasks={tasks} raid={[]} budgets={[]} plan={PLAN} roles={[]} resources={[]} absences={[]}
      holidaySet={HOLIDAYS} workdayHours={8} today={TODAY} milestones={MILESTONES} changes={[]}
      projectId="p-shared-run"
    />
    <BudgetReportPanel
      lang="en-US" buckets={[]} plan={PLAN} roles={[]} disciplines={[]} resources={[]} absences={[]}
      holidaySet={HOLIDAYS} workdayHours={8} fxRates={null} tasks={tasks} today={TODAY} simulation={simulation}
    />
    </>
  );
}

describe("one forecast run shared by every simulation surface (§502 spec §3.4)", () => {
  beforeEach(() => {
    showForecastView();
    fc.engine.mockClear();
    fc.app.mockClear();
    fc.callers.length = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("runs the engine once per input change, though each surface asks for the forecast", () => {
    const tasks: Task[] = [];
    const { rerender } = render(<AllSurfaces tasks={tasks} />, { wrapper });
    expect(fc.engine).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "turn on" }));
    // Dashboard, next actions, recorder and the Budget report each asked; the engine ran once.
    expect(new Set(fc.callers)).toEqual(new Set(SURFACES));
    expect(fc.engine).toHaveBeenCalledTimes(1);
    fc.callers.length = 0;
    rerender(<AllSurfaces tasks={[]} />);
    expect(new Set(fc.callers)).toEqual(new Set(SURFACES));
    expect(fc.engine).toHaveBeenCalledTimes(2);
  });
});
