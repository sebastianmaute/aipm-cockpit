import { useCallback } from "react";
import { useWorkspace } from "./workspace-context";
import type { Workspace } from "./workspace";

/** Assemble a full Workspace snapshot from the live workspace context. */
export function useCurrentWorkspace(): () => Workspace {
  const ws = useWorkspace();
  return useCallback(
    (): Workspace => ({
      tasks: ws.tasks,
      raid: ws.raid,
      absences: ws.absences,
      shifts: ws.shifts,
      resources: ws.resources,
      roles: ws.roles,
      disciplines: ws.disciplines,
      grades: ws.grades,
      plan: ws.plan,
      budgets: ws.budgets,
      fxRates: ws.fxRates,
      status: ws.status,
      milestones: ws.milestones,
      changes: ws.changes,
      stakeholders: ws.stakeholders,
      project: ws.project,
      fieldVisibility: ws.fieldVisibility,
    }),
    [ws],
  );
}
