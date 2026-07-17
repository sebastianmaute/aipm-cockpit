"use client";

import { useId } from "react";
import type React from "react";
import { type Lang, t } from "./i18n";
import { ComboboxChevron, ComboboxOptions, useCombobox } from "./combobox-shared";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";

// Canonical field shell: same ring-2 AIPM-green focus as the form-controls
// `fieldClass` and the resource-picker / global-search comboboxes (was a weak
// ring-1 — the design-system Phase 2b focus-ring normalisation).
const baseInputClass = `w-full rounded-md border border-line bg-surface pl-3 pr-10 py-2 text-sm text-foreground placeholder:text-muted-foreground ${FOCUS_RING} ${TRANSITION} disabled:cursor-not-allowed disabled:opacity-50`;

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
  onBlur,
  "aria-describedby": ariaDescribedBy,
}: {
  value: string;
  suggestions: string[];
  onChange: (next: string) => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  lang: Lang;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  "aria-describedby"?: string;
}) {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  const filtered = suggestions.filter(
    (s) => !lower || s.toLowerCase().includes(lower),
  );
  const exactMatch = suggestions.some((s) => s.toLowerCase() === lower);
  const showAddNew = trimmed.length > 0 && !exactMatch;
  const totalItems = filtered.length + (showAddNew ? 1 : 0);

  const { open, setOpen, highlight, rootRef, inputRef, moveHighlight } =
    useCombobox(value, totalItems);
  const listId = useId();

  function commit(v: string) {
    onChange(v);
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveHighlight(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveHighlight(-1);
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
        aria-describedby={ariaDescribedBy}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => !disabled && setOpen(true)}
        onKeyDown={onKey}
        onBlur={onBlur}
        className={baseInputClass}
      />
      <ComboboxChevron
        open={open}
        disabled={disabled}
        lang={lang}
        onToggle={() => {
          if (disabled) return;
          setOpen((o) => !o);
          inputRef.current?.focus();
        }}
        className="absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground hover:text-AIPM-dark-blue disabled:cursor-not-allowed"
      />

      {open && totalItems > 0 && (
        <ComboboxOptions
          listId={listId}
          filtered={filtered}
          highlight={highlight}
          showAddNew={showAddNew}
          addNewLabel={t(lang, "comboAddNew", trimmed)}
          onSelect={commit}
          onAddNew={() => commit(trimmed)}
        />
      )}
    </div>
  );
}
