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
  | "stakeholders"
  | "history"
  | "documents"
  | "timelog";

export interface FeatureModule {
  id: FeatureModuleId;
  labelKey: TranslationKey;
  descKey?: TranslationKey;
  /** Parent view + every child view this module owns. The parent view id equals the module id. */
  views: readonly AppView[];
  /** The addable report this module unlocks, if any. */
  report?: AddableReportId;
}

export const FEATURE_MODULES: readonly FeatureModule[] = [
  { id: "dashboard", labelKey: "navDashboard", descKey: "dashboardModuleDesc", views: ["dashboard"] },
  { id: "trends", labelKey: "navTrends", descKey: "trendsModuleDesc", views: ["trends"] },
  { id: "gantt", labelKey: "tabGantt", descKey: "ganttModuleDesc", views: ["gantt"] },
  { id: "milestones", labelKey: "navMilestones", descKey: "milestonesModuleDesc", views: ["milestones"] },
  {
    id: "resources",
    labelKey: "tabResources",
    descKey: "resourcesModuleDesc",
    views: ["resources", "directory", "workload", "calendar", "planning", "manage-roles"],
    report: "resource-report",
  },
  { id: "budget", labelKey: "tabBudget", descKey: "budgetModuleDesc", views: ["budget", "budget-report"], report: "budget-report" },
  { id: "raid", labelKey: "tabRaid", descKey: "raidModuleDesc", views: ["raid", "raid-report"], report: "raid-report" },
  { id: "changes", labelKey: "navChanges", descKey: "changesModuleDesc", views: ["changes", "change-report"] },
  {
    id: "stakeholders",
    labelKey: "navStakeholders",
    descKey: "stakeholdersModuleDesc",
    views: ["stakeholders", "raci", "stakeholder-map"],
    report: "stakeholder-report",
  },
  { id: "history", labelKey: "navHistory", descKey: "historyModuleDesc", views: ["history"] },
  { id: "documents", labelKey: "navDocuments", descKey: "documentsModuleDesc", views: ["documents"] },
  { id: "timelog", labelKey: "navTimelog", descKey: "timelogModuleDesc", views: ["timelog"] },
] as const;

/** Views always present regardless of mode. */
export const CORE_VIEWS: readonly AppView[] = [
  "actions",
  "open-points",
  "chat",
  "reports",
  "activity",
  "settings",
  "help",
] as const;

export const ALL_MODULE_IDS: readonly FeatureModuleId[] = FEATURE_MODULES.map((m) => m.id);

export type AppMode = "simple" | "modular" | "advanced";

const MODULE_BY_ID = new Map<FeatureModuleId, FeatureModule>(
  FEATURE_MODULES.map((m) => [m.id, m]),
);

const VIEW_TO_MODULE = new Map<AppView, FeatureModuleId>(
  FEATURE_MODULES.flatMap((m) => m.views.map((v) => [v, m.id] as const)),
);

/** undefined (legacy, no key) -> all modules; a non-array (junk) -> []; arrays kept
 *  (incl. []), filtered to valid ids only, unique, in registry order. */
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

/** Where the app should land when the active view's module is disabled (e.g.
 *  after a Save+reload into Simple mode, or a stale hash). Enabled views are
 *  kept as-is; otherwise prefer the dashboard when its module is on, falling
 *  back to "chat" in popouts and the classic layout (avoids a double-hop via
 *  the classic-fallback effect) and "open-points" in the modern layout. */
export function disabledViewRedirect(
  active: AppView,
  features: readonly FeatureModuleId[],
  layout: "modern" | "classic",
  isPopout: boolean,
): AppView {
  if (isViewEnabled(active, features)) return active;
  const fallback = isPopout || layout === "classic" ? "chat" : "open-points";
  return isModuleEnabled("dashboard", features) ? "dashboard" : fallback;
}

/** Views to render in navigation: core sidebar views (excluding the non-navigable
 *  `settings`, which is reached by other means) plus every enabled module's views. */
export function enabledNavViews(features: readonly FeatureModuleId[]): AppView[] {
  const core = CORE_VIEWS.filter((v) => v !== "settings");
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
