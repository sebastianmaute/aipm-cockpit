"use client";
import { type Lang, t } from "./i18n";
import { SidebarNav } from "./sidebar-nav";
import type { AppView, NavGroup } from "./nav-config";

interface SidebarProps {
  lang: Lang;
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  version: string;
  onShowVersion: () => void;
  footer?: React.ReactNode;
  navGroups?: NavGroup[];
}

export function Sidebar({
  lang, activeView, onNavigate, collapsed, onToggleCollapsed, version, onShowVersion, footer, navGroups,
}: SidebarProps) {
  return (
    <aside
      className={
        "flex h-full flex-col bg-AIPM-dark-blue text-AIPM-white " +
        (collapsed ? "w-16" : "w-64")
      }
    >
      <div className="flex items-start justify-between gap-2 border-b border-AIPM-white/10 px-4 py-4">
        {!collapsed && (
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/AIPM-logo.svg" alt="Acme" className="h-6 w-auto brightness-0 invert" />
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-AIPM-green">
              {t(lang, "sidebarBrandSubtitle")}
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t(lang, "sidebarExpand") : t(lang, "sidebarCollapse")}
          title={collapsed ? t(lang, "sidebarExpand") : t(lang, "sidebarCollapse")}
          className="rounded-md p-1.5 text-AIPM-light-grey hover:bg-AIPM-white/10 hover:text-AIPM-white focus:outline-none focus:ring-2 focus:ring-AIPM-green"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={`h-4 w-4 transition-transform ${collapsed ? "rotate-180" : ""}`}>
            <path fillRule="evenodd" d="M12.78 5.22a.75.75 0 010 1.06L9.06 10l3.72 3.72a.75.75 0 11-1.06 1.06l-4.25-4.25a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 0z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <SidebarNav lang={lang} activeView={activeView} onNavigate={onNavigate} collapsed={collapsed} navGroups={navGroups} />
      </div>

      <div className="border-t border-AIPM-white/10 px-4 py-3 text-xs text-AIPM-medium-grey">
        {footer}
        {!collapsed && (
          <button
            type="button"
            onClick={onShowVersion}
            title={t(lang, "versionHistory")}
            className="mt-2 block w-full rounded text-left text-AIPM-medium-grey hover:text-AIPM-light-grey focus:outline-none focus:ring-2 focus:ring-AIPM-green"
          >
            {t(lang, "versionVersion")} {version}
          </button>
        )}
      </div>
    </aside>
  );
}
