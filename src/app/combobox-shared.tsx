"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "./icons";
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
      title={t(lang, "comboToggle")}
      tabIndex={-1}
      disabled={disabled}
      className={className}
    >
      <ChevronDownIcon
        aria-hidden="true"
        className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
      />
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
            // Same fix already applied in global-search-box and
            // entity-link-picker, which both copied this highlight FROM here
            // and then repaired it locally while the shared file kept the bug:
            // `text-ui-dark-blue` on a dark `--surface-muted` is ~1.0-1.2:1, so
            // the highlighted option was marked by its own text vanishing —
            // worst possible failure, since the highlight is the only thing
            // identifying the active row. Weight + an inset `--foreground` ring
            // instead; the ring must not be a brand accent, which is tuned for
            // one mode (green is 1.7-2.1:1 on these fills, under 1.4.11's 3:1).
            className={`block w-full cursor-pointer px-3 py-1.5 text-left text-foreground ${
              idx === highlight
                ? "bg-surface-muted font-medium ring-1 ring-inset ring-foreground"
                : "hover:bg-surface-muted"
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
                // ★ The highlighted branch needs the dark TEXT companion too,
                // not just the dark background. Without it this row inherited
                // a near-black navy on a green-tinted dark surface — so
                // highlighting the add-new row made it HARDER to read than
                // leaving it alone, the same inversion fixed on the option
                // rows above. The unhighlighted branch already had it, which
                // is what made the omission easy to miss.
                ? "bg-ui-green/20 text-ui-dark-blue dark:bg-ui-green/30 dark:text-ui-light-grey"
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
