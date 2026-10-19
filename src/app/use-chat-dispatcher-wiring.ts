// src/app/use-chat-dispatcher-wiring.ts
//
// task-manager's wiring for the AI assistant's tool dispatcher: the derived
// getters (`getBudgetRollup` for `get_dashboard_snapshot`,
// `getAllocationsSnapshot` for `list_allocations`, `getForecastInput` for the
// three forecast tools, §502), the `getDashboardModel`
// getter and the `useChatDispatcher` call. Extracted from task-manager.tsx
// (§491); move-only. The workspace slices the getters read are taken from
// `useWorkspace()`, the same context task-manager reads them from; everything
// else arrives as a deps field with the value task-manager passed before.
//
// ★ Nothing here is memoized, and that is the code as it was, not an omission:
// the getters are deliberately rebuilt every render (see the comments on them),
// and the dispatcher reads each one through a ref at tool-call time, so a fresh
// function per render costs nothing and keeps the read live.
//
// ★★ The dispatcher's args are forwarded FIELD BY FIELD, not by a spread, so
// `use-chat-dispatcher.test.tsx`'s call-site scan can follow `allowDestructiveSave`
// through both hops. A field list can silently drop a NEW optional
// `ChatDispatcherArgs` field, so the list is checked `satisfies ForwardedArgs`:
// that type makes EVERY deps key but `dashboardModel` required (optional ones
// included, with their `undefined`), so a new field is a tsc error here until it
// is destructured and forwarded.
"use client";
import { computeBudgetReport, type ProjectReport } from "./budget-report";
import { makeAllocationsSnapshotGetter } from "./alloc-plan/alloc-plan";
import { isModuleEnabled } from "./feature-modules";
import { useChatDispatcher, type ChatDispatcherArgs } from "./use-chat-dispatcher";
import { useWorkspace } from "./workspace-context";
import type { DashboardModel } from "./dashboard";
import type { ToolDispatcher } from "./chat-tools";
import { computeProjectForecastFacts } from "./budget-forecast";
import { DEFAULT_HISTORY_WINDOW } from "./forecast/constants";
import type { ForecastReportInput } from "./forecast-ai-report";
import { isSimulationActive } from "./forecast-simulation";

export type ChatDispatcherWiringDeps = Omit<
  ChatDispatcherArgs,
  "getDashboardModel" | "getBudgetRollup" | "getAllocationsSnapshot" | "getForecastInput"
> & {
  /** task-manager's render-scope dashboard model (`useTrendSnapshots`), handed
   *  to the dispatcher through a getter. */
  dashboardModel: DashboardModel;
  /** `useHolidaySet`'s flag. Wiring-only: while false, `getForecastInput` returns null and the forecast
   *  tools refuse, as the Forecast view waits for the calendar. */
  holidaysReady: boolean;
};

/** Every deps field the dispatcher receives unchanged, each one REQUIRED. The key
 *  set is filtered through `Exclude`, which makes the mapping non-homomorphic, so
 *  an optional field loses its `?` and keeps `undefined` in its value type. */
type ForwardedArgs = {
  [K in Exclude<keyof ChatDispatcherWiringDeps, "dashboardModel" | "holidaysReady">]: ChatDispatcherWiringDeps[K];
};

export function useChatDispatcherWiring(deps: ChatDispatcherWiringDeps): ToolDispatcher {
  const {
    dashboardModel, settings, clock, onSettingsLoggedByAi, setSelectedIds, setSettings, isReadOnly,
    currentView, settingsProjectId, holidaySet, logActivityAs, allowDestructiveSave, undo, openWbsPlan,
    holidaysReady, projectWriterRef, getScopeEpoch,
  } = deps;
  const {
    tasks, absences, resources, roles, budgets, plan, fxRates, milestones, shifts, forecastHistory,
    forecastScenarios, settingsOverrides,
  } = useWorkspace();

  // Deliberately NOT memoized: this runs only when the assistant calls
  // get_dashboard_snapshot, so an unused read tool costs nothing per render.
  // Passes `tasks` (which the dashboard's own computeBudgetReport call omits),
  // so earnedValue / costPerformanceIndex here are the real figures.
  const getBudgetRollup = (): ProjectReport | null => {
    if (!isModuleEnabled("budget", settings.features)) return null;
    return computeBudgetReport(
      budgets,
      plan,
      roles,
      resources,
      settings.resources.workdayHours,
      holidaySet,
      absences,
      tasks,
      fxRates,
    ).project;
  };

  // Deliberately NOT memoized: the snapshot is built only when the assistant
  // calls list_allocations, so an unused read tool costs nothing per render.
  // The factory forwards the call's §12 scope — see its docstring for why it
  // is not an inline arrow.
  const getAllocationsSnapshot = makeAllocationsSnapshotGetter({
    resources,
    plan,
    absences,
    workdayHours: settings.resources.workdayHours,
    holidaySet,
  });

  // Deliberately NOT memoized, like the two above: built only when a forecast tool runs. The run is the
  // Forecast view's at its defaults (60-day window, tasks unit); the facts and the directory are built as
  // workspace-section.tsx builds `forecastBudgetFacts` and `forecastDirectory`.
  // ★ `scenarios`, `run.tasks`, `run.milestones` and `run.directory.resources` here are render-scope slices;
  //   use-forecast-tools.ts swaps in the synchronously written refs, so a same-turn create is seen. The budget
  //   facts are still built from render scope.
  const getForecastInput = (): ForecastReportInput | null => {
    if (!holidaysReady) return null;
    const budgetEnabled = isModuleEnabled("budget", settings.features);
    const workdayHours = settings.resources.workdayHours;
    const today = clock.today;
    return {
      run: {
        tasks, milestones, today, holidaySet, window: DEFAULT_HISTORY_WINDOW, unit: "tasks", planEnd: plan.endDate,
        directory: { resources, roles, shifts, absences, budgets, fxRates, workdayHours, baseCurrency: plan.currency },
        budgetFacts: budgetEnabled
          ? computeProjectForecastFacts({ buckets: budgets, plan, roles, resources, workdayHours, holidaySet, absences, tasks, fxRates, today })
          : null,
        costOn: isSimulationActive(settingsOverrides, settings.features) && budgetEnabled,
      },
      history: forecastHistory,
      scenarios: forecastScenarios,
      currency: plan.currency,
      settingsOverrides,
    };
  };

  return useChatDispatcher({
    ...({
      settings,
      clock,
      onSettingsLoggedByAi,
      setSelectedIds,
      setSettings,
      isReadOnly,
      currentView, settingsProjectId, holidaySet, logActivityAs,
      allowDestructiveSave,
      undo,
      openWbsPlan,
      projectWriterRef,
      getScopeEpoch,
    } satisfies ForwardedArgs),
    getDashboardModel: () => dashboardModel,
    getBudgetRollup,
    getAllocationsSnapshot,
    getForecastInput,
  });
}
