"use client";

// Outlook-style multi-token input for selecting stakeholder names.
//
// - Current value renders as removable chips (pill badges).
// - Typing filters the suggestions dropdown; clicking a row commits it.
// - Enter or comma commits the current text (free text allowed — no suggestion
//   required).  Backspace on empty input removes the last chip.
// - Known chips (name matches a suggestions entry, case-insensitive) receive a
//   small AIPM-green dot affordance + title="known stakeholder".
// - Controlled: only the in-progress text is local state; the committed list
//   always reflects props.value.

import { useEffect, useId, useRef, useState } from "react";
import { XMarkIcon } from "./icons";
import type React from "react";
import { IconButton } from "./icon-button";
import { type Lang, t } from "./i18n";
import { rowLabel } from "./row-tokens";

export interface StakeholderRecipientInputProps {
  lang: Lang;
  value: string[];
  onChange: (next: string[]) => void;
  suggestions: string[];
  label: string;
  id: string;
}

export function StakeholderRecipientInput({
  lang,
  value,
  onChange,
  suggestions,
  label,
  id,
}: StakeholderRecipientInputProps) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();

  const lowerDraft = draft.trim().toLowerCase();

  // Suggestions that are not yet chosen and match the current draft text.
  const filtered = suggestions.filter(
    (s) =>
      !value.some((v) => v.toLowerCase() === s.toLowerCase()) &&
      (!lowerDraft || s.toLowerCase().includes(lowerDraft)),
  );

  // Keep highlight in bounds when the filtered list shrinks.
  const clampedHighlight = filtered.length > 0 ? Math.min(highlight, filtered.length - 1) : 0;

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  function commit(raw: string) {
    const text = raw.trim();
    if (!text) return;
    if (value.some((v) => v.toLowerCase() === text.toLowerCase())) {
      // Duplicate — silently discard, clear input.
      setDraft("");
      setOpen(false);
      return;
    }
    onChange([...value, text]);
    setDraft("");
    setOpen(false);
    setHighlight(0);
  }

  function remove(name: string) {
    onChange(value.filter((v) => v !== name));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (open && filtered.length > 0) {
        commit(filtered[clampedHighlight]);
      } else {
        commit(draft);
      }
      return;
    }
    if (e.key === "Backspace" && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filtered.length === 0) return;
      setOpen(true);
      setHighlight((h) => (h + 1) % filtered.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length === 0) return;
      setOpen(true);
      setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
      return;
    }
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  }

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-sm font-medium text-foreground"
      >
        {label}
      </label>

      <div ref={rootRef} className="relative">
        {/* Token container + inline input */}
        <div
          className="flex min-h-[2.5rem] flex-wrap items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1.5 text-sm focus-within:border-ui-dark-blue focus-within:ring-1 focus-within:ring-ui-green"
          onClick={() => inputRef.current?.focus()}
        >
          {value.map((name) => {
            const isKnown = suggestions.some(
              (s) => s.toLowerCase() === name.toLowerCase(),
            );
            return (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-ui-dark-blue dark:text-ui-light-grey"
                title={isKnown ? "known stakeholder" : undefined}
                data-known={isKnown ? "true" : undefined}
              >
                {isKnown && (
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full bg-ui-green"
                  />
                )}
                {name}
                {/* ★ Row-unique name (rowLabel), threaded through `label`
                    unchanged — recipients can repeat a display name and no
                    gate can see a collision. */}
                <IconButton
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(name);
                  }}
                  label={rowLabel(t(lang, "remove"), name)}
                  variant="danger"
                  className="-mr-1"
                >
                  <XMarkIcon aria-hidden="true" className="h-3 w-3" />
                </IconButton>
              </span>
            );
          })}

          <input
            ref={inputRef}
            id={id}
            type="text"
            value={draft}
            role="combobox"
            aria-expanded={open && filtered.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            onChange={(e) => {
              setDraft(e.target.value);
              setHighlight(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className="min-w-[8rem] flex-1 border-0 bg-transparent p-0 text-sm text-foreground outline-none focus:ring-0"
          />
        </div>

        {/* Suggestions dropdown */}
        {open && filtered.length > 0 && (
          <ul
            id={listboxId}
            role="listbox"
            className="absolute left-0 right-0 z-30 mt-1 max-h-48 overflow-y-auto rounded-md border border-line bg-surface"
          >
            {filtered.map((name, idx) => {
              const active = idx === clampedHighlight;
              return (
                <li
                  key={name}
                  role="option"
                  aria-selected={active}
                  className={`cursor-pointer px-3 py-1.5 text-sm text-foreground ${
                    active ? "bg-surface-muted" : "hover:bg-surface-muted"
                  }`}
                  onMouseEnter={() => setHighlight(idx)}
                  onMouseDown={(e) => {
                    // Prevent input blur before the click fires.
                    e.preventDefault();
                    commit(name);
                    inputRef.current?.focus();
                  }}
                >
                  {name}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
