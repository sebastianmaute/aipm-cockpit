"use client";
import { useCallback, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { NAV_GROUPS, navLabelKey, type AppView, type NavGroup, type NavItem } from "./nav-config";
import { NavIcon } from "./nav-icons";
import { CountBadge } from "./count-badge";
import { TOUR_ANCHORS } from "./app-tour";
import { PopoverPanel } from "./popover-panel";

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

/**
 * Collapsed-rail affordance for a parent that has sub-menu children (#35).
 * The icon rail can't show the accordion, so the children would be unreachable;
 * this makes the parent icon a popover trigger listing the parent itself + its
 * children as menuitems (roving arrows, Escape/outside-click dismiss — mirrors
 * the project-switcher menu). Palette-safe: light surface popover, elevation
 * via the sanctioned card-elevation token, brand focus ring.
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  const active = isParentActive(item, activeView);
  const label = t(lang, navLabelKey(item.view));
  const children = item.children ?? [];
  const childBadgeTotal = children.reduce((n, c) => n + (badges?.[c.view] ?? 0), 0);
  const rootBadge = (badges?.[item.view] ?? 0) + childBadgeTotal;
  // Parent view first, then children — every view stays reachable from the rail.
  const entries: AppView[] = [item.view, ...children.map((c) => c.view)];

  // ★★ Focus-on-open is `PopoverPanel`'s job now, and that is not a tidy-up: its
  // `.focus({ preventScroll: true })` is load-bearing here. A bare `.focus()` on
  // a menuitem inside the sidebar's `overflow-y-auto` box is what scrolled the
  // 64px rail sideways and sheared the flyout's labels. The panel's all-roving
  // fallback (`??` branch) is what lands focus at all — every menuitem below is
  // `tabIndex={-1}`, so the tab-stop selector matches nothing.
  function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    );
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      // ★★ Tab must RETURN FOCUS, unlike the pre-portal version which just
      // closed and let the browser continue from where the removed menuitem
      // sat. That worked while the menu was an `absolute` child of this `<li>`
      // — the next tab-stop was the following rail button. Portaled, the menu
      // is appended at the END of `document.body`, so resuming from there walks
      // straight out of the app into browser chrome (WCAG 2.4.3). Land on the
      // trigger and let the user's NEXT Tab carry on from the rail.
      case "Tab":
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
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
    <li className="relative">
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
          className="absolute right-1 top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-ui-medium-grey"
        />
      </button>
      {/* ★★★ PORTALED, and it has to be. `sidebar.tsx` wraps the nav in
          `overflow-y-auto`; CSS makes the other axis `auto` too, so that div is a
          64px-wide HORIZONTAL scroll box on the collapsed rail. The panel used to
          be `absolute left-full`, i.e. laid out at x 68..244 — outside the box,
          where z-index cannot reach — and the browser then scrolled the box
          sideways to reveal the focused menuitem, dragging the icon rail off
          screen and shearing every label. `PopoverPanel` renders it `fixed` on
          `document.body`, which no ancestor overflow can clip.
          ★ `role="menu"` stays on the INNER div, not on the panel: it carries
          `onMenuKeyDown`, and a React handler only sees events from its own
          subtree — putting the role on the panel would make the menu element and
          the key handler two different nodes. */}
      <PopoverPanel
        open={open}
        anchorRef={triggerRef}
        onClose={close}
        placement="right-start"
        className="min-w-44 p-1 shadow-[var(--shadow-card)]"
      >
        <div role="menu" aria-label={label} onKeyDown={onMenuKeyDown}>
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
                className={`flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm focus:outline-none focus:ring-2 focus:ring-ui-green ${
                  viewActive
                    ? "bg-surface-muted font-semibold text-ui-dark-blue dark:text-ui-light-grey"
                    : "text-foreground hover:bg-surface-muted"
                }`}
              >
                <NavIcon view={view} />
                <span>{t(lang, navLabelKey(view))}</span>
                {badge > 0 && <CountBadge variant="pink" aria-hidden className="ml-auto">{badge}</CountBadge>}
              </button>
            );
          })}
        </div>
      </PopoverPanel>
      {rootBadge > 0 && (
        // Collapsed urgency dot (the numeric pill only shows when expanded).
        <span
          aria-hidden
          className="pointer-events-none absolute right-2 top-1.5 h-2 w-2 rounded-full bg-ui-pink"
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
  const inactiveText = indent === "root" ? "text-ui-light-grey" : "text-ui-light-grey";
  const state = active
    ? "border-ui-green bg-ui-green/15 font-semibold text-ui-white"
    : `border-transparent ${inactiveText} hover:bg-ui-white/10 hover:text-ui-white`;
  return base + spacing + state;
}

export function SidebarNav({ lang, activeView, onNavigate, collapsed = false, navGroups, badges }: SidebarNavProps) {
  return (
    <nav aria-label={t(lang, "navPrimaryLabel")} className="flex flex-col gap-4 py-2">
      {(navGroups ?? NAV_GROUPS).map((group) => (
        <div key={group.labelKey}>
          {!collapsed && (
            <p className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ui-light-grey">
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
                      <CountBadge variant="pink" aria-hidden className="ml-auto">
                        {rootBadge}
                      </CountBadge>
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
                                <CountBadge variant="pink" aria-hidden className="ml-auto">
                                  {badges[child.view]}
                                </CountBadge>
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
