"use client";
import { type Lang, t } from "./i18n";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { navLabelKey, type AppView } from "./nav-config";

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
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function ModernShell({
  lang, activeView, onNavigate, version, bannerCount, onNewTask, onShowAlerts,
  topBarMenus, sidebarFooter, tasksSection, workspace,
  collapsed = false, onToggleCollapsed = () => {},
}: ModernShellProps) {
  const title = t(lang, navLabelKey(activeView));
  const content = activeView === "open-points" ? tasksSection : workspace;
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar
        lang={lang}
        activeView={activeView}
        onNavigate={onNavigate}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
        version={version}
        footer={sidebarFooter}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          lang={lang}
          title={title}
          bannerCount={bannerCount}
          onNewTask={onNewTask}
          onShowAlerts={onShowAlerts}
        >
          {topBarMenus}
        </TopBar>
        <main className="min-h-0 flex-1 overflow-auto bg-surface-muted p-6 dark:bg-black">
          {content}
        </main>
      </div>
    </div>
  );
}
