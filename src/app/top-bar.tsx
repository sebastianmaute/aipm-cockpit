"use client";
import { type Lang, t } from "./i18n";

interface TopBarProps {
  lang: Lang;
  title: string;
  bannerCount: number;
  onNewTask: () => void;
  onShowAlerts: () => void;
  /** Menu components (Export/Help/Version/Settings/Voice) rendered as-is. */
  children?: React.ReactNode;
}

export function TopBar({ lang, title, bannerCount, onNewTask, onShowAlerts, children }: TopBarProps) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-line bg-surface px-6 py-3">
      <h1 className="text-xl font-semibold tracking-tight text-AIPM-dark-blue dark:text-AIPM-light-grey">
        {title}
      </h1>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onNewTask}
          title={t(lang, "newTask")}
          className="rounded-md bg-AIPM-green px-3 py-1.5 text-sm font-semibold text-AIPM-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-AIPM-green"
        >
          {t(lang, "newTask")}
        </button>
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
