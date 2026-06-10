"use client";
import { type Lang, t } from "./i18n";
import { ProjectSwitcher, type ProjectSwitcherProps } from "./project-switcher";

interface TopBarProps {
  lang: Lang;
  title: string;
  bannerCount: number;
  onNewTask: () => void;
  onShowAlerts: () => void;
  /** Opens the AI Assistant chat pop-out. */
  onOpenAiAssistant?: () => void;
  /** When set, replaces the default New-task button (e.g. Save/Cancel while editing). */
  primaryAction?: React.ReactNode;
  /** When set, renders a leading menu button that toggles the sidebar. */
  onToggleSidebar?: () => void;
  /** When set, renders the current-project indicator + switcher near the title. */
  projectSwitcher?: ProjectSwitcherProps;
  /** Menu components (Export/Help/Version/Settings/Voice) rendered as-is. */
  children?: React.ReactNode;
}

export function TopBar({ lang, title, bannerCount, onNewTask, onShowAlerts, onOpenAiAssistant, primaryAction, onToggleSidebar, projectSwitcher, children }: TopBarProps) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-line bg-surface px-6 py-3">
      <div className="flex min-w-0 items-center gap-3">
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={t(lang, "sidebarMenuButton")}
            title={t(lang, "sidebarMenuButton")}
            className="rounded-md p-2 text-AIPM-dark-grey hover:bg-surface-muted hover:text-AIPM-dark-blue focus:outline-none focus:ring-2 focus:ring-AIPM-green dark:text-AIPM-medium-grey dark:hover:text-AIPM-light-grey"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-5 w-5">
              <path fillRule="evenodd" d="M3 5.5A.75.75 0 013.75 4.75h12.5a.75.75 0 010 1.5H3.75A.75.75 0 013 5.5zm0 4.5a.75.75 0 01.75-.75h12.5a.75.75 0 010 1.5H3.75A.75.75 0 013 10zm0 4.5a.75.75 0 01.75-.75h12.5a.75.75 0 010 1.5H3.75A.75.75 0 013 14.5z" clipRule="evenodd" />
            </svg>
          </button>
        )}
        <h1 className="truncate text-xl font-semibold tracking-tight text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {title}
        </h1>
        {projectSwitcher && <ProjectSwitcher {...projectSwitcher} />}
      </div>
      <div className="flex items-center gap-1">
        {onOpenAiAssistant && (
          <button
            type="button"
            onClick={onOpenAiAssistant}
            aria-label={t(lang, "openAiAssistant")}
            title={t(lang, "openAiAssistant")}
            className="rounded-md p-2 text-AIPM-dark-grey hover:bg-surface-muted hover:text-AIPM-dark-blue focus:outline-none focus:ring-2 focus:ring-AIPM-green dark:text-AIPM-medium-grey dark:hover:text-AIPM-light-grey"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-5 w-5">
              <path fillRule="evenodd" d="M2 5a2 2 0 012-2h12a2 2 0 012 2v7a2 2 0 01-2 2H6l-4 4V5z" clipRule="evenodd" />
            </svg>
          </button>
        )}
        {primaryAction ?? (
          <button
            type="button"
            onClick={onNewTask}
            title={t(lang, "newTask")}
            className="rounded-md bg-AIPM-green px-3 py-1.5 text-sm font-semibold text-AIPM-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-AIPM-green"
          >
            {t(lang, "newTask")}
          </button>
        )}
        <button
          type="button"
          onClick={onShowAlerts}
          aria-label={t(lang, "showDueAlerts")}
          title={t(lang, "showDueAlerts")}
          className="relative rounded-md p-2 text-AIPM-dark-grey hover:bg-surface-muted hover:text-AIPM-dark-blue focus:outline-none focus:ring-2 focus:ring-AIPM-green dark:text-AIPM-medium-grey dark:hover:text-AIPM-light-grey"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-5 w-5">
            <path d="M10 2a6 6 0 00-6 6v2.586l-.707.707A1 1 0 004 13h12a1 1 0 00.707-1.707L16 10.586V8a6 6 0 00-6-6zM8 15a2 2 0 104 0H8z" />
          </svg>
          {bannerCount > 0 && (
            <span aria-hidden className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-AIPM-pink px-1 text-[10px] font-semibold leading-none text-AIPM-white">
              {bannerCount}
            </span>
          )}
        </button>
        {children}
      </div>
    </header>
  );
}
