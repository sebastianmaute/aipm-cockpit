// §502 part 3 — the Dashboard attaches the budget simulation to the forecast bundle it hands the
// tiles, from the ONE shared schedule run, while the Budget health dot keeps reading the
// calculated pace figure (`paceVacHealth`) whatever the switch says.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { t } from "./i18n";
import { healthColorName } from "./health";
import type { ForecastBundle } from "./budget-forecast-bundle";
import type { BudgetBucket, Role, Task } from "./types";
import { workingDaysBefore } from "./working-days";
import { showForecastView } from "../test/forecast-view";
import { useMeasuredHeights } from "./use-measured-heights";
import * as budgetSimModule from "./budget-sim";
import { budgetSimContentKey } from "./budget-sim";

const seen = vi.hoisted(() => ({ bundles: [] as (ForecastBundle | null)[] }));
vi.mock("./burndown-chart-panel", async (orig) => {
  const real = await orig<typeof import("./burndown-chart-panel")>();
  function Recording(p: ComponentProps<typeof real.BurndownChartPanel>) {
    // The panel types a slice of the bundle; the object is the whole bundle the tiles were handed.
    seen.bundles.push((p.bundle ?? null) as ForecastBundle | null);
    return <real.BurndownChartPanel {...p} />;
  }
  return { ...real, BurndownChartPanel: Recording };
});

// A pass-through spy: the real hook runs, and its arguments are observable.
vi.mock("./use-measured-heights", async (orig) => {
  const m = await orig<typeof import("./use-measured-heights")>();
  return { ...m, useMeasuredHeights: vi.fn(m.useMeasuredHeights) };
});

import { DashboardPanel } from "./dashboard-panel";

const EN = "en-US" as const;
const TODAY = "2026-09-14"; // Monday
const NONE = new Set<string>();
// Plan ends 20 working days after today; 57,500 booked evenly over the 20 working days before it at
// €100/h on a €100,000 budget -> pace VAC = -15% of BAC -> the Budget dot reads Red (dashboard.test).
const PLAN = { startDate: "2026-01-01", endDate: "2026-10-12", granularity: "month" as const, currency: "EUR" as const };
const WINDOW = workingDaysBefore(TODAY, 20, NONE);
const ROLE = { id: 1, disciplineId: 1, name: "Dev", gradeId: 1, internalRate: 60, externalRate: 100 } as unknown as Role;
const BUCKET = {
  id: 1, name: "B1", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
  allocations: [{
    roleId: 1, resourceIds: [], budgetHours: { "2026-06": 1000 },
    actualHours: Object.fromEntries(WINDOW.map((d) => [d, 57_500 / WINDOW.length / 100])),
  }],
} as unknown as BudgetBucket;
// Enough finished history for the schedule run to clear its floor, and open work left.
const TASKS = [
  ...WINDOW.map((d, i) => ({ id: 100 + i, title: `done ${i}`, status: "Done", completedDate: d, dueDate: "", priority: "Medium" })),
  ...Array.from({ length: 10 }, (_, i) => ({ id: 1 + i, title: `open ${i}`, status: "Open", dueDate: "", priority: "Medium" })),
] as unknown as Task[];

function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

function renderDashboard(over: { tasks?: Task[]; plan?: typeof PLAN; projectId?: string } = {}) {
  render(
    <DashboardPanel
      lang={EN} tasks={over.tasks ?? TASKS} raid={[]} budgets={[BUCKET]} plan={over.plan ?? PLAN} roles={[ROLE]} resources={[]} absences={[]}
      holidaySet={NONE} workdayHours={8} today={TODAY} projectId={over.projectId ?? "p-budget-sim"}
    />,
    { wrapper },
  );
}
const turnOn = () =>
  fireEvent.click(within(screen.getByTestId("tile-burn")).getByRole("button", { name: new RegExp(t(EN, "simulationShow")) }));
const budgetDot = (rag: "R" | "A" | "G") => `${t(EN, "dashboardSubBudget")}: ${healthColorName(rag, EN)}`;
const lastBundle = () => seen.bundles[seen.bundles.length - 1];

