// src/app/raid-panel-columns.ts
//
// Shared column metadata for the RAID panel, extracted so the orchestrator
// (raid-panel.tsx), the toolbar (raid-panel-toolbar.tsx), and the table
// (raid-panel-rows.tsx) can all import it without a cycle. Move-only: these
// consts previously lived at the top of raid-panel.tsx.
import type { ColumnConfigCol } from "./column-config-popover";

export const RAID_COL_WIDTHS = {
  id: 60,
  category: 100,
  title: 240,
  severity: 90,
  status: 110,
  owner: 140,
  targetDate: 110,
  linkedTasks: 140,
  causedBy: 140,
} as const;
export type RaidCol = keyof typeof RAID_COL_WIDTHS;

// Toggleable columns (the leading row-select checkbox is always-on and not
// listed). Order matches the rendered header/cell order.
export const RAID_CONFIG_COLS: readonly ColumnConfigCol[] = [
  { key: "id", labelKey: "id" },
  { key: "category", labelKey: "raidCategory" },
  { key: "title", labelKey: "raidTitle" },
  { key: "severity", labelKey: "raidSeverity" },
  { key: "status", labelKey: "raidStatus" },
  { key: "owner", labelKey: "raidOwner" },
  { key: "targetDate", labelKey: "raidTargetDate" },
  { key: "linkedTasks", labelKey: "raidLinkedTasks" },
  { key: "causedBy", labelKey: "raidCausedBy" },
];
