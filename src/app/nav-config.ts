import type { TranslationKey } from "./i18n";

// Superset of the workspace/popout TopTab union. "open-points", "settings"
// and "edit" are main-window-only views. "edit" is reserved for Phase 2
// (full-page task editor) and intentionally has no nav entry yet.
export type AppView =
  | "open-points"
  | "chat"
  | "gantt"
  | "resources"
  | "directory"
  | "workload"
  | "calendar"
  | "planning"
  | "manage-roles"
  | "budget"
  | "raid"
  | "raid-report"
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
    labelKey: "navGroupOverview",
    items: [{ view: "open-points" }, { view: "chat" }],
  },
  {
    labelKey: "navGroupPlan",
    items: [
      { view: "gantt" },
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
      { view: "budget" },
    ],
  },
  {
    labelKey: "navGroupRegisters",
    items: [
      { view: "raid", children: [{ view: "raid-report" }] },
      { view: "reports" },
    ],
  },
  {
    labelKey: "navGroupSystem",
    items: [{ view: "activity" }, { view: "settings" }],
  },
];

const LABEL_KEYS: Record<Exclude<AppView, "edit">, TranslationKey> = {
  "open-points": "navOpenPoints",
  chat: "tabChat",
  gantt: "tabGantt",
  resources: "tabResources",
  directory: "resourcesViewDirectory",
  workload: "resourcesViewWorkload",
  calendar: "resourcesViewCalendar",
  planning: "resourcesViewPlanning",
  "manage-roles": "resourcesManageRoles",
  budget: "tabBudget",
  raid: "tabRaid",
  "raid-report": "raidReportTitle",
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
