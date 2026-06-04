import type { AppView } from "./nav-config";
import type { AddableReportId } from "./addable-reports";
import type { TranslationKey } from "./i18n";

export type FeatureModuleId =
  | "dashboard"
  | "trends"
  | "gantt"
  | "milestones"
  | "resources"
  | "budget"
  | "raid"
  | "changes"
  | "stakeholders";

export interface FeatureModule {
  id: FeatureModuleId;
  labelKey: TranslationKey;
  /** Parent view + every child view this module owns. The parent view id equals the module id. */
  views: AppView[];
  /** The addable report this module unlocks, if any. */
  report?: AddableReportId;
}

export const FEATURE_MODULES: readonly FeatureModule[] = [
  { id: "dashboard", labelKey: "navDashboard", views: ["dashboard"] },
  { id: "trends", labelKey: "navTrends", views: ["trends"] },
  { id: "gantt", labelKey: "tabGantt", views: ["gantt"] },
  { id: "milestones", labelKey: "navMilestones", views: ["milestones"] },
  {
    id: "resources",
    labelKey: "tabResources",
    views: ["resources", "directory", "workload", "calendar", "planning", "manage-roles"],
    report: "resource-report",
  },
  { id: "budget", labelKey: "tabBudget", views: ["budget", "budget-report"], report: "budget-report" },
  { id: "raid", labelKey: "tabRaid", views: ["raid", "raid-report"], report: "raid-report" },
  { id: "changes", labelKey: "navChanges", views: ["changes", "change-report"] },
  {
    id: "stakeholders",
    labelKey: "navStakeholders",
    views: ["stakeholders", "raci", "stakeholder-map"],
    report: "stakeholder-report",
  },
] as const;

/** Views always present regardless of mode. */
export const CORE_VIEWS: readonly AppView[] = [
  "open-points",
  "chat",
  "reports",
  "activity",
  "settings",
  "edit",
] as const;

export const ALL_MODULE_IDS: readonly FeatureModuleId[] = FEATURE_MODULES.map((m) => m.id);

export type AppMode = "simple" | "modular" | "advanced";

const MODULE_BY_ID = new Map<FeatureModuleId, FeatureModule>(
  FEATURE_MODULES.map((m) => [m.id, m]),
);

const VIEW_TO_MODULE = new Map<AppView, FeatureModuleId>(
  FEATURE_MODULES.flatMap((m) => m.views.map((v) => [v, m.id] as const)),
);

/** undefined (legacy, no key) -> all modules; arrays kept (incl. []), filtered to valid ids in registry order. */
export function sanitizeFeatures(raw: unknown): FeatureModuleId[] {
  if (raw === undefined) return [...ALL_MODULE_IDS];
  if (!Array.isArray(raw)) return [];
  const wanted = new Set(raw);
  return ALL_MODULE_IDS.filter((id) => wanted.has(id));
}

export function deriveMode(features: readonly FeatureModuleId[]): AppMode {
  if (features.length === 0) return "simple";
  if (features.length >= ALL_MODULE_IDS.length) return "advanced";
  return "modular";
}

export function isModuleEnabled(id: FeatureModuleId, features: readonly FeatureModuleId[]): boolean {
  return features.includes(id);
}

export function moduleForView(view: AppView): FeatureModuleId | null {
  return VIEW_TO_MODULE.get(view) ?? null;
}

export function isViewEnabled(view: AppView, features: readonly FeatureModuleId[]): boolean {
  const mod = VIEW_TO_MODULE.get(view);
  if (!mod) return true; // core view
  return features.includes(mod);
}

export function enabledNavViews(features: readonly FeatureModuleId[]): AppView[] {
  const core = CORE_VIEWS.filter((v) => v !== "edit" && v !== "settings");
  const moduleViews = features.flatMap((id) => MODULE_BY_ID.get(id)?.views ?? []);
  return [...core, ...moduleViews];
}

export function reportForModule(id: FeatureModuleId): AddableReportId | null {
  return MODULE_BY_ID.get(id)?.report ?? null;
}

/** Filter a stored extra-reports list to those whose owning module is enabled. */
export function visibleReports(
  extra: readonly AddableReportId[],
  features: readonly FeatureModuleId[],
): AddableReportId[] {
  const enabledReports = new Set(
    features.map((id) => MODULE_BY_ID.get(id)?.report).filter((r): r is AddableReportId => !!r),
  );
  return extra.filter((id) => enabledReports.has(id));
}