describe("DashboardPanel budget simulation (§502 part 3)", () => {
  beforeEach(() => {
    showForecastView();
    seen.bundles.length = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("hands the tiles the bundle without a simulation while the switch is off", () => {
    renderDashboard();
    expect(lastBundle()).not.toBeNull();
    expect(lastBundle()?.sim).toBeUndefined();
  });

  it("hands the tiles the bundle with the simulated cost from the shared run once the switch is on", () => {
    renderDashboard();
    const plain = lastBundle();
    turnOn();
    const wrapped = lastBundle();
    expect(wrapped).not.toBe(plain);
    expect(wrapped?.eur).toBe(plain?.eur);
    expect(wrapped?.sim?.eur.kind).toBe("sim");
    expect(wrapped?.sim?.hours.kind).toBe("sim");
    expect(wrapped?.sim?.finish.p50).not.toBeNull();
  });

  it("the Budget health dot ignores the simulation", () => {
    renderDashboard();
    // `getByTitle`: the badge sits in the closed Adjust-health <details>; its title is its name.
    expect(screen.getByTitle(budgetDot("R"))).toBeInTheDocument();
    turnOn();
    // Positive control: the simulation is really on and simulated a cost range.
    expect(lastBundle()?.sim?.eur.kind).toBe("sim");
    expect(screen.getByTitle(budgetDot("R"))).toBeInTheDocument();
  });

  // The simulated line under the burn chart changes the tile's height with no density, tile-set or flag
  // change, so the burn tile's own state must reach the measure key (the KPI strip's part changing too
  // would hide a missing segment, hence the exact suffix).
  it("hands the measure hook the burn tile's simulation state in the content key", () => {
    const lastKey = () => vi.mocked(useMeasuredHeights).mock.calls.at(-1)?.[0].contentKey ?? "";
    renderDashboard();
    expect(lastKey().endsWith(`|${budgetSimContentKey(undefined)}|wedge:off`)).toBe(true);
    turnOn();
    const sim = lastBundle()?.sim;
    expect(sim?.eur.kind).toBe("sim");
    expect(lastKey().endsWith(`|${budgetSimContentKey(sim)}|wedge:true:true`)).toBe(true);
    expect(budgetSimContentKey(sim)).not.toBe(budgetSimContentKey(undefined));
  });

  // The x-domain cap leaves the cost wedge, and its legend entry, out of the chart; the Dashboard builds no
  // chart model, so the key carries the model's own wedge predicate (`simCostContentKey`).
  it("hands the measure hook whether the x-domain cap leaves out the burn chart's cost range", () => {
    const lastKey = () => vi.mocked(useMeasuredHeights).mock.calls.at(-1)?.[0].contentKey ?? "";
    // A long backlog puts P80 far out; a plan starting just before the booked hours makes the cap one short plan length.
    const backlog = [
      ...TASKS,
      ...Array.from({ length: 400 }, (_, i) => ({ id: 1_000 + i, title: `more ${i}`, status: "Open", dueDate: "", priority: "Medium" })),
    ] as unknown as Task[];
    renderDashboard({ tasks: backlog, plan: { ...PLAN, startDate: "2026-08-01" } });
    turnOn();
    const sim = lastBundle()?.sim;
    // Positive control: a real cost range the cap leaves out, not a missing one.
    expect(sim?.eur.kind).toBe("sim");
    expect(lastKey().endsWith(`|${budgetSimContentKey(sim)}|wedge:false:false`)).toBe(true);
  });

  // §502 — the budget simulation feeds the burn tile alone, so with that tile hidden from the board it never
  // runs, while the KPI strip's simulation (the same run) still does. (With the Budget module off the model
  // has no bundle at all, so that case never reached `withBudgetSim` in the first place.)
  it("does not run the budget simulation while the burn tile is hidden", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(budgetSimModule, "withBudgetSim");
    renderDashboard({ projectId: "p-budget-sim-hidden" });
    turnOn();
    // Positive control: shown, the tile's bundle carries the simulation.
    expect(spy).toHaveBeenCalled();
    expect(lastBundle()?.sim?.eur.kind).toBe("sim");
    spy.mockClear();
    const kebab = `${t(EN, "actionMoreActions")} – ${t(EN, "dashboardBudgetBurn")}`;
    await user.click(screen.getByRole("button", { name: kebab }));
    await user.click(within(screen.getByRole("dialog", { name: kebab })).getByRole("button", { name: t(EN, "arrangementTileHide") }));
    expect(screen.queryByTestId("tile-burn")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    // Positive control: the switch stayed on, so the KPI strip still shows simulated cells from the same run.
    expect(document.querySelector("[data-sim]")).not.toBeNull();
    // The burn tile's part of the measure key reads off: nothing was simulated for it.
    const lastKey = vi.mocked(useMeasuredHeights).mock.calls.at(-1)?.[0].contentKey ?? "";
    expect(lastKey.endsWith(`|${budgetSimContentKey(undefined)}|wedge:off`)).toBe(true);
  });
});
