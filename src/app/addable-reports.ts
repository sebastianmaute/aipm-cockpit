import type { TranslationKey } from "./i18n";

/** The reports that can be appended into the Reports view, in render order. */
export const ADDABLE_REPORTS = [
  { id: "raid-report", titleKey: "raidReportTitle" },
  { id: "budget-report", titleKey: "budgetReportTitle" },
  { id: "resource-report", titleKey: "resourcesReportTitle" },
] as const satisfies ReadonlyArray<{ id: string; titleKey: TranslationKey }>;

export type AddableReportId = (typeof ADDABLE_REPORTS)[number]["id"];

/** Reports shown by default for a fresh install (no persisted choice yet). */
export const DEFAULT_EXTRA_REPORTS: AddableReportId[] = ["raid-report", "budget-report"];

/** Keep only valid, unique ids, returned in ADDABLE_REPORTS order. */
export function sanitizeExtraReports(input: unknown): AddableReportId[] {
  if (!Array.isArray(input)) return [];
  return ADDABLE_REPORTS.filter((r) => input.includes(r.id)).map((r) => r.id);
}

/**
 * Resolve the extra-reports list while loading persisted settings.
 *
 * Distinguishes "never set" from "explicitly emptied":
 * - `undefined` (legacy settings with no `reports` key) → the defaults, so
 *   the RAID + Budget reports appear.
 * - any array (including `[]`) → sanitized as-is, so a user who removed a
 *   report keeps that exact choice and the default does not re-add it.
 */
export function resolveExtraReports(input: unknown): AddableReportId[] {
  if (input === undefined) return [...DEFAULT_EXTRA_REPORTS];
  return sanitizeExtraReports(input);
}
