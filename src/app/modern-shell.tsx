"use client";
import { useState } from "react";
import { type Lang, t } from "./i18n";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { VersionInfoModal } from "./version-info";
import { navLabelKey, type AppView, type NavGroup } from "./nav-config";
import { type AppMode } from "./feature-modules";
import { type ProjectSwitcherProps } from "./project-switcher";

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
      <Sidebar
        lang={lang}
        activeView={activeView}
        onNavigate={onNavigate}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
        version={version}
        onShowVersion={() => setVersionOpen(true)}
        mode={mode}
        footer={sidebarFooter}
        navGroups={navGroups}
        navBadges={navBadges}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          lang={lang}
          title={title}
          bannerCount={bannerCount}
          onShowAlerts={onShowAlerts}
          onOpenAiAssistant={onOpenAiAssistant}
          onToggleSidebar={onToggleCollapsed}
          projectSwitcher={projectSwitcher}
          projectSwitcherTrailing={projectSwitcherTrailing}
          search={search}
        >
          {topBarMenus}
        </TopBar>
        <main id="main-content" className="min-h-0 flex-1 overflow-auto bg-surface-muted px-6 pt-6 dark:bg-black">
          {banners}
          {content}
        </main>
      </div>
      <VersionInfoModal lang={lang} open={versionOpen} onClose={() => setVersionOpen(false)} />
    </div>
  );
}
