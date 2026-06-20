"use client";
import { type Lang, t } from "./i18n";
import { NAV_GROUPS, navLabelKey, type AppView, type NavGroup, type NavItem } from "./nav-config";
import { NavIcon } from "./nav-icons";
import { TOUR_ANCHORS } from "./app-tour";

// Guided-tour spotlight anchors live on the matching nav buttons.
const NAV_TOUR_ID: Partial<Record<AppView, string>> = {
  "open-points": TOUR_ANCHORS.navTasks,
  actions: TOUR_ANCHORS.navActions,
};

interface SidebarNavProps {
  lang: Lang;
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  // When collapsed the sidebar is an icon-only rail: group headers and child
  // lists are hidden and item labels move to aria-label/title.
  collapsed?: boolean;
  /** Override the default NAV_GROUPS with a pre-filtered list. */
  navGroups?: NavGroup[];
  /** Optional per-view badge counts (e.g. urgent action count on "actions"). */
  badges?: Partial<Record<AppView, number>>;
}

function isParentActive(item: NavItem, active: AppView): boolean {
  if (item.view === active) return true;
  return (item.children ?? []).some((c) => c.view === active);
}

function navItemClass(active: boolean, indent: "root" | "child", collapsed: boolean): string {
  const base = "flex w-full items-center gap-2 border-l-2 text-left text-sm transition-colors ";
  const spacing = collapsed
    ? "justify-center px-0 py-2 "
    : indent === "root"
      ? "px-4 py-2 "
      : "py-1.5 pl-9 pr-4 ";
  const inactiveText = indent === "root" ? "text-AIPM-light-grey" : "text-AIPM-light-grey";
  const state = active
    ? "border-AIPM-green bg-AIPM-green/15 font-semibold text-AIPM-white"
    : `border-transparent ${inactiveText} hover:bg-AIPM-white/10 hover:text-AIPM-white`;
  return base + spacing + state;
}

export function SidebarNav({ lang, activeView, onNavigate, collapsed = false, navGroups, badges }: SidebarNavProps) {
  return (
    <nav aria-label={t(lang, "navPrimaryLabel")} className="flex flex-col gap-4 py-2">
      {(navGroups ?? NAV_GROUPS).map((group) => (
        <div key={group.labelKey}>
          {!collapsed && (
            <p className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-AIPM-light-grey">
              {t(lang, group.labelKey)}
            </p>
          )}
          <ul role="list">
            {group.items.map((item) => {
              const active = activeView === item.view;
              const label = t(lang, navLabelKey(item.view));
              const showChildren = !collapsed && !!item.children?.length && isParentActive(item, activeView);
              return (
                <li key={item.view}>
                  <button
                    type="button"
                    onClick={() => onNavigate(item.view)}
                    aria-current={active ? "page" : undefined}
                    aria-label={collapsed ? label : undefined}
                    title={collapsed ? label : undefined}
                    data-tour-id={NAV_TOUR_ID[item.view]}
                    className={navItemClass(active, "root", collapsed)}
                  >
                    <NavIcon view={item.view} />
                    {!collapsed && <span>{label}</span>}
                    {!collapsed && !!badges?.[item.view] && (
                      <span aria-hidden className="ml-auto inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-AIPM-pink px-1 text-[10px] font-semibold leading-none text-white">
                        {badges[item.view]}
                      </span>
                    )}
                  </button>
                  {showChildren && (
                    <ul role="list">
                      {(item.children ?? []).map((child) => {
                        const childActive = activeView === child.view;
                        return (
                          <li key={child.view}>
                            <button
                              type="button"
                              onClick={() => onNavigate(child.view)}
                              aria-current={childActive ? "page" : undefined}
                              className={navItemClass(childActive, "child", false)}
                            >
                              <NavIcon view={child.view} />
                              <span>{t(lang, navLabelKey(child.view))}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
