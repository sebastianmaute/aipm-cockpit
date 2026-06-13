import type { TranslationKey } from "./i18n";
import { isViewEnabled, type FeatureModuleId } from "./feature-modules";

// Superset of the popout tab union (POPOUT_TABS in broadcast-sync.ts). "open-points", "settings"
// and "edit" are main-window-only views. "edit" is reserved for Phase 2
// (full-page task editor) and intentionally has no nav entry yet.
export type AppView =
  | "projects"
  | "open-points"
  | "dashboard"
  | "actions"
  | "trends"
  | "history"
  | "chat"
  | "gantt"
  | "milestones"
  | "resources"
  | "directory"
  | "workload"
  | "calendar"
  | "planning"
  | "manage-roles"
  | "budget"
  | "budget-report"
  | "raid"
  | "raid-report"
  | "changes"
  | "change-report"
  | "stakeholders"
  | "raci"
  | "stakeholder-map"
  | "reports"
  | "activity"
  | "settings"
  | "edit";

export interface NavItem {
  view: AppView;
  children?: { view: AppView }[];
}

export interface NavGroup {
  labelKey: TranslationKey;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: "navPortfolio",
    items: [{ view: "projects" }],
  },
  {
    labelKey: "navGroupOverview",
    items: [{ view: "dashboard" }, { view: "actions" }, { view: "trends" }, { view: "history" }, { view: "open-points" }, { view: "chat" }],
  },
  {
    labelKey: "navGroupPlan",
    items: [
      { view: "gantt" },
      { view: "milestones" },
      {
        view: "resources",
        children: [
          { view: "directory" },
          { view: "workload" },
          { view: "calendar" },
          { view: "planning" },
          { view: "manage-roles" },
        ],
      },
      { view: "budget", children: [{ view: "budget-report" }] },
    ],
  },
  {
    labelKey: "navGroupRegisters",
    items: [
      { view: "raid", children: [{ view: "raid-report" }] },
      { view: "changes", children: [{ view: "change-report" }] },
      { view: "stakeholders", children: [{ view: "raci" }, { view: "stakeholder-map" }] },
      { view: "reports" },
    ],
  },
  {
    labelKey: "navGroupSystem",
    items: [{ view: "activity" }, { view: "settings" }],
  },
];

const LABEL_KEYS: Record<Exclude<AppView, "edit">, TranslationKey> = {
  projects: "navProjects",
  dashboard: "navDashboard",
  actions: "navActions",
  trends: "navTrends",
  history: "navHistory",
  "open-points": "navOpenPoints",
  chat: "tabChat",
  gantt: "tabGantt",
  milestones: "navMilestones",
  resources: "tabResources",
  directory: "resourcesViewDirectory",
  workload: "resourcesViewWorkload",
  calendar: "resourcesViewCalendar",
  planning: "resourcesViewPlanning",
  "manage-roles": "resourcesManageRoles",
  budget: "tabBudget",
  "budget-report": "budgetReportTitle",
  raid: "tabRaid",
  "raid-report": "raidReportTitle",
  changes: "navChanges",
  "change-report": "changeReportTitle",
  stakeholders: "navStakeholders",
  raci: "stakeholderRaciTitle",
  "stakeholder-map": "stakeholderMapTitle",
  reports: "tabReports",
  activity: "tabActivity",
  settings: "settings",
};

const ALL_NAV_VIEWS: AppView[] = NAV_GROUPS.flatMap((g) =>
  g.items.flatMap((item) => [item.view, ...(item.children ?? []).map((c) => c.view)]),
);

/** Flat list of all views that appear in the sidebar (excludes "edit"). */
export function allNavViews(): AppView[] {
  return ALL_NAV_VIEWS;
}

/** Views that are only reachable on a Turso backend. They are pruned from the
 *  nav when `storageKind !== "turso"` so they never render a dead tab on the
 *  file backend. "history" is gated this way (version history lives in Turso). */
const TURSO_ONLY_VIEWS: readonly AppView[] = ["history"];

/** NAV_GROUPS pruned to enabled views: disabled items and children removed,
 *  and any group left with no items dropped. Core views always survive.
 *  Turso-only views (see TURSO_ONLY_VIEWS) are additionally pruned unless the
 *  current storage backend is Turso. */
export function filterNavGroups(
  features: readonly FeatureModuleId[],
  storageKind?: string,
): NavGroup[] {
  const onTurso = storageKind === "turso";
  const keepView = (view: AppView): boolean =>
    isViewEnabled(view, features) && (onTurso || !TURSO_ONLY_VIEWS.includes(view));
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items
      .filter((item) => keepView(item.view))
      .map((item) => ({
        ...item,
        children: item.children
          ? item.children.filter((c) => keepView(c.view))
          : undefined,
      })),
  })).filter((group) => group.items.length > 0);
}

/** The sub-tab children of the nav section that contains `view` (matched as the
 *  section's own view OR one of its children). Empty when the section has no
 *  children. Drives the classic layout's secondary sub-tab row.
 *  When `features` is supplied, children are filtered to enabled views only. */
export function subTabsFor(
  view: AppView,
  features?: readonly FeatureModuleId[],
): readonly { view: AppView }[] {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      const contains =
        item.view === view || (item.children ?? []).some((c) => c.view === view);
      if (contains) {
        const children = item.children ?? [];
        return features ? children.filter((c) => isViewEnabled(c.view, features)) : children;
      }
    }
  }
  return [];
}

export function navLabelKey(view: AppView): TranslationKey {
  // The "edit" view (Phase 2 full-page editor) has no sidebar label and never
  // appears in NAV_GROUPS; give it a harmless valid key rather than masking it.
  if (view === "edit") return "navOpenPoints";
  return LABEL_KEYS[view];
}

export function viewToSlug(view: AppView): string {
  return view; // slugs are the view ids themselves
}

export function slugToView(slug: string): AppView {
  if (slug === "address-book") return "directory";
  if (slug === "resource-report") return "resources";
  const found = allNavViews().find((v) => viewToSlug(v) === slug);
  return found ?? "open-points";
}

/** Parse a URL hash into a view + optional trailing numeric item id.
 *  Forms: "#raid" -> {view:"raid", itemId:null}; "#raid/123" -> {itemId:123}. */
export function parseHash(raw: string): { view: AppView; itemId: number | null } {
  const stripped = raw.replace(/^#/, "");
  const slash = stripped.indexOf("/");
  const slug = slash === -1 ? stripped : stripped.slice(0, slash);
  const idPart = slash === -1 ? "" : stripped.slice(slash + 1);
  const view = slugToView(slug);
  const itemId = /^\d+$/.test(idPart) ? Number(idPart) : null;
  return { view, itemId };
}

/** Build a hash for a view, with an optional item id suffix. */
export function buildHash(view: AppView, itemId?: number | null): string {
  const slug = viewToSlug(view);
  return itemId != null ? `#${slug}/${itemId}` : `#${slug}`;
}
