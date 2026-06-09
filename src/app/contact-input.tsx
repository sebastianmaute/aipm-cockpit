"use client";

// Autocomplete combobox for the assignee field in the task modal.
//
// Differs from the existing `ComboInput` (groups, labels) in two ways:
//   1. Each suggestion carries TWO values (name + email). Picking a
//      suggestion fills both — the email field gets autofilled on the
//      parent form.
//   2. Each suggestion has its own × remove button — clicking it strips
//      the contact from the persisted address book (settings → contacts)
//      without affecting the input value.
//
// Keyboard: ↑ / ↓ navigate the visible list, Enter picks the highlighted
// row, Esc closes the popover. The dropdown is filtered by case-insensitive
// substring match on name + email.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type React from "react";
import type { Contact } from "./contacts";
import { type Lang, t } from "./i18n";

export function ContactInput({
  lang,
  value,
  contacts,
  onChangePair,
  onChangeName,
  onRemoveContact,
  placeholder,
  maxLength,
  disabled,
  title,
  onBlur,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-required": ariaRequired,
}: {
  lang: Lang;
  /** The current assignee name (for the underlying text input). */
  value: string;
  /** All remembered contacts (already sorted is fine but we re-sort by name). */
  contacts: Contact[];
  /**
   * Fired when the user PICKS a suggestion. Parent should use this to set
   * both assignee and assigneeEmail.
   */
  onChangePair: (name: string, email: string) => void;
  /** Fired on plain keystroke changes (only the name field, not email). */
  onChangeName: (name: string) => void;
  /** Fired when the user clicks × on a suggestion row. */
  onRemoveContact: (name: string) => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  title?: string;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  // Unique per instance so two ContactInputs on one page don't collide.
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    const arr = contacts.slice().sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
    if (!q) return arr;
    return arr.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.email && c.email.toLowerCase().includes(q)),
    );
  }, [contacts, value]);

  // Reset the keyboard highlight when the visible list changes.
  const [prevFilteredLen, setPrevFilteredLen] = useState(filtered.length);
  if (prevFilteredLen !== filtered.length) {
    setPrevFilteredLen(filtered.length);
    setHighlight(0);
  }

  // Click outside closes.
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

  function pick(c: Contact) {
    onChangePair(c.name, c.email);
    setOpen(false);
    // Move focus back to the input so the user can keep typing if they want.
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      if (filtered.length === 0) return;
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => (h + 1) % filtered.length);
      return;
    }
    if (e.key === "ArrowUp") {
      if (filtered.length === 0) return;
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
      return;
    }
    if (e.key === "Enter") {
      if (open && filtered[highlight]) {
        e.preventDefault();
        pick(filtered[highlight]);
      }
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
    <div ref={rootRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChangeName(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (contacts.length > 0) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        title={title}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-required={ariaRequired}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted-foreground"
      />

      {open && filtered.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-md border border-line bg-surface"
        >
          {filtered.map((c, idx) => {
            const active = idx === highlight;
            return (
              <li
                key={c.name}
                role="option"
                aria-selected={active}
                className={`flex items-center justify-between gap-2 px-3 py-1.5 text-sm ${
                  active
                    ? "bg-surface-muted"
                    : "hover:bg-surface-muted"
                }`}
                onMouseEnter={() => setHighlight(idx)}
              >
                <button
                  type="button"
                  // Use onMouseDown so we run before the input's blur, which
                  // would otherwise close the dropdown before the click lands.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(c);
                  }}
                  className="flex min-w-0 flex-1 flex-col items-start text-left"
                >
                  <span className="truncate font-medium text-foreground">
                    {c.name}
                  </span>
                  {c.email && (
                    <span className="truncate text-xs text-muted-foreground">
                      {c.email}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onRemoveContact(c.name);
                  }}
                  aria-label={t(lang, "contactsRemove")}
                  title={t(lang, "contactsRemove")}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-AIPM-pink/10 hover:text-AIPM-pink"
                >
                  <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                    className="h-3.5 w-3.5"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.28 4.28a.75.75 0 011.06 0L10 8.94l4.66-4.66a.75.75 0 111.06 1.06L11.06 10l4.66 4.66a.75.75 0 11-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 01-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 010-1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
