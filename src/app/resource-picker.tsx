"use client";

// Resource-aware autocomplete for person fields (task assignee, RAID owner, ...).
//
// Augment model: registry Resources are suggested first (picking sets the FK),
// then remembered Contacts (picking sets name+email only, FK null), then a
// "+ Add as resource" row that creates a Resource from the typed name.
//
// Presentational: reads resources + contacts, emits onChange / onCreateResource.
// The parent owns every workspace write. A linked value (resourceId set) shows
// the resource's CURRENT name/email; the stored value.name is a cache used only
// as a fallback when the FK is dangling (resource deleted). Keyboard + popover
// behavior is lifted from the now-removed ContactInput.

import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import type React from "react";
import type { Contact } from "./contacts";
import { type Lang, t } from "./i18n";
import { resourceDisplayName } from "./resource-foundation";
import { FOCUS_RING, INTERACTIVE, TRANSITION } from "./interaction-styles";
import type { Resource } from "./types";

export interface ResourcePickerValue {
  name: string;
  email: string;
  resourceId: number | null | undefined;
}

interface ResourceRow { kind: "resource"; id: number; name: string; email: string }
interface ContactRow { kind: "contact"; name: string; email: string }
interface AddRow { kind: "add"; name: string }
type Row = ResourceRow | ContactRow | AddRow;

