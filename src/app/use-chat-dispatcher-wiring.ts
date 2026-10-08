// src/app/use-chat-dispatcher-wiring.ts
//
// task-manager's wiring for the AI assistant's tool dispatcher: the two derived
// read-tool getters (`getBudgetRollup` for `get_dashboard_snapshot`,
// `getAllocationsSnapshot` for `list_allocations`), the `getDashboardModel`
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
// through both hops. The cost: a NEW optional `ChatDispatcherArgs` field is
// accepted by these deps (they are typed from it) and silently dropped here
// until it is added to both lists below. A required one is a tsc error.
"use client";
import { computeBudgetReport, type ProjectReport } from "./budget-report";
import { makeAllocationsSnapshotGetter } from "./alloc-plan/alloc-plan";
import { isModuleEnabled } from "./feature-modules";
import { useChatDispatcher, type ChatDispatcherArgs } from "./use-chat-dispatcher";
import { useWorkspace } from "./workspace-context";
import type { DashboardModel } from "./dashboard";
import type { ToolDispatcher } from "./chat-tools";

export type ChatDispatcherWiringDeps = Omit<
  ChatDispatcherArgs,
  "getDashboardModel" | "getBudgetRollup" | "getAllocationsSnapshot"
> & {
  /** task-manager's render-scope dashboard model (`useTrendSnapshots`), handed
   *  to the dispatcher through a getter. */
  dashboardModel: DashboardModel;
};

export function useChatDispatcherWiring(deps: ChatDispatcherWiringDeps): ToolDispatcher {
  const {
    dashboardModel, settings, clock, onSettingsLoggedByAi, setSelectedIds, setSettings, isReadOnly,
    currentView, settingsProjectId, holidaySet, logActivityAs, allowDestructiveSave, undo,
  } = deps;
  const { tasks, absences, resources, roles, budgets, plan, fxRates } = useWorkspace();

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

  return useChatDispatcher({
    settings,
    clock,
    onSettingsLoggedByAi,
    setSelectedIds,
    setSettings,
    isReadOnly,
    currentView, settingsProjectId, holidaySet, logActivityAs,
    allowDestructiveSave,
    undo,
    getDashboardModel: () => dashboardModel,
    getBudgetRollup,
    getAllocationsSnapshot,
  });
}
