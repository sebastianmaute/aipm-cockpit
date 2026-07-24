// Shared column metadata for the Resource Planner panel (gantt-convention leaf).
// Consumed by the orchestrator (`resources-panel.tsx`, `useColumnResize`) and the
// presentational `resources-panel-rows.tsx` / `resources-panel-toolbar.tsx`.

export const PLANNING_COL_WIDTHS = {
  assignee: 160,
  period: 100,
  capacityHours: 110,
  capacityDays: 110,
  internalCost: 120,
  externalCost: 120,
  margin: 100,
} as const;
export type PlanningCol = keyof typeof PLANNING_COL_WIDTHS;
export type PlanSortKey =
  | "assignee"
  | "capacityHours"
  | "capacityDays"
  | "internalCost"
  | "externalCost"
  | "margin";

export const ROLLUP_COL_WIDTHS = {
  assignee: 160,
  period: 100,
} as const;
export type RollupCol = keyof typeof ROLLUP_COL_WIDTHS;
