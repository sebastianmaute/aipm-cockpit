// §502 part 4 — the forecast decision source the exports and document blocks read (`ExportExtrasProvider`). Builds
// NOTHING on render: the memo only wraps the inputs in a lazy `forecastDecisionSource`, which runs the engine the
// first time an export or a `forecastDecision` block asks. The input is the Reports Forecast section's (the app-wide
// defaults, the same references), so the shared app run answers and an exported figure matches the Reports one.

import { useMemo } from "react";
import { computeProjectForecastFacts } from "./budget-forecast";
import type { ScenarioDirectory } from "./forecast-added-people";
import { forecastDecisionSource, type ForecastDecisionSource } from "./forecast-decision";
import { DEFAULT_HISTORY_WINDOW } from "./forecast/constants";
import type { ForecastScenario } from "./forecast-scenarios";
import type { SettingsOverrides } from "./settings-types";
import type { Milestone, ResourcePlan, Task } from "./types";

export type ForecastDecisionSourceDeps = {
  /** `isSimulationActive(settingsOverrides, features)`; off, there is no source and the section is absent. */
  simulationActive: boolean;
  /** False while the holiday calendar loads: no source yet (a run on an empty calendar would be wrong). */
  holidaysReady: boolean | undefined;
  tasks: readonly Task[];
  milestones: readonly Milestone[];
  today: string;
  holidaySet: ReadonlySet<string>;
  plan: ResourcePlan;
  directory: ScenarioDirectory;
  /** The Budget module: the cost pass and the facts it reads. */
  budgetEnabled: boolean;
  scenarios: readonly ForecastScenario[];
  settingsOverrides: SettingsOverrides | undefined;
};

export function useForecastDecisionSource(d: ForecastDecisionSourceDeps): ForecastDecisionSource | null {
  const { simulationActive, holidaysReady, tasks, milestones, today, holidaySet, plan, directory, budgetEnabled, scenarios, settingsOverrides } = d;
  return useMemo(() => {
    if (!simulationActive || holidaysReady === false) return null;
    return forecastDecisionSource(() => ({
      simulationActive,
      scenarios,
      settingsOverrides,
      input: {
        tasks, milestones, today, holidaySet, window: DEFAULT_HISTORY_WINDOW, unit: "tasks", planEnd: plan.endDate, directory,
        budgetFacts: budgetEnabled
          ? computeProjectForecastFacts({
            buckets: directory.budgets, plan, roles: directory.roles, resources: directory.resources, workdayHours: directory.workdayHours,
            holidaySet, absences: directory.absences, tasks, fxRates: directory.fxRates, today,
          })
          : null,
        costOn: budgetEnabled,
      },
    }));
  }, [simulationActive, holidaysReady, tasks, milestones, today, holidaySet, plan, directory, budgetEnabled, scenarios, settingsOverrides]);
}
