"use client";

import { useEffect, useRef, useState } from "react";
import { type Lang, t } from "./i18n";

/**
 * Shared mechanics for the single-value {@link ComboInput} and multi-value
 * LabelsInput: open/highlight state, outside-click-to-close, highlight reset on
 * text/open changes, and arrow-key navigation. Each input keeps its own
 * commit/validation logic — only the common dropdown plumbing lives here.
 *
 * @param resetKey  value that, when changed, clears the active option (the input
 *                  text for ComboInput, the draft for LabelsInput).
 * @param totalItems number of selectable rows (filtered suggestions + "add new").
 */
export function useCombobox(resetKey: string, totalItems: number) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [prevKey, setPrevKey] = useState(resetKey);
  const [prevOpen, setPrevOpen] = useState(open);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset the active option whenever the text or open-state changes.
  if (prevKey !== resetKey || prevOpen !== open) {
    setPrevKey(resetKey);
    setPrevOpen(open);
    setHighlight(-1);
  }

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  // Move the highlighted option, wrapping at both ends. Opens the list first.
  function moveHighlight(delta: 1 | -1) {
    setOpen(true);
    setHighlight((i) =>
      totalItems === 0
        ? -1
        : delta === 1
          ? i + 1 >= totalItems
            ? 0
            : i + 1
          : i <= 0
            ? totalItems - 1
            : i - 1,
    );
  }

  return { open, setOpen, highlight, setHighlight, rootRef, inputRef, moveHighlight };
}

const CHEVRON_PATH =
  "M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z";

/** The dropdown toggle button (chevron) shared by both inputs. */
export function ComboboxChevron({
  open,
  disabled,
  onToggle,
  lang,
  className,
}: {
  open: boolean;
  disabled?: boolean;
  onToggle: () => void;
  lang: Lang;
  className: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={t(lang, "comboToggle")}
      tabIndex={-1}
      disabled={disabled}
      className={className}
    >
      <svg
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
        className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
      >
        <path fillRule="evenodd" d={CHEVRON_PATH} clipRule="evenodd" />
      </svg>
    </button>
  );
}

/**
 * The suggestion dropdown: filtered options followed by an optional "add new"
 * row. The caller owns the open/visibility guard and the commit handlers.
 */
export function ComboboxOptions({
  listId,
  filtered,
  highlight,
  showAddNew,
  addNewLabel,
  onSelect,
  onAddNew,
}: {
  listId?: string;
  filtered: string[];
  highlight: number;
  showAddNew: boolean;
  addNewLabel: string;
  onSelect: (s: string) => void;
  onAddNew: () => void;
}) {
  return (
    <ul
      id={listId}
      role="listbox"
      className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-line bg-surface text-sm"
    >
      {filtered.map((s, idx) => (
        <li key={s} role="option" aria-selected={idx === highlight}>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(s)}
            className={`block w-full cursor-pointer px-3 py-1.5 text-left ${
              idx === highlight
                ? "bg-surface-muted text-ui-dark-blue"
                : "text-foreground hover:bg-surface-muted"
            }`}
          >
            {s}
          </button>
        </li>
      ))}
      {showAddNew && (
        <li
          role="option"
          aria-selected={highlight === filtered.length}
          className="border-t border-line"
        >
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onAddNew}
            className={`block w-full cursor-pointer px-3 py-1.5 text-left italic ${
              highlight === filtered.length
                ? "bg-ui-green/20 text-ui-dark-blue dark:bg-ui-green/30"
                : "text-ui-dark-blue hover:bg-ui-green/10 dark:text-ui-light-grey"
            }`}
          >
            + {addNewLabel}
          </button>
        </li>
      )}
    </ul>
  );
}
