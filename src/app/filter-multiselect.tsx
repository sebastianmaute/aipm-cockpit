"use client";

import { useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { usePopoverDismiss } from "./use-popover-dismiss";
import { FOCUS_RING, INTERACTIVE, TRANSITION } from "./interaction-styles";

export interface FilterOption {
  value: string;
  /** Human-readable label (already resolved/translated by the caller). */
  label: string;
}

interface FilterMultiSelectProps {
  lang: Lang;
  /** Stable control label, e.g. "Status" — also the accessible name base. */
  label: string;
  options: readonly FilterOption[];
  /** Currently selected option values; empty = no filter (show all). */
  selected: readonly string[];
  onToggle: (value: string) => void;
}

/**
 * A compact multi-select filter control: a toolbar button showing the filter
 * label plus a count badge when any option is selected, opening a checkbox
 * popover. Empty selection means "all" (no filter). Reused across the Gantt
 * toolbar's status / priority / assignee filters.
 */
export function FilterMultiSelect({
  lang,
  label,
  options,
  selected,
  onToggle,
}: FilterMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, wrapRef, () => setOpen(false));

  const count = selected.length;
  const disabled = options.length === 0;
  // Accessible name carries the label + live count so screen readers announce
  // e.g. "Status, 2 selected". The visible chip mirrors it.
  const aria =
    count > 0 ? `${label} – ${t(lang, "filterSelectedCount", count)}` : label;

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-label={aria}
        aria-expanded={open}
        title={aria}
        className={`inline-flex h-[30px] items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium ${TRANSITION} ${INTERACTIVE} ${
          count > 0
            ? "border-AIPM-dark-blue bg-AIPM-dark-blue/10 text-AIPM-dark-blue dark:text-AIPM-light-grey"
            : "border-line bg-surface text-foreground hover:bg-surface-muted"
        } disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <span>{label}</span>
        {count > 0 && (
          <span className="rounded-full bg-AIPM-dark-blue px-1.5 text-[10px] font-semibold leading-4 text-white">
            {count}
          </span>
        )}
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-3 w-3">
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.086l3.71-3.855a.75.75 0 111.08 1.04l-4.25 4.41a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="absolute left-0 top-full z-40 mt-1 max-h-72 w-56 overflow-auto rounded-lg border border-line bg-surface p-3"
        >
          <ul className="space-y-1">
            {options.map((opt) => (
              <li key={opt.value}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm text-foreground hover:bg-surface-muted">
                  <input
                    type="checkbox"
                    checked={selected.includes(opt.value)}
                    onChange={() => onToggle(opt.value)}
                    className={`h-3.5 w-3.5 rounded border-line text-AIPM-dark-blue ${FOCUS_RING}`}
                  />
                  <span className="truncate">{opt.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
