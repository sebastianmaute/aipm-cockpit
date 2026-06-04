"use client";
import { useState } from "react";
import { type Lang, t } from "./i18n";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { VersionInfoModal } from "./version-info";
import { navLabelKey, type AppView, type NavGroup } from "./nav-config";

interface ModernShellProps {
  lang: Lang;
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  version: string;
  bannerCount: number;
  onNewTask: () => void;
  onShowAlerts: () => void;
  topBarMenus: React.ReactNode;
  sidebarFooter: React.ReactNode;
  tasksSection: React.ReactNode;
  workspace: React.ReactNode;
  /** Phase 2: full-page task editor, shown when activeView === "edit". */
  editView?: React.ReactNode;
  editTitle?: string;
  editActions?: React.ReactNode;
  /** Phase 4B: full-page Settings, shown when activeView === "settings". */
  settingsView?: React.ReactNode;
  /** Phase 4C: reminder banners rendered at the top of <main>. */
  banners?: React.ReactNode;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  navGroups?: NavGroup[];
}

export function ModernShell({
  lang, activeView, onNavigate, version, bannerCount, onNewTask, onShowAlerts,
  topBarMenus, sidebarFooter, tasksSection, workspace,
  editView = null, editTitle = "", editActions = null,
  settingsView = null,
  banners = null,
  collapsed = false, onToggleCollapsed = () => {},
  navGroups,
}: ModernShellProps) {
  const [versionOpen, setVersionOpen] = useState(false);
  const isEditing = activeView === "edit";
  const isSettings = activeView === "settings";
  const title = isEditing ? editTitle : t(lang, navLabelKey(activeView));
  const content = isEditing
    ? editView
    : isSettings
      ? settingsView
      : activeView === "open-points"
        ? tasksSection
        : workspace;
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-muted pb-6 dark:bg-black">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-AIPM-green focus:px-3 focus:py-1.5 focus:text-sm focus:font-semibold focus:text-AIPM-white"
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
        footer={sidebarFooter}
        navGroups={navGroups}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          lang={lang}
          title={title}
          bannerCount={bannerCount}
          onNewTask={onNewTask}
          onShowAlerts={onShowAlerts}
          primaryAction={isEditing ? editActions : undefined}
          onToggleSidebar={onToggleCollapsed}
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
