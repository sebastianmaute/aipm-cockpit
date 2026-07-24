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

import { Fragment, useCallback, useId, useMemo, useRef, useState } from "react";
import { ExclamationTriangleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import type React from "react";
import type { Contact } from "./contacts";
import { Dot } from "./dot";
import { type Lang, t } from "./i18n";
import { resourceDisplayName } from "./resource-foundation";
import { FOCUS_RING, INTERACTIVE, TRANSITION } from "./interaction-styles";
import { usePopoverDismiss } from "./use-popover-dismiss";
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

  const closePicker = useCallback(() => setOpen(false), []);
  usePopoverDismiss(open, rootRef, closePicker);

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
            dangling ? "border-ui-pink pr-12" : linked ? "border-ui-green pr-8" : display ? "border-line pr-8" : "border-line"
          }`}
        />
        {/* WCAG 1.4.1: a broken link differed from a healthy one ONLY by colour
            (green vs pink border and glyph). The clear button's `title` covers a
            screen-reader user but is hover-only, so it reaches neither keyboard
            nor touch. This adds a non-colour SHAPE — decorative to AT, which
            already gets the state from that description. */}
        {dangling && (
          <span
            data-dangling-marker
            aria-hidden="true"
            className="pointer-events-none absolute right-7 top-1/2 -translate-y-1/2 text-ui-pink-strong"
          >
            <ExclamationTriangleIcon className="h-3.5 w-3.5" />
          </span>
        )}
        {/* Rendered whenever there is something to clear, linked or not: the
            control is labelled "Clear", so a typed-in free-text name needs it
            too — it used to leave select-all-delete as the only way out. */}
        {!!display && (
          <button
            type="button"
            // preventDefault on mousedown so clicking this button does NOT blur
            // the input first — commit-on-blur consumers (the inline task-row
            // assignee) would otherwise close the editor before this onChange
            // applies, swallowing the clear. Mirrors the listbox rows.
            onMouseDown={(e) => e.preventDefault()}
            // Clears the WHOLE field, not just the FK. Dropping the link alone
            // left the same name rendered (display falls back to value.name), so
            // the only visible effect was this button vanishing and the control
            // read as dead. An ✕ inside a text input means clear.
            // A dangling link (resource deleted) clears the same way: re-picking
            // from the dropdown is the repair path, and one glyph doing two
            // different things depending on its colour is worse than losing the
            // unlink-but-keep-name shortcut.
            onClick={() => onChange({ name: "", email: "", resourceId: null })}
            // The NAME is the action and is the same in every state, so the
            // linked/dangling distinction rides the DESCRIPTION (`title` becomes
            // the accessible description once aria-label supplies the name) —
            // without it a screen-reader user is never told an assignment is
            // broken. Free text has no link state, so it just says Clear.
            aria-label={t(lang, "clear")}
            title={
              linked
                ? t(lang, "resourcePickerLinked")
                : dangling
                  ? t(lang, "resourcePickerDangling")
                  : t(lang, "clear")
            }
            className={`absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 ${
              linked ? "text-ui-green-strong" : dangling ? "text-ui-pink-strong" : "text-muted-foreground"
            } hover:bg-surface-muted ${INTERACTIVE}`}
          >
            <XMarkIcon aria-hidden="true" className="h-3.5 w-3.5" />
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
                      <span className="font-medium text-ui-green-strong">
                        {t(lang, "resourcePickerAddAsResource").replace("{0}", row.name)}
                      </span>
                    ) : (
                      <>
                        <span className="flex items-center gap-1.5 truncate font-medium text-foreground">
                          {row.kind === "resource" && <Dot color="bg-ui-green" size="xs" />}
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
