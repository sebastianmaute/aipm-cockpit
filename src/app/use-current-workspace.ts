import { useCallback } from "react";
import { useWorkspace } from "./workspace-context";
import type { Workspace } from "./workspace";

/** Assemble a Workspace snapshot from the live context FOR TEMPLATE USE.
 *  ★ NOT a full snapshot: it INTENTIONALLY omits the per-project/per-device
 *  config that must not bake into a reusable template — `settingsOverrides`,
 *  `timelogLinks`, `knowledgeItems`, and `features`. Do NOT reuse this for a
 *  save/export path (it would silently drop those); the real persistence
 *  assembler is `currentWorkspace()` in use-storage-backend.ts. */
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
      steeringCommittee: ws.steeringCommittee,
      project: ws.project,
      fieldVisibility: ws.fieldVisibility,
    }),
    [ws],
  );
}
