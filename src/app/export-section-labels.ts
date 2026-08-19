// The user-visible label for each ExportSectionKey.
//
// ★ Extracted from settings-sections/export-section.tsx so the Settings
//  checkbox list and the documents `dataSection` block editor cannot name the
//  same section two different ways. Deliberately NOT put in settings-types.ts:
//  document-model.ts documents a runtime import cycle through that module, and
//  widening what it pulls in is the wrong direction.
//
// ★ EXHAUSTIVE by type. A sixteenth EXPORT_SECTION_KEYS entry is a compile
//  error here rather than a section that silently renders its raw key.
import type { TranslationKey } from "./i18n";
import type { ExportSectionKey } from "./settings-types";

export const EXPORT_SECTION_LABEL_KEYS: Record<ExportSectionKey, TranslationKey> = {
  project: "exportLabelProject",
  tasks: "exportLabelTasks",
  raid: "exportLabelRaid",
  changes: "exportLabelChanges",
  milestones: "exportLabelMilestones",
  stakeholders: "exportLabelStakeholders",
  budgets: "exportLabelBudgets",
  resources: "exportLabelResources",
  roles: "exportLabelRoles",
  absences: "exportLabelAbsences",
  shifts: "exportLabelShifts",
  calendarEvents: "exportLabelCalendarEvents",
  status: "exportLabelStatus",
  knowledgeItems: "exportLabelKnowledgeItems",
  insights: "exportLabelInsights",
};
