"use client";
import { ChevronDownIcon } from "./icons";
import { type Lang, t } from "./i18n";
import { SidebarNav } from "./sidebar-nav";
import type { AppView, NavGroup } from "./nav-config";
import { type AppMode } from "./feature-modules";
import { useSettings } from "./use-settings";

const SIDEBAR_MODE_LABEL: Record<AppMode, "modeSimple" | "modeModular" | "modeAdvanced"> = {
  simple: "modeSimple",
  modular: "modeModular",
  advanced: "modeAdvanced",
};

interface SidebarProps {
  lang: Lang;
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  version: string;
  onShowVersion: () => void;
  mode: AppMode;
  footer?: React.ReactNode;
  navGroups?: NavGroup[];
  /** Optional per-view badge counts passed through to SidebarNav. */
  navBadges?: Partial<Record<AppView, number>>;
  /** Overrides the toggle button's accessible name. Used by the mobile drawer,
   *  where the toggle acts as the dialog's Close (not collapse). */
  toggleAriaLabel?: string;
}

export function Sidebar({
  lang, activeView, onNavigate, collapsed, onToggleCollapsed, version, onShowVersion, mode, footer, navGroups, navBadges, toggleAriaLabel,
}: SidebarProps) {
  const { settings } = useSettings();
  const brandLogo = settings.branding?.logo;
  const brandSlogan = settings.branding?.slogan?.trim();
  return (
    <aside
      className={
        "flex h-full flex-col bg-ui-dark-blue text-ui-white " +
        (collapsed ? "w-16" : "w-64")
      }
    >
      {!collapsed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={brandLogo || "/ai-pm-cockpit-banner.svg"}
          alt={brandLogo ? (brandSlogan ?? t(lang, "appTitle")) : t(lang, "appTitle")}
          // The classic header's 300×70 logo box, scaled to the expanded
          // sidebar's full width: edge to edge (no row padding) at the same
          // 300:70 aspect, so 256px wide and ~60px tall. Width and aspect are
          // both definite because the default SVG has no intrinsic size. A
          // custom upload letterboxes via object-contain. The banner is
          // full-colour with its own dark ground, so no brightness-0 invert.
          className="block aspect-[300/70] w-full object-contain"
        />
      )}
      <div className="flex items-center justify-between gap-2 border-b border-ui-white/10 px-4 py-2.5">
        {!collapsed && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ui-green">
              {brandSlogan || t(lang, "sidebarBrandSubtitle")}
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={toggleAriaLabel ?? (collapsed ? t(lang, "sidebarExpand") : t(lang, "sidebarCollapse"))}
          title={toggleAriaLabel ?? (collapsed ? t(lang, "sidebarExpand") : t(lang, "sidebarCollapse"))}
          className="rounded-md p-1.5 text-ui-light-grey hover:bg-ui-white/10 hover:text-ui-white focus:outline-none focus:ring-2 focus:ring-ui-green"
        >
          <ChevronDownIcon aria-hidden="true" className={`h-4 w-4 transition-transform ${collapsed ? "rotate-180" : ""}`} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <SidebarNav lang={lang} activeView={activeView} onNavigate={onNavigate} collapsed={collapsed} navGroups={navGroups} badges={navBadges} />
      </div>

      <div className="border-t border-ui-white/10 px-4 py-3 text-xs text-ui-light-grey">
        {footer}
        {!collapsed && (
          <span
            data-testid="sidebar-mode-badge"
            className="mb-2 inline-block rounded-full bg-ui-green/15 px-2.5 py-0.5 text-[11px] font-semibold text-ui-light-grey"
          >
            {t(lang, SIDEBAR_MODE_LABEL[mode])}
          </span>
        )}
        {!collapsed && (
          <button
            type="button"
            onClick={onShowVersion}
            title={t(lang, "versionHistory")}
            className="mt-2 block w-full rounded text-left text-ui-light-grey hover:text-ui-light-grey focus:outline-none focus:ring-2 focus:ring-ui-green"
          >
            {t(lang, "versionVersion")} {version}
          </button>
        )}
      </div>
    </aside>
  );
}
