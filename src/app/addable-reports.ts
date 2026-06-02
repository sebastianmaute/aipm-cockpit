import type { TranslationKey } from "./i18n";

/** The reports that can be appended into the Reports view, in render order. */
export const ADDABLE_REPORTS = [
  { id: "raid-report", titleKey: "raidReportTitle" },
  { id: "budget-report", titleKey: "budgetReportTitle" },
  { id: "resource-report", titleKey: "resourcesReportTitle" },
] as const satisfies ReadonlyArray<{ id: string; titleKey: TranslationKey }>;

export type AddableReportId = (typeof ADDABLE_REPORTS)[number]["id"];

/** Keep only valid, unique ids, returned in ADDABLE_REPORTS order. */
export function sanitizeExtraReports(input: unknown): AddableReportId[] {
  if (!Array.isArray(input)) return [];
  return ADDABLE_REPORTS.filter((r) => input.includes(r.id)).map((r) => r.id);
}
