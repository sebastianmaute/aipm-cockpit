/**
 * The one way a component outside the Dashboard asks for the shared forecast run (§502).
 *
 * ★★ Pass the SAME `tasks`, `milestones` and `holidaySet` references the history recorder and
 * `useNextActions` pass (the workspace context's collections, task-manager's `holidaySet`), so
 * `computeAppForecast`'s single-entry memo serves every surface and the 10,000 trials run once
 * per input change — `forecast-shared-run.test.tsx` counts it. A copy (a `.filter()`, a `?? []`)
 * reruns the engine.
 */
import { useMemo } from "react";
import { computeAppForecast, type AppForecast, type AppForecastArgs } from "./forecast/app-forecast";

/** null while `!active` (the switch off or the Forecast view hidden), and the engine never runs. */
export function useAppForecast(a: AppForecastArgs & { active: boolean }): AppForecast | null {
  const { tasks, milestones, planEnd, today, holidaySet, active } = a;
  return useMemo(
    () => (active ? computeAppForecast({ tasks, milestones, planEnd, today, holidaySet }) : null),
    [active, tasks, milestones, planEnd, today, holidaySet],
  );
}