export function ResourcePicker({
  lang,
  value,
  resources,
  contacts,
  onChange,
  onCreateResource,
  placeholder,
  maxLength,
  disabled,
  title,
  onBlur,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-required": ariaRequired,
}: {
  lang: Lang;
  value: ResourcePickerValue;
  resources: readonly Resource[];
  contacts: Contact[];
  onChange: (next: { name: string; email: string; resourceId: number | null }) => void;
  onCreateResource?: (name: string, email: string) => number;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  title?: string;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // The linked resource (if any) is authoritative for display.
  const linked = value.resourceId != null
    ? resources.find((r) => r.id === value.resourceId)
    : undefined;
  const dangling = value.resourceId != null && !linked;
  const display = linked ? resourceDisplayName(linked) : value.name;

  const rows = useMemo<Row[]>(() => {
    const q = display.trim().toLowerCase();
    const resRows: ResourceRow[] = resources
      .filter((r) => {
        if (!q) return true;
        const n = resourceDisplayName(r).toLowerCase();
        return n.includes(q) || (r.email ?? "").toLowerCase().includes(q);
      })
      .sort((a, b) =>
        resourceDisplayName(a).localeCompare(resourceDisplayName(b), undefined, { sensitivity: "base" }),
      )
      .map((r) => ({ kind: "resource", id: r.id, name: resourceDisplayName(r), email: r.email ?? "" }));
    const resNames = new Set(resRows.map((r) => r.name.toLowerCase()));
    const conRows: ContactRow[] = contacts
      .filter((c) => {
        if (resNames.has(c.name.toLowerCase())) return false; // resource wins over a same-name contact
        if (!q) return true;
        return c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      .map((c) => ({ kind: "contact", name: c.name, email: c.email }));
    const out: Row[] = [...resRows, ...conRows];
    const trimmed = display.trim();
    const exact = resRows.some((r) => r.name.toLowerCase() === trimmed.toLowerCase());
    if (onCreateResource && trimmed && !exact) out.push({ kind: "add", name: trimmed });
    return out;
  }, [resources, contacts, display, onCreateResource]);

  // rows is [resources..., contacts..., add] by construction, so the first resource
  // is at index 0 and the first contact at firstContactIdx. Compute the contact
  // boundary ONCE here instead of an O(n) findIndex per row inside the .map below.
  const firstContactIdx = rows.findIndex((r) => r.kind === "contact");

  const [prevLen, setPrevLen] = useState(rows.length);
  if (prevLen !== rows.length) {
    setPrevLen(rows.length);
    setHighlight(0);
  }

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  function choose(row: Row) {
    if (row.kind === "resource") {
      onChange({ name: row.name, email: row.email, resourceId: row.id });
    } else if (row.kind === "contact") {
      onChange({ name: row.name, email: row.email, resourceId: null });
    } else if (onCreateResource) {
      // email is best-effort carry-over from the field; the parent/Resources view can correct it.
      const id = onCreateResource(row.name, value.email);
      onChange({ name: row.name, email: value.email, resourceId: id });
    }
    setOpen(false);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      if (!rows.length) return;
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => (h + 1) % rows.length);
      return;
    }
    if (e.key === "ArrowUp") {
      if (!rows.length) return;
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => (h - 1 + rows.length) % rows.length);
      return;
    }
    if (e.key === "Enter") {
      if (open && rows[highlight]) {
        e.preventDefault();
        choose(rows[highlight]);
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
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={display}
          onChange={(e) => {
            // Typing edits the name as free text and breaks any FK link.
            onChange({ name: e.target.value, email: value.email, resourceId: null });
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          title={title}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          aria-required={ariaRequired}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && rows.length ? `${listboxId}-opt-${highlight}` : undefined}
          aria-autocomplete="list"
          className={`w-full rounded-md border bg-surface px-3 py-2 text-sm text-foreground disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted-foreground ${FOCUS_RING} ${TRANSITION} ${
            linked ? "border-AIPM-green pr-8" : dangling ? "border-AIPM-pink pr-8" : "border-line"
          }`}
        />
        {(linked || dangling) && (
          <button
            type="button"
            onClick={() => onChange({ name: value.name, email: value.email, resourceId: null })}
            aria-label={t(lang, "resourcePickerUnlink")}
            title={linked ? t(lang, "resourcePickerLinked") : t(lang, "resourcePickerUnlink")}
            className={`absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 ${
              linked ? "text-AIPM-green-strong" : "text-AIPM-pink-strong"
            } hover:bg-surface-muted ${INTERACTIVE}`}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-3.5 w-3.5">
              <path fillRule="evenodd" d="M4.28 4.28a.75.75 0 011.06 0L10 8.94l4.66-4.66a.75.75 0 111.06 1.06L11.06 10l4.66 4.66a.75.75 0 11-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 01-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 010-1.06z" clipRule="evenodd" />
            </svg>
          </button>
        )}
      </div>

      {open && !disabled && rows.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-md border border-line bg-surface"
        >
          {rows.map((row, idx) => {
            const active = idx === highlight;
            const key = row.kind === "resource" ? `r${row.id}` : row.kind === "contact" ? `c${row.name}` : "add";
            // Section headers: emit before the FIRST row of each kind. Headers are
            // role="presentation" (not options) so they stay out of rows[]/highlight indexing.
            const firstResource = idx === 0 && row.kind === "resource";
            const firstContact = idx === firstContactIdx && row.kind === "contact";
            return (
              <Fragment key={key}>
                {firstResource && (
                  <li role="presentation" className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t(lang, "resourcePickerResourcesGroup")}
                  </li>
                )}
                {firstContact && (
                  <li role="presentation" className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t(lang, "resourcePickerRecentGroup")}
                  </li>
                )}
                <li
                  id={`${listboxId}-opt-${idx}`}
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setHighlight(idx)}
                  className={`px-3 py-1.5 text-sm ${active ? "bg-surface-muted" : "hover:bg-surface-muted"}`}
                >
                  <button
                    type="button"
                    // onMouseDown runs before the input blur that would close the popover.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(row);
                    }}
                    className={`flex w-full min-w-0 flex-col items-start text-left ${INTERACTIVE}`}
                  >
                    {row.kind === "add" ? (
                      <span className="font-medium text-AIPM-green-strong">
                        {t(lang, "resourcePickerAddAsResource").replace("{0}", row.name)}
                      </span>
                    ) : (
                      <>
                        <span className="flex items-center gap-1.5 truncate font-medium text-foreground">
                          {row.kind === "resource" && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-AIPM-green" />}
                          {row.name}
                        </span>
                        {row.email && <span className="truncate text-xs text-muted-foreground">{row.email}</span>}
                      </>
                    )}
                  </button>
                </li>
              </Fragment>
            );
          })}
        </ul>
      )}
    </div>
  );
}
