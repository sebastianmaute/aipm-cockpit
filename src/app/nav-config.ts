import type { TranslationKey } from "./i18n";

// Superset of the workspace/popout TopTab union. "open-points", "settings"
// and "edit" are main-window-only views. "edit" is reserved for Phase 2
// (full-page task editor) and intentionally has no nav entry yet.
export type AppView =
  | "open-points"
  | "chat"
  | "gantt"
  | "resources"
  | "address-book"
  | "resource-report"
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
        children: [{ view: "address-book" }, { view: "resource-report" }],
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
  "address-book": "resourcesAddressBookTitle",
  "resource-report": "resourcesReportTitle",
  budget: "tabBudget",
  raid: "tabRaid",
  "raid-report": "raidReportTitle",
  reports: "tabReports",
  activity: "tabActivity",
  settings: "settings",
};

export function navLabelKey(view: AppView): TranslationKey {
  return LABEL_KEYS[view as Exclude<AppView, "edit">] ?? "navOpenPoints";
}

/** Flat list of all views that appear in the sidebar (excludes "edit"). */
export function allNavViews(): AppView[] {
  const out: AppView[] = [];
  for (const g of NAV_GROUPS) {
    for (const item of g.items) {
      out.push(item.view);
      for (const child of item.children ?? []) out.push(child.view);
    }
  }
  return out;
}

export function viewToSlug(view: AppView): string {
  return view; // slugs are the view ids themselves
}

export function slugToView(slug: string): AppView {
  const found = allNavViews().find((v) => viewToSlug(v) === slug);
  return found ?? "open-points";
}
