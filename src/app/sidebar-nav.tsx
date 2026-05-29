"use client";
import { type Lang, t } from "./i18n";
import { NAV_GROUPS, navLabelKey, type AppView, type NavItem } from "./nav-config";

interface SidebarNavProps {
  lang: Lang;
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  collapsed?: boolean;
}

function isParentActive(item: NavItem, active: AppView): boolean {
  if (item.view === active) return true;
  return (item.children ?? []).some((c) => c.view === active);
}

export function SidebarNav({ lang, activeView, onNavigate, collapsed = false }: SidebarNavProps) {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-4 py-2">
      {NAV_GROUPS.map((group) => (
        <div key={group.labelKey}>
          {!collapsed && (
            <p className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-AIPM-medium-grey">
              {t(lang, group.labelKey)}
            </p>
          )}
          <ul>
            {group.items.map((item) => {
              const active = activeView === item.view;
              const showChildren = !collapsed && !!item.children?.length && isParentActive(item, activeView);
              return (
                <li key={item.view}>
                  <button
                    type="button"
                    onClick={() => onNavigate(item.view)}
                    aria-current={active ? "page" : undefined}
                    className={
                      "flex w-full items-center gap-2 border-l-2 px-4 py-2 text-left text-sm transition-colors " +
                      (active
                        ? "border-AIPM-green bg-AIPM-green/15 font-semibold text-AIPM-white"
                        : "border-transparent text-AIPM-light-grey hover:bg-AIPM-white/10 hover:text-AIPM-white")
                    }
                  >
                    {t(lang, navLabelKey(item.view))}
                  </button>
                  {showChildren && (
                    <ul>
                      {item.children!.map((child) => {
                        const childActive = activeView === child.view;
                        return (
                          <li key={child.view}>
                            <button
                              type="button"
                              onClick={() => onNavigate(child.view)}
                              aria-current={childActive ? "page" : undefined}
                              className={
                                "flex w-full items-center gap-2 border-l-2 py-1.5 pl-9 pr-4 text-left text-sm transition-colors " +
                                (childActive
                                  ? "border-AIPM-green bg-AIPM-green/15 font-semibold text-AIPM-white"
                                  : "border-transparent text-AIPM-medium-grey hover:bg-AIPM-white/10 hover:text-AIPM-white")
                              }
                            >
                              {t(lang, navLabelKey(child.view))}
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
