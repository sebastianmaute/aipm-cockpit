// src/app/export-workspace.ts — §463: the ONE workspace both export buttons export.
//
// ★★★ TWO BUTTONS, TWO LITERALS, THREE DEAD SWITCHES. The header Export menu
//  passed 11 slices and the Projects-panel export 16, and neither passed
//  calendar events, knowledge items or insights — so those Settings → Export
//  switches changed nothing on any format, and a switched-on section vanished
//  with no notice (`buildExportSections` cannot tell an absent slice from an
//  empty one). Both buttons now export this object; the Settings → Export
//  switches decide what is written, as the section builders always did.
// ★ Every `ExportSectionKey` is a `Workspace` field of the same name —
//  `export-workspace.test.ts` derives that per key instead of trusting it.

import type { Workspace } from "./storage";

export const EXPORT_WORKSPACE_KEYS = [
  "tasks", "raid", "absences", "shifts", "resources", "roles", "disciplines", "grades",
  "plan", "budgets", "fxRates", "status", "project", "milestones", "changes", "stakeholders",
  "calendarEvents", "knowledgeItems", "insights",
] as const;

export type ExportWorkspaceKey = (typeof EXPORT_WORKSPACE_KEYS)[number];

/** `Pick`, not an all-required mapped type: several of these `Workspace`
 *  fields (`budgets`, `fxRates`, `status`, `project`, `milestones`, `changes`,
 *  `stakeholders`, `calendarEvents`, `knowledgeItems`, `insights`) are
 *  optional on `Workspace` itself, so requiring every key would reject a real
 *  `Workspace` — including `export-workspace.test.ts`'s own sample — with
 *  TS2345. The guard that every Settings → Export switch has a slice here is
 *  `export-workspace.test.ts`'s derived-axis test over `EXPORT_SECTION_KEYS`,
 *  not the parameter type. */
export function buildExportWorkspace(src: Pick<Workspace, ExportWorkspaceKey>): Workspace {
  return {
    tasks: src.tasks, raid: src.raid, absences: src.absences, shifts: src.shifts,
    resources: src.resources, roles: src.roles, disciplines: src.disciplines, grades: src.grades,
    plan: src.plan, budgets: src.budgets, fxRates: src.fxRates, status: src.status,
    project: src.project, milestones: src.milestones, changes: src.changes,
    stakeholders: src.stakeholders, calendarEvents: src.calendarEvents,
    knowledgeItems: src.knowledgeItems, insights: src.insights,
  };
}
