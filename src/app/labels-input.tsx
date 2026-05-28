"use client";

import { useEffect, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import {
  LABELS_MAX_COUNT,
  LABEL_MAX,
  sanitizeLabel,
} from "./sanitize";

export function LabelsInput({
  value,
  suggestions,
  onChange,
  disabled,
  lang,
}: {
  value: string[];
  suggestions?: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  lang: Lang;
}) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [prevDraft, setPrevDraft] = useState(draft);
  const [prevOpen, setPrevOpen] = useState(open);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (prevDraft !== draft || prevOpen !== open) {
    setPrevDraft(draft);
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

  function commit(raw: string) {
    const clean = sanitizeLabel(raw);
    if (!clean) return;
    if (value.length >= LABELS_MAX_COUNT) return;
    if (value.some((v) => v.toLowerCase() === clean.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...value, clean]);
    setDraft("");
  }

  function removeAt(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  const atCap = value.length >= LABELS_MAX_COUNT;
  const lower = draft.trim().toLowerCase();
  const availableSuggestions = (suggestions ?? []).filter(
    (s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()),
  );
  const filtered = availableSuggestions.filter(
    (s) => !lower || s.toLowerCase().includes(lower),
  );
  const exactMatch = availableSuggestions.some(
    (s) => s.toLowerCase() === lower,
  );
  const showAddNew = draft.trim().length > 0 && !exactMatch;
  const totalItems = filtered.length + (showAddNew ? 1 : 0);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (open && highlight >= 0 && highlight < filtered.length) {
        commit(filtered[highlight]);
      } else if (open && showAddNew && highlight === filtered.length) {
        commit(draft);
      } else {
        commit(draft);
      }
    } else if (e.key === "Backspace" && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    } else if (e.key === "ArrowDown") {
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
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <div
        className={`flex min-h-[2.5rem] flex-wrap items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1.5 pr-9 text-sm focus-within:border-line focus-within:ring-1 focus-within:ring-AIPM-green ${
          disabled ? "cursor-not-allowed opacity-50" : ""
        }`}
        onClick={() => !disabled && inputRef.current?.focus()}
      >
        {value.map((label, idx) => (
          <span
            key={`${label}-${idx}`}
            className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey"
          >
            {label}
            {!disabled && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeAt(idx);
                }}
                aria-label={`${t(lang, "remove")} ${label}`}
                className="-mr-1 rounded-full text-muted-foreground hover:text-AIPM-pink"
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                  className="h-3 w-3"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.28 4.28a.75.75 0 011.06 0L10 8.94l4.66-4.66a.75.75 0 111.06 1.06L11.06 10l4.66 4.66a.75.75 0 11-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 01-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 010-1.06z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={draft}
          maxLength={LABEL_MAX}
          onChange={(e) => {
            setDraft(e.target.value);
            setOpen(true);
          }}
          onFocus={() => !disabled && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={
            atCap
              ? t(lang, "labelsAtCap")
              : value.length === 0
                ? t(lang, "labelsPlaceholder")
                : ""
          }
          disabled={disabled || atCap}
          className="min-w-[6rem] flex-1 border-0 bg-transparent p-0 text-sm text-foreground outline-none focus:ring-0 disabled:cursor-not-allowed"
        />
      </div>
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen((o) => !o);
          inputRef.current?.focus();
        }}
        aria-label={t(lang, "comboToggle")}
        tabIndex={-1}
        disabled={disabled || atCap}
        className="absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground hover:text-AIPM-dark-blue disabled:cursor-not-allowed disabled:opacity-50"
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

      {open && !disabled && totalItems > 0 && (
        <ul
          role="listbox"
          className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-line bg-surface text-sm"
        >
          {filtered.map((s, idx) => (
            <li key={s} role="option" aria-selected={idx === highlight}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(s)}
                className={`block w-full cursor-pointer px-3 py-1.5 text-left ${
                  idx === highlight
                    ? "bg-surface-muted text-AIPM-dark-blue"
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
                onClick={() => commit(draft)}
                className={`block w-full cursor-pointer px-3 py-1.5 text-left italic ${
                  highlight === filtered.length
                    ? "bg-AIPM-green/20 text-AIPM-dark-blue dark:bg-AIPM-green/30"
                    : "text-AIPM-dark-blue hover:bg-AIPM-green/10 dark:text-AIPM-light-grey"
                }`}
              >
                + {t(lang, "comboAddNew", draft.trim())}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
