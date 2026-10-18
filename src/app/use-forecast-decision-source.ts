// §502 part 4 — the forecast decision the exports and document blocks read (`ExportExtrasProvider`). Builds NOTHING
// on render: the memo only wraps the inputs in lazy thunks. `source` runs the whole engine the first time an export or
// a document download asks; `live` is what a preview reads (`usePreviewExportExtras`), whose lever search runs off the
// render path. The input is the Reports Forecast section's (the app-wide defaults, the same references), so the
// shared app run answers and an exported figure matches the Reports one.

import { useMemo } from "react";
import { computeProjectForecastFacts } from "./budget-forecast";
import type { ScenarioDirectory } from "./forecast-added-people";
import {
  buildForecastDecisionBase, forecastDecisionSource, once, type ForecastDecisionHandle,
} from "./forecast-decision";
import { DEFAULT_HISTORY_WINDOW } from "./forecast/constants";
import type { ScenarioRunInput } from "./forecast-scenario-compare";
import type { ForecastScenario } from "./forecast-scenarios";
import { targetConfidenceOf } from "./forecast-target";
import type { SettingsOverrides } from "./settings-types";
import type { Milestone, ResourcePlan, Task } from "./types";

export type ForecastDecisionSourceDeps = {
  /** `isSimulationActive(settingsOverrides, features)`; off, there is no source and the section is absent. */
  simulationActive: boolean;
  /** False while the holiday calendar loads: the decision is null until then (a run on an empty calendar would be wrong). */
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

/**
 * ★ PRESENT EXACTLY WHILE THE SIMULATION IS ACTIVE — the one gate that offers the section (the document block select
 * reads the source's presence; Settings → Export asks `isSimulationActive` itself). While the holiday calendar loads
 * the handle is there but its input is null, so the decision is null and the section is omitted until it is ready.
 */
export function useForecastDecisionSource(d: ForecastDecisionSourceDeps): ForecastDecisionHandle | null {
  const { simulationActive, holidaysReady, tasks, milestones, today, holidaySet, plan, directory, budgetEnabled, scenarios, settingsOverrides } = d;
  return useMemo(() => {
    if (!simulationActive) return null;
    // Built once per handle, on first ask; the same identity every time after, so `useLeverSearch` keys on it.
    const input = once((): ScenarioRunInput | null => (holidaysReady === false ? null : {
      tasks, milestones, today, holidaySet, window: DEFAULT_HISTORY_WINDOW, unit: "tasks", planEnd: plan.endDate, directory,
      budgetFacts: budgetEnabled
        ? computeProjectForecastFacts({
          buckets: directory.budgets, plan, roles: directory.roles, resources: directory.resources, workdayHours: directory.workdayHours,
          holidaySet, absences: directory.absences, tasks, fxRates: directory.fxRates, today,
        })
        : null,
      costOn: budgetEnabled,
    }));
    const args = () => ({ simulationActive, scenarios, settingsOverrides, input: input() });
    return {
      source: forecastDecisionSource(args),
      live: { goal: targetConfidenceOf(settingsOverrides), input, base: once(() => buildForecastDecisionBase(args())) },
    };
  }, [simulationActive, holidaysReady, tasks, milestones, today, holidaySet, plan, directory, budgetEnabled, scenarios, settingsOverrides]);
}
