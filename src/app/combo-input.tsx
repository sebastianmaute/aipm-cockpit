"use client";

import { useEffect, useId, useRef, useState } from "react";
import { type Lang, t } from "./i18n";

const baseInputClass =
  "w-full rounded-md border border-zinc-300 bg-white pl-3 pr-10 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

/**
 * Single-value combobox: shows existing suggestions in a dropdown but also accepts
 * free-form input. Typing filters the list; clicking commits an existing entry;
 * pressing Enter or selecting "Add new" commits whatever was typed.
 */
export function ComboInput({
  value,
  suggestions,
  onChange,
  placeholder,
  maxLength,
  disabled,
  lang,
}: {
  value: string;
  suggestions: string[];
  onChange: (next: string) => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  lang: Lang;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [prevValue, setPrevValue] = useState(value);
  const [prevOpen, setPrevOpen] = useState(open);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  if (prevValue !== value || prevOpen !== open) {
    setPrevValue(value);
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

  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  const filtered = suggestions.filter(
    (s) => !lower || s.toLowerCase().includes(lower),
  );
  const exactMatch = suggestions.some((s) => s.toLowerCase() === lower);
  const showAddNew = trimmed.length > 0 && !exactMatch;
  const totalItems = filtered.length + (showAddNew ? 1 : 0);

  function commit(v: string) {
    onChange(v);
    setOpen(false);
    setHighlight(-1);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((i) =>
        totalItems === 0 ? -1 : i + 1 >= totalItems ? 0 : i + 1,
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setHighlight((i) =>
        totalItems === 0 ? -1 : i <= 0 ? totalItems - 1 : i - 1,
      );
    } else if (e.key === "Enter") {
      if (open && highlight >= 0 && highlight < filtered.length) {
        e.preventDefault();
        commit(filtered[highlight]);
      } else if (open && showAddNew && highlight === filtered.length) {
        e.preventDefault();
        commit(trimmed);
      } else if (open) {
        // Close dropdown but let the form submit if pressed again.
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => !disabled && setOpen(true)}
        onKeyDown={onKey}
        className={baseInputClass}
      />
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen((o) => !o);
          inputRef.current?.focus();
        }}
        aria-label={t(lang, "comboToggle")}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex items-center px-2 text-AIPM-medium-grey hover:text-AIPM-dark-blue disabled:cursor-not-allowed"
        disabled={disabled}
      >
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && totalItems > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {filtered.map((s, idx) => (
            <li key={s} role="option" aria-selected={idx === highlight}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(s)}
                className={`block w-full cursor-pointer px-3 py-1.5 text-left ${
                  idx === highlight
                    ? "bg-AIPM-light-grey text-AIPM-dark-blue dark:bg-zinc-800"
                    : "text-AIPM-dark-grey hover:bg-AIPM-light-grey dark:text-AIPM-light-grey dark:hover:bg-zinc-800"
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
              className="border-t border-zinc-200 dark:border-zinc-700"
            >
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(trimmed)}
                className={`block w-full cursor-pointer px-3 py-1.5 text-left italic ${
                  highlight === filtered.length
                    ? "bg-AIPM-green/20 text-AIPM-dark-blue dark:bg-AIPM-green/30"
                    : "text-AIPM-dark-blue hover:bg-AIPM-green/10 dark:text-AIPM-light-grey"
                }`}
              >
                + {t(lang, "comboAddNew", trimmed)}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
