"use client";
import { Bars3Icon, BellIcon, ChatBubbleLeftRightIcon } from "@heroicons/react/24/outline";
import { type Lang, t } from "./i18n";
import { ProjectSwitcher, type ProjectSwitcherProps } from "./project-switcher";
import { CountBadge } from "./count-badge";
import { IconButton } from "./icon-button";

interface TopBarProps {
  lang: Lang;
  title: string;
  bannerCount: number;
  onShowAlerts: () => void;
  /** Opens the AI Assistant chat pop-out. */
  onOpenAiAssistant?: () => void;
  /** When set, replaces the default New-task button (e.g. Save/Cancel while editing). */
  primaryAction?: React.ReactNode;
  /** When set, renders a leading menu button that toggles the sidebar. */
  onToggleSidebar?: () => void;
  /** When set, renders the current-project indicator + switcher near the title. */
  projectSwitcher?: ProjectSwitcherProps;
  /** Rendered in the LEFT cluster immediately after the project switcher (e.g. the
   *  Ask-Claude menu, which the user expects beside the project dropdown). */
  projectSwitcherTrailing?: React.ReactNode;
  /** Rendered at the LEFT edge of the right (action) cluster, before the icon
   *  buttons — the global search box sits here so it reads as a single control
   *  ahead of the icons rather than wedged between them. */
  search?: React.ReactNode;
  /** Menu components (Export/Help/Version/Settings/Voice) rendered as-is. */
  children?: React.ReactNode;
}

export function TopBar({ lang, title, bannerCount, onShowAlerts, onOpenAiAssistant, primaryAction, onToggleSidebar, projectSwitcher, projectSwitcherTrailing, search, children }: TopBarProps) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-line bg-surface px-6 py-3">
      <div className="flex min-w-0 items-center gap-3">
        {onToggleSidebar && (
          <IconButton
            size="md"
            label={t(lang, "sidebarMenuButton")}
            title={t(lang, "sidebarMenuButton")}
            onClick={onToggleSidebar}
          >
            <Bars3Icon aria-hidden="true" className="h-5 w-5" />
          </IconButton>
        )}
        <h1 className="truncate text-xl font-semibold tracking-tight text-ui-dark-blue dark:text-ui-light-grey">
          {title}
        </h1>
        {projectSwitcher && <ProjectSwitcher {...projectSwitcher} />}
        {projectSwitcherTrailing}
      </div>
      <div className="flex items-center gap-1">
        {search}
        {onOpenAiAssistant && (
          <IconButton
            size="md"
            label={t(lang, "openAiAssistant")}
            title={t(lang, "openAiAssistant")}
            onClick={onOpenAiAssistant}
          >
            <ChatBubbleLeftRightIcon aria-hidden="true" className="h-5 w-5" />
          </IconButton>
        )}
        {primaryAction}
        {/* `relative` is load-bearing: the CountBadge below is absolutely
            positioned against THIS button, so it must stay the containing block. */}
        <IconButton
          size="md"
          className="relative"
          label={t(lang, "showDueAlerts")}
          title={t(lang, "showDueAlerts")}
          onClick={onShowAlerts}
        >
          <BellIcon aria-hidden="true" className="h-5 w-5" />
          {bannerCount > 0 && (
            <CountBadge variant="pink" aria-hidden className="absolute -right-0.5 -top-0.5">
              {bannerCount}
            </CountBadge>
          )}
        </IconButton>
        {children}
      </div>
    </header>
  );
}
