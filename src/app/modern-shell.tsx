"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { VersionInfoModal } from "./version-info";
import { navLabelKey, type AppView, type NavGroup } from "./nav-config";
import { type AppMode } from "./feature-modules";
import { type ProjectSwitcherProps } from "./project-switcher";
import { useMediaQuery } from "./use-media-query";
import { SIDEBAR_NARROW_QUERY } from "./use-sidebar-collapsed";
import { useFocusTrap } from "./use-focus-trap";

interface ModernShellProps {
  lang: Lang;
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  version: string;
  mode: AppMode;
  bannerCount: number;
  onShowAlerts: () => void;
  onOpenAiAssistant?: () => void;
  /** Rendered at the LEFT edge of the TopBar's action cluster (global search). */
  search?: React.ReactNode;
  topBarMenus: React.ReactNode;
  sidebarFooter: React.ReactNode;
  tasksSection: React.ReactNode;
  workspace: React.ReactNode;
  /** Phase 2: full-page task editor, shown when activeView === "edit". */
  editView?: React.ReactNode;
  editTitle?: string;
  /** Phase 4B: full-page Settings, shown when activeView === "settings". */
  settingsView?: React.ReactNode;
  /** Settings-launched learning insights, shown when activeView === "learning-insights". */
  learningInsightsView?: React.ReactNode;
  /** Phase 4C: reminder banners rendered at the top of <main>. */
  banners?: React.ReactNode;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  navGroups?: NavGroup[];
  /** Optional per-view badge counts shown in the sidebar (e.g. urgent action count). */
  navBadges?: Partial<Record<AppView, number>>;
  /** When set, renders the current-project indicator + switcher in the TopBar. */
  projectSwitcher?: ProjectSwitcherProps;
  /** Rendered in the TopBar's left cluster beside the project switcher (Ask-Claude). */
  projectSwitcherTrailing?: React.ReactNode;
}

export function ModernShell({
  lang, activeView, onNavigate, version, mode, bannerCount, onShowAlerts,
  onOpenAiAssistant,
  search = null,
  topBarMenus, sidebarFooter, tasksSection, workspace,
  editView = null, editTitle = "",
  settingsView = null,
  learningInsightsView = null,
  banners = null,
  collapsed = false, onToggleCollapsed = () => {},
  navGroups,
  navBadges,
  projectSwitcher,
  projectSwitcherTrailing,
}: ModernShellProps) {
  const [versionOpen, setVersionOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  // Track the last-focused view rather than a mounted boolean so the guard is
  // idempotent under StrictMode's dev double-invoke of mount effects (a boolean
  // flag flips on the first run and focuses on the second, defeating the
  // no-focus-on-load intent). Seeding the ref to the initial view means the
  // first commit is a no-op and focus only moves on a genuine view CHANGE.
  const focusedViewRef = useRef<AppView>(activeView);
  // Move keyboard focus to the main content region on view change so keyboard
  // and screen-reader users follow the swapped content instead of staying
  // parked on the sidebar nav item (WCAG 2.4.3 focus order). Never yanks focus
  // on load / fights the skip link (seeded ref); uses `preventScroll` so a
  // deep-link row-flash scroll (use-deeplink-row-flash) isn't disturbed. Focus
  // on a `tabIndex={-1}` container is a permitted DOM side-effect (not setState)
  // — no set-state-in-effect violation.
  useEffect(() => {
    if (focusedViewRef.current === activeView) return;
    focusedViewRef.current = activeView;
    mainRef.current?.focus({ preventScroll: true });
  }, [activeView]);

  // Mobile off-canvas drawer (#25): below the sidebar breakpoint the in-flow
  // icon rail is replaced by an off-canvas drawer — the hamburger opens the
  // EXPANDED sidebar as an overlay with a backdrop + focus trap; Escape /
  // backdrop / navigation close it. Desktop keeps the in-flow collapse rail.
  const isNarrow = useMediaQuery(SIDEBAR_NARROW_QUERY);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  useFocusTrap(drawerRef, isNarrow && drawerOpen, closeDrawer);
  const handleToggleSidebar = () => {
    if (isNarrow) setDrawerOpen((o) => !o);
    else onToggleCollapsed();
  };
  const navigateAndCloseDrawer = (view: AppView) => {
    onNavigate(view);
    setDrawerOpen(false);
  };
  const renderSidebar = (
    collapsedValue: boolean,
    onToggle: () => void,
    onNav: (view: AppView) => void,
  ) => (
    <Sidebar
      lang={lang}
      activeView={activeView}
      onNavigate={onNav}
      collapsed={collapsedValue}
      onToggleCollapsed={onToggle}
      version={version}
      onShowVersion={() => setVersionOpen(true)}
      mode={mode}
      footer={sidebarFooter}
      navGroups={navGroups}
      navBadges={navBadges}
    />
  );

  const isEditing = activeView === "edit";
  const isSettings = activeView === "settings";
  const isLearningInsights = activeView === "learning-insights";
  const title = isEditing ? editTitle : t(lang, navLabelKey(activeView));
  const content = isEditing
    ? editView
    : isSettings
      ? settingsView
      : isLearningInsights
        ? learningInsightsView
        : activeView === "open-points"
          ? tasksSection
          : workspace;
  return (
    <div className="flex h-screen w-full overflow-hidden bg-surface-muted pb-6 dark:bg-black">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-AIPM-green focus:px-3 focus:py-1.5 focus:text-sm focus:font-semibold focus:text-AIPM-dark-blue"
      >
        {t(lang, "skipToContent")}
      </a>
      {isNarrow
        ? drawerOpen && (
            <>
              <div
                className="fixed inset-0 z-40 bg-AIPM-dark-blue/50"
                aria-hidden="true"
                onClick={closeDrawer}
              />
              <div
                ref={drawerRef}
                role="dialog"
                aria-modal="true"
                aria-label={t(lang, "navPrimaryLabel")}
                className="fixed inset-y-0 left-0 z-50"
              >
                {renderSidebar(false, closeDrawer, navigateAndCloseDrawer)}
              </div>
            </>
          )
        : renderSidebar(collapsed, onToggleCollapsed, onNavigate)}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          lang={lang}
          title={title}
          bannerCount={bannerCount}
          onShowAlerts={onShowAlerts}
          onOpenAiAssistant={onOpenAiAssistant}
          onToggleSidebar={handleToggleSidebar}
          projectSwitcher={projectSwitcher}
          projectSwitcherTrailing={projectSwitcherTrailing}
          search={search}
        >
          {topBarMenus}
        </TopBar>
        {/*
          Announce the active view to screen readers on navigation. Only
          `aria-current` moves on the nav item otherwise, which SR users don't
          hear when the main content swaps. A polite live region keyed to the
          view title updates on every view change (no focus steal, so it's safe
          while typing). Uses the same `title` label the TopBar already shows.
        */}
        <div className="sr-only" role="status" aria-live="polite">
          {title}
        </div>
        <main id="main-content" ref={mainRef} tabIndex={-1} className="min-h-0 flex-1 overflow-auto bg-surface-muted px-6 pt-6 outline-none focus:outline-none dark:bg-black">
          {banners}
          {content}
        </main>
      </div>
      <VersionInfoModal lang={lang} open={versionOpen} onClose={() => setVersionOpen(false)} />
    </div>
  );
}
