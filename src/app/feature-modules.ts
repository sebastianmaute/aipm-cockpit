import { isIntegrationDisabled, type IntegrationId } from "./integration-switches";
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
  | "knowledge"
  | "timelog";

export interface FeatureModule {
  id: FeatureModuleId;
  labelKey: TranslationKey;
  descKey?: TranslationKey;
  /** Parent view + every child view this module owns. The parent view id equals the module id. */
  views: readonly AppView[];
  /** The addable report this module unlocks, if any. */
  report?: AddableReportId;
  /** Modules this one reads from. Informational only: turning this module on does not turn them on,
   *  but the Functions picker and the module's own view say what is off (§707). */
  uses?: readonly FeatureModuleId[];
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
  { id: "knowledge", labelKey: "navKnowledge", descKey: "knowledgeModuleDesc", views: ["knowledge"] },
  { id: "timelog", labelKey: "navTimelog", descKey: "timelogModuleDesc", views: ["timelog"], uses: ["resources", "budget"] },
] as const;

/** Views always present regardless of mode. */
export const CORE_VIEWS: readonly AppView[] = [
  "actions",
  "insights",
  "open-points",
  "chat",
  "reports",
  "activity",
  "settings",
  "help",
  // ★★ documents is core DELIBERATELY, not by fall-through. `isViewEnabled`
  //    returns true for any view no module claims, so omitting it here still
  //    showed the entry — but `enabledNavViews()` is CORE_VIEWS plus enabled
  //    module views, so the two disagreed about the same view. That divergence
  //    is inert today (no non-test caller of enabledNavViews) and is exactly
  //    what bites the next one.
  //    ★ NOT given its own FEATURE_MODULES entry: `sanitizeFeatures` migrates a
  //    stored module id "documents" → "knowledge" (the v0.190 rename), so a
  //    module by that name would be rewritten on load. A hideable Documents
  //    module is possible later under a different id.
  "documents",
] as const;

export const ALL_MODULE_IDS: readonly FeatureModuleId[] = FEATURE_MODULES.map((m) => m.id);

export type AppMode = "simple" | "modular" | "advanced";

/** The i18n key of each mode's badge label. ONE copy: the wizard, the Functions picker
 *  and the templates section all read it (it used to be pasted into each). */
export const MODE_LABEL_KEY = {
  simple: "modeSimple",
  modular: "modeModular",
  advanced: "modeAdvanced",
} as const satisfies Record<AppMode, TranslationKey>;

const MODULE_BY_ID = new Map<FeatureModuleId, FeatureModule>(
  FEATURE_MODULES.map((m) => [m.id, m]),
);

const VIEW_TO_MODULE = new Map<AppView, FeatureModuleId>(
  FEATURE_MODULES.flatMap((m) => m.views.map((v) => [v, m.id] as const)),
);

/** undefined (legacy, no key) -> all modules; a non-array (junk) -> []; arrays kept
 *  (incl. []), filtered to valid ids only, unique, in registry order.
 *  Legacy migration: the "documents" module was renamed to "knowledge" (v0.190);
 *  a stored `"documents"` id maps forward so an existing user's toggle survives. */
export function sanitizeFeatures(raw: unknown): FeatureModuleId[] {
  if (raw === undefined) return [...ALL_MODULE_IDS];
  if (!Array.isArray(raw)) return [];
  const wanted = new Set(raw.map((id) => (id === "documents" ? "knowledge" : id)));
  return ALL_MODULE_IDS.filter((id) => wanted.has(id));
}

export function deriveMode(features: readonly FeatureModuleId[]): AppMode {
  if (features.length === 0) return "simple";
  if (features.length >= ALL_MODULE_IDS.length) return "advanced";
  return "modular";
}

/** Set equality of two feature lists: order and duplicates do not count. Compares the
 *  Set SIZES, not the array lengths, so a list with a repeated id is not "different". */
export function sameFeatureSet(a: readonly FeatureModuleId[], b: readonly FeatureModuleId[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((id) => right.has(id));
}

/** §762 — modules that need a server-side integration, which a deployment can switch off
 *  (AIPM_DISABLED_INTEGRATIONS). Switched off, the module counts as off everywhere this file
 *  answers, while a project's stored `features` keep it: back on, it returns as it was. */
const MODULE_INTEGRATION: Partial<Record<FeatureModuleId, IntegrationId>> = { timelog: "timelog" };

/** The module needs an integration this deployment switched off. */
export function isModuleSwitchedOff(id: FeatureModuleId): boolean {
  const integration = MODULE_INTEGRATION[id];
  return integration !== undefined && isIntegrationDisabled(integration);
}

export function isModuleEnabled(id: FeatureModuleId, features: readonly FeatureModuleId[]): boolean {
  return features.includes(id) && !isModuleSwitchedOff(id);
}

/** The modules `id` declares it uses that are not in `features`, in declaration order.
 *  Empty when `id` declares none, or when `id` itself is off (nothing to warn about). */
export function missingUses(id: FeatureModuleId, features: readonly FeatureModuleId[]): FeatureModuleId[] {
  if (!features.includes(id)) return [];
  return (MODULE_BY_ID.get(id)?.uses ?? []).filter((u) => !features.includes(u));
}

export function moduleForView(view: AppView): FeatureModuleId | null {
  return VIEW_TO_MODULE.get(view) ?? null;
}

/** Views that are built but held back from the current release. No mode or module turns them
 *  on: `isViewEnabled` answers false for them, so the sidebar, the sub-tabs, hash links, the
 *  guided tour and the disabled-view redirect all treat them as off. Shipping one takes more than
 *  dropping it here: its user-facing text was cut too (docs/AGENTS/forecast.md, "HELD BACK"). */
export const RELEASE_HIDDEN_VIEWS: readonly AppView[] = ["forecast"];

export function isViewEnabled(view: AppView, features: readonly FeatureModuleId[]): boolean {
  if (RELEASE_HIDDEN_VIEWS.includes(view)) return false;
  const mod = VIEW_TO_MODULE.get(view);
  if (!mod) return true; // core view
  return isModuleEnabled(mod, features);
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
  const moduleViews = features.filter((id) => !isModuleSwitchedOff(id)).flatMap((id) => MODULE_BY_ID.get(id)?.views ?? []);
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
