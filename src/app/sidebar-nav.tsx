"use client";
import { useEffect, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { NAV_GROUPS, navLabelKey, type AppView, type NavGroup, type NavItem } from "./nav-config";
import { NavIcon } from "./nav-icons";
import { TOUR_ANCHORS } from "./app-tour";
import { usePopoverDismiss } from "./use-popover-dismiss";

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

const CHILD_BADGE_CLASS =
  "ml-auto inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-AIPM-pink px-1 text-[10px] font-semibold leading-none text-white";

/**
 * Collapsed-rail affordance for a parent that has sub-menu children (#35).
 * The icon rail can't show the accordion, so the children would be unreachable;
 * this makes the parent icon a popover trigger listing the parent itself + its
 * children as menuitems (roving arrows, Escape/outside-click dismiss — mirrors
 * the project-switcher menu). Palette-safe: light surface popover, shadow via
 * the `--shadow-card` token, brand focus ring.
 */
function CollapsedNavFlyout({
  lang,
  item,
  activeView,
  onNavigate,
  badges,
}: {
  lang: Lang;
  item: NavItem;
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  badges?: Partial<Record<AppView, number>>;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLLIElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, wrapRef, () => setOpen(false));

  const active = isParentActive(item, activeView);
  const label = t(lang, navLabelKey(item.view));
  const children = item.children ?? [];
  const childBadgeTotal = children.reduce((n, c) => n + (badges?.[c.view] ?? 0), 0);
  const rootBadge = (badges?.[item.view] ?? 0) + childBadgeTotal;
  // Parent view first, then children — every view stays reachable from the rail.
  const entries: AppView[] = [item.view, ...children.map((c) => c.view)];

  // Move focus into the menu on open (first menuitem).
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [open]);

  function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    );
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      case "Tab":
        setOpen(false);
        return;
      case "ArrowDown": next = i < 0 ? 0 : (i + 1) % items.length; break;
      case "ArrowUp": next = i < 0 ? items.length - 1 : (i - 1 + items.length) % items.length; break;
      case "Home": next = 0; break;
      case "End": next = items.length - 1; break;
      default: return;
    }
    e.preventDefault();
    items[next]?.focus();
  }

  return (
    <li ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={`${navItemClass(active, "root", true)} relative`}
      >
        <NavIcon view={item.view} />
        {/* "has children" affordance on the icon rail. */}
        <span
          aria-hidden
          className="absolute right-1 top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-AIPM-light-grey"
        />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="absolute left-full top-0 z-40 ml-1 min-w-44 rounded-md border border-line bg-surface p-1 shadow-[var(--shadow-card)]"
        >
          {entries.map((view) => {
            const viewActive = activeView === view;
            const badge = badges?.[view] ?? 0;
            return (
              <button
                key={view}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-current={viewActive ? "page" : undefined}
                onClick={() => {
                  onNavigate(view);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm focus:outline-none focus:ring-2 focus:ring-AIPM-green ${
                  viewActive
                    ? "bg-surface-muted font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey"
                    : "text-foreground hover:bg-surface-muted"
                }`}
              >
                <NavIcon view={view} />
                <span>{t(lang, navLabelKey(view))}</span>
                {badge > 0 && <span aria-hidden className={CHILD_BADGE_CLASS}>{badge}</span>}
              </button>
            );
          })}
        </div>
      )}
      {rootBadge > 0 && (
        // Collapsed urgency dot (the numeric pill only shows when expanded).
        <span
          aria-hidden
          className="pointer-events-none absolute right-2 top-1.5 h-2 w-2 rounded-full bg-AIPM-pink"
        />
      )}
    </li>
  );
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
              // Collapsed rail + has children → popover flyout so the children
              // (hidden accordion) stay reachable (#35).
              if (collapsed && !!item.children?.length) {
                return (
                  <CollapsedNavFlyout
                    key={item.view}
                    lang={lang}
                    item={item}
                    activeView={activeView}
                    onNavigate={onNavigate}
                    badges={badges}
                  />
                );
              }
              const active = activeView === item.view;
              const label = t(lang, navLabelKey(item.view));
              const showChildren = !collapsed && !!item.children?.length && isParentActive(item, activeView);
              // Parent badge bubbles up hidden children's counts so a nested
              // urgency signal (e.g. Next actions under Dashboard) stays visible
              // when the sub-menu is collapsed; when expanded it shows on the child.
              const childBadgeTotal = (item.children ?? []).reduce((n, c) => n + (badges?.[c.view] ?? 0), 0);
              const rootBadge = (badges?.[item.view] ?? 0) + (showChildren ? 0 : childBadgeTotal);
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
                    {!collapsed && rootBadge > 0 && (
                      <span aria-hidden className="ml-auto inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-AIPM-pink px-1 text-[10px] font-semibold leading-none text-white">
                        {rootBadge}
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
                              data-tour-id={NAV_TOUR_ID[child.view]}
                              className={navItemClass(childActive, "child", false)}
                            >
                              <NavIcon view={child.view} />
                              <span>{t(lang, navLabelKey(child.view))}</span>
                              {!!badges?.[child.view] && (
                                <span aria-hidden className="ml-auto inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-AIPM-pink px-1 text-[10px] font-semibold leading-none text-white">
                                  {badges[child.view]}
                                </span>
                              )}
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
