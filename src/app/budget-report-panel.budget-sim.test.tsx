// §502 part 3 — the Budget report attaches the budget simulation from the shared run it is handed
// (`simulation`, computed by the render site through `useAppForecast`) to a COPY of its bundle.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { ForecastBundle } from "./budget-forecast-bundle";
import type { BudgetBucket, Role, Task } from "./types";
import { workingDaysBefore } from "./working-days";
import { computeAppForecast } from "./forecast/app-forecast";

const seen = vi.hoisted(() => ({ bundles: [] as (ForecastBundle | null)[] }));
vi.mock("./burndown-chart-panel", async (orig) => {
  const real = await orig<typeof import("./burndown-chart-panel")>();
  function Recording(p: ComponentProps<typeof real.BurndownChartPanel>) {
    // The panel types a slice of the bundle; the object is the whole bundle the report built.
    seen.bundles.push((p.bundle ?? null) as ForecastBundle | null);
    return <real.BurndownChartPanel {...p} />;
  }
  return { ...real, BurndownChartPanel: Recording };
});

import { BudgetReportPanel } from "./budget-report-panel";

const TODAY = "2026-09-14"; // Monday
const NONE = new Set<string>();
const PLAN = { startDate: "2026-01-01", endDate: "2026-10-12", granularity: "month" as const, currency: "EUR" as const };
const WINDOW = workingDaysBefore(TODAY, 20, NONE);
const ROLE = { id: 1, disciplineId: 1, name: "Dev", gradeId: 1, internalRate: 60, externalRate: 100 } as unknown as Role;
const BUCKETS = [{
  id: 1, name: "B1", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
  allocations: [{
    roleId: 1, resourceIds: [], budgetHours: { "2026-06": 1000 },
    actualHours: Object.fromEntries(WINDOW.map((d) => [d, 28.75])),
  }],
}] as unknown as BudgetBucket[];
const TASKS = [
  ...WINDOW.map((d, i) => ({ id: 100 + i, title: `done ${i}`, status: "Done", completedDate: d, dueDate: "", priority: "Medium" })),
  ...Array.from({ length: 10 }, (_, i) => ({ id: 1 + i, title: `open ${i}`, status: "Open", dueDate: "", priority: "Medium" })),
] as unknown as Task[];
// Stable references, so a rerender keeps the report's own bundle memo (an inline `[]` would not).
const ROLES = [ROLE];
const NO_ROWS: never[] = [];
const RUN = computeAppForecast({ tasks: TASKS, milestones: [], planEnd: PLAN.endDate, today: TODAY, holidaySet: NONE });

function panel(simulation?: ComponentProps<typeof BudgetReportPanel>["simulation"]) {
  return (
    <BudgetReportPanel
      lang="en-US" buckets={BUCKETS} plan={PLAN} roles={ROLES} disciplines={NO_ROWS} resources={NO_ROWS} absences={NO_ROWS}
      holidaySet={NONE} workdayHours={8} fxRates={null} tasks={TASKS} today={TODAY} simulation={simulation}
    />
  );
}
const last = () => seen.bundles[seen.bundles.length - 1];

describe("BudgetReportPanel budget simulation (§502 part 3)", () => {
  beforeEach(() => { seen.bundles.length = 0; });

  it("leaves the bundle without a simulation while none is passed", () => {
    render(panel());
    expect(last()).not.toBeNull();
    expect(last()?.sim).toBeUndefined();
  });

  it("attaches the simulated cost from the run it is handed, on a copy with the same pace figures", () => {
    const { rerender } = render(panel(null));
    const plain = last();
    rerender(panel(RUN));
    const wrapped = last();
    expect(RUN.kind).toBe("forecast");
    expect(wrapped).not.toBe(plain);
    expect(plain?.sim).toBeUndefined();
    expect(wrapped?.eur).toBe(plain?.eur);
    expect(wrapped?.sim?.eur.kind).toBe("sim");
    expect(wrapped?.sim?.finish.p80).toBe(RUN.kind === "forecast" ? RUN.p80 : "unreachable");
  });
});
