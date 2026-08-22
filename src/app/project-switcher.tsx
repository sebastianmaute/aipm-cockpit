"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowPathIcon, BriefcaseIcon, CheckIcon, ChevronDownIcon } from "./icons";
import { usePopoverDismiss } from "./use-popover-dismiss";
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
  /** Reload the current project's data from its backend (recovery affordance
   *  when an error leaves the app unpopulated). Renders a reload icon button
   *  beside the switcher when provided; omitted in readOnly/popout. */
  onReload?: () => void;
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
  onReload,
  mode = "file",
  dataTourId,
}: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  usePopoverDismiss(open, ref, () => setOpen(false));

  // APG menu keyboard support: on open, move focus into the menu (first
  // non-disabled menuitem — the active project's row is disabled).
  useEffect(() => {
    if (!open) return;
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([aria-disabled="true"])')
      ?.focus();
  }, [open]);

  // Arrow/Home/End roving between menuitems (wrapping). Escape/outside-click
  // dismissal stays with usePopoverDismiss.
  function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not([aria-disabled="true"])',
      ),
    );
    if (items.length === 0) return;
    const activeIndex = items.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    let next: number;
    switch (e.key) {
      case "Tab":
        // Tab exits the focus-managed menu (APG). Menuitems are tabIndex=-1 so
        // Tab never steps through them one-by-one; closing here lets the browser
        // move focus to the next control after the switcher. No preventDefault.
        setOpen(false);
        return;
      case "Escape":
        // Close and return focus to the trigger (WCAG 2.4.3 / APG menu-button:
        // Escape closes the menu and restores focus to the button that opened
        // it). usePopoverDismiss also closes on Escape, but only this path
        // restores focus — otherwise the destroyed menuitem drops focus to
        // <body> and the keyboard user loses their place.
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      case "ArrowDown":
        next = activeIndex < 0 ? 0 : (activeIndex + 1) % items.length;
        break;
      case "ArrowUp":
        next =
          activeIndex < 0
            ? items.length - 1
            : (activeIndex - 1 + items.length) % items.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = items.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    items[next]?.focus();
  }

  const label =
    currentProjectName ?? t(lang, "projectCurrentLabel");

  // Read-only mode: a non-interactive current-project indicator for popout
  // windows. Folder icon + name, no chevron, no dropdown — not a button.
  if (readOnly) {
    return (
      <div
        data-tour-id={dataTourId}
        title={label}
        className="flex max-w-[16rem] items-center gap-2 rounded-md border border-line bg-surface-muted px-3 py-1.5 text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey"
      >
        <BriefcaseIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-ui-green-strong" />
        <span className="truncate">{label}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
    <div ref={ref} data-tour-id={dataTourId} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t(lang, "projectCurrentLabel")}
        className="flex max-w-[16rem] items-center gap-2 rounded-md border border-line bg-surface-muted px-3 py-1.5 text-sm font-semibold text-ui-dark-blue hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-ui-green dark:text-ui-light-grey dark:hover:bg-surface"
      >
        <BriefcaseIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-ui-green-strong" />
        <span className="truncate">{label}</span>
        <ChevronDownIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t(lang, "projectCurrentLabel")}
          onKeyDown={onMenuKeyDown}
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
                tabIndex={-1}
                // aria-disabled (not native `disabled`) so the current project
                // stays perceivable in the a11y tree as a disabled menuitem
                // (marked aria-current); the roving nav + onClick skip it.
                aria-disabled={isCurrent || undefined}
                aria-current={isCurrent ? "true" : undefined}
                onClick={() => {
                  if (isCurrent) return;
                  onSwitch(p.id);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-ui-green aria-disabled:cursor-default aria-disabled:bg-surface-muted aria-disabled:hover:bg-surface-muted"
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
                  <CheckIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-ui-green-strong" />
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
              tabIndex={-1}
              onClick={() => {
                onLoadFromFile();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-ui-green"
            >
              {t(lang, "projectSwitcherLoadFile")}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              onNew();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-ui-dark-blue hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-ui-green dark:text-ui-light-grey"
          >
            + {t(lang, "projectsNew")}
          </button>
        </div>
      )}
    </div>
    {onReload && (
      <button
        type="button"
        onClick={onReload}
        aria-label={t(lang, "reloadProject")}
        title={t(lang, "reloadProjectHint")}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface-muted text-ui-dark-blue hover:bg-surface focus:outline-none focus:ring-2 focus:ring-ui-green dark:text-ui-light-grey"
      >
        <ArrowPathIcon aria-hidden="true" className="h-4 w-4" />
      </button>
    )}
    </div>
  );
}
