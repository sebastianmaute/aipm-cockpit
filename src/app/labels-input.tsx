"use client";

import { useId, useState } from "react";
import type React from "react";
import { XMarkIcon } from "./icons";
import { IconButton } from "./icon-button";
import { FieldNotice } from "./field-feedback";
import { type Lang, t } from "./i18n";
import {
  LABELS_MAX_COUNT,
  LABEL_MAX,
  sanitizeLabel,
} from "./sanitize";
import { describeLabelStrip } from "./sanitize-report";
import { ComboboxChevron, ComboboxOptions, useCombobox } from "./combobox-shared";

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
  const [stripNotice, setStripNotice] = useState<string | null>(null);
  const stripNoticeId = useId();

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

  const { open, setOpen, highlight, rootRef, inputRef, moveHighlight } =
    useCombobox(draft, totalItems);

  function commit(raw: string) {
    const report = describeLabelStrip(raw);
    const clean = sanitizeLabel(report.value);
    if (!clean) return;
    if (value.length >= LABELS_MAX_COUNT) return;
    if (value.some((v) => v.toLowerCase() === clean.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...value, clean]);
    setDraft("");
    if (report.adjustment !== null && report.adjustment.kind === "stripped") {
      setStripNotice(t(lang, "fieldCharsRemoved", report.adjustment.chars.join(" ")));
    } else {
      setStripNotice(null);
    }
  }

  function removeAt(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

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
      moveHighlight(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveHighlight(-1);
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  }

  return (
    <>
    <div ref={rootRef} className="relative">
      <div
        className={`flex min-h-[2.5rem] flex-wrap items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1.5 pr-9 text-sm focus-within:border-line focus-within:ring-1 focus-within:ring-ui-green ${
          disabled ? "cursor-not-allowed opacity-50" : ""
        }`}
        onClick={() => !disabled && inputRef.current?.focus()}
      >
        {value.map((label, idx) => (
          <span
            key={`${label}-${idx}`}
            className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-ui-dark-blue dark:text-ui-light-grey"
          >
            {label}
            {!disabled && (
              <IconButton
                onClick={(e) => {
                  e.stopPropagation();
                  removeAt(idx);
                }}
                label={`${t(lang, "remove")} ${label}`}
                title={`${t(lang, "remove")} ${label}`}
                variant="danger"
                className="-mr-1"
              >
                <XMarkIcon aria-hidden="true" className="h-3 w-3" />
              </IconButton>
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
          // ★★ Self-naming, not decoration. The chip ✕ buttons render BEFORE
          // this input, so a wrapping `<label>` bound to the first chip rather
          // than here — and the placeholder collapses to "" as soon as one chip
          // exists, so with any label applied this input had NO accessible name
          // at all. The caller's wrapper is now a `role="group"`, which names
          // the block but never the control.
          aria-label={t(lang, "labels")}
          aria-invalid={stripNotice ? true : undefined}
          aria-describedby={stripNotice ? stripNoticeId : undefined}
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
      <ComboboxChevron
        open={open}
        disabled={disabled || atCap}
        lang={lang}
        onToggle={() => {
          if (disabled) return;
          setOpen((o) => !o);
          inputRef.current?.focus();
        }}
        className="absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground hover:text-ui-dark-blue disabled:cursor-not-allowed disabled:opacity-50"
      />

      {open && !disabled && totalItems > 0 && (
        <ComboboxOptions
          filtered={filtered}
          highlight={highlight}
          showAddNew={showAddNew}
          addNewLabel={t(lang, "comboAddNew", draft.trim())}
          onSelect={commit}
          onAddNew={() => commit(draft)}
        />
      )}
    </div>
    {stripNotice && <FieldNotice id={stripNoticeId}>{stripNotice}</FieldNotice>}
    </>
  );
}
