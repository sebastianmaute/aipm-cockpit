"use client";

import { useEffect, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { type ProjectRegistryEntry } from "./projects-registry";

export interface ProjectSwitcherProps {
  /** Name of the active project, or null when none is selected. */
  currentProjectName: string | null;
  projects: ProjectRegistryEntry[];
  currentProjectId: string | null;
  lang: Lang;
  onSwitch: (id: string) => void;
  onLoadFromFile: () => void;
  onNew: () => void;
  /** When true, render a NON-interactive indicator of the current project name
   *  (folder icon + name, no chevron, no dropdown). Used by popout windows,
   *  which mirror the main window and cannot switch projects. */
  readOnly?: boolean;
  /** Turso mode: hide the "Load from file" dropdown item (Turso has no file
   *  load). Defaults to "file". */
  mode?: "file" | "turso";
  /** Guided-tour spotlight anchor (`data-tour-id`) placed on the switcher's
   *  outer container so the tour can highlight it. */
  dataTourId?: string;
}

/**
 * Prominent current-project indicator + switcher. Rendered identically by the
 * classic `AppHeader` and the modern `TopBar`. The trigger shows the active
 * project name (falling back to a "no project" label) and opens a dropdown
 * listing all registered projects plus Load-from-file / New-project actions.
 *
 * The open/close + outside-click + Escape behaviour mirrors `VersionMenu`
 * (mousedown-outside + keydown-Escape listeners scoped to the open state).
 */
export function ProjectSwitcher({
  currentProjectName,
  projects,
  currentProjectId,
  lang,
  onSwitch,
  onLoadFromFile,
  onNew,
  readOnly = false,
  mode = "file",
  dataTourId,
}: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label =
    currentProjectName ?? t(lang, "projectCurrentLabel");

  // Read-only mode: a non-interactive current-project indicator for popout
  // windows. Folder icon + name, no chevron, no dropdown — not a button.
  if (readOnly) {
    return (
      <div
        data-tour-id={dataTourId}
        title={label}
        className="flex max-w-[16rem] items-center gap-2 rounded-md border border-line bg-surface-muted px-3 py-1.5 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey"
      >
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-AIPM-green-strong"
        >
          <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
        </svg>
        <span className="truncate">{label}</span>
      </div>
    );
  }

  return (
    <div ref={ref} data-tour-id={dataTourId} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t(lang, "projectCurrentLabel")}
        className="flex max-w-[16rem] items-center gap-2 rounded-md border border-line bg-surface-muted px-3 py-1.5 text-sm font-semibold text-AIPM-dark-blue hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-AIPM-green dark:text-AIPM-light-grey dark:hover:bg-surface"
      >
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-AIPM-green-strong"
        >
          <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
        </svg>
        <span className="truncate">{label}</span>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-muted-foreground"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t(lang, "projectCurrentLabel")}
          className="absolute left-0 top-full z-40 mt-2 max-h-[80vh] w-72 overflow-y-auto rounded-lg border border-line bg-surface p-1"
        >
          <h3 className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t(lang, "navProjects")}
          </h3>
          {projects.map((p) => {
            const isCurrent = p.id === currentProjectId;
            return (
              <button
                key={p.id}
                type="button"
                role="menuitem"
                disabled={isCurrent}
                aria-current={isCurrent ? "true" : undefined}
                onClick={() => {
                  if (isCurrent) return;
                  onSwitch(p.id);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-AIPM-green disabled:cursor-default disabled:bg-surface-muted disabled:opacity-100"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{p.name}</span>
                  {p.code && (
                    <span className="truncate text-xs text-muted-foreground">
                      {p.code}
                    </span>
                  )}
                </span>
                {isCurrent && (
                  <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-AIPM-green-strong"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 011.4-1.4l2.8 2.79 6.8-6.79a1 1 0 011.4 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </button>
            );
          })}
          {mode === "file" && (
            <div className="my-1 border-t border-line" />
          )}
          {mode === "file" && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onLoadFromFile();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-AIPM-green"
            >
              {t(lang, "projectSwitcherLoadFile")}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onNew();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-AIPM-dark-blue hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-AIPM-green dark:text-AIPM-light-grey"
          >
            + {t(lang, "projectsNew")}
          </button>
        </div>
      )}
    </div>
  );
}
