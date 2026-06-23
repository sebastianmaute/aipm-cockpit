"use client";

import type React from "react";
import { useState } from "react";
import { t, type Lang } from "./i18n";
import { FOCUS_RING, INTERACTIVE, TRANSITION } from "./interaction-styles";

/** Standard compact control class shared by the bulk-edit field controls. */
const CONTROL_CLASS =
  `w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground focus:border-AIPM-dark-blue disabled:opacity-50 ${FOCUS_RING} ${TRANSITION}`;

export interface BulkFieldOption {
  value: string;
  label: string;
}

export interface BulkField {
  key: string;
  /** Already-translated label (this component is i18n-free). */
  label: string;
  /** Seed value (e.g. first option for a select). Defaults to "". */
  default?: string;
  /** Renders the control. The panel owns value/enable state and passes them in;
   *  `id` is the control's id (its visible label is bound to the ENABLE checkbox,
   *  so the control carries its own aria-label). */
  render: (p: { value: string; onChange: (v: string) => void; disabled: boolean; id: string }) => React.ReactNode;
}

/** Builder: a `<select>` bulk field. `options[0]` is the seeded default. */
export function selectField(key: string, label: string, options: readonly BulkFieldOption[]): BulkField {
  return {
    key,
    label,
    default: options[0]?.value ?? "",
    render: ({ value, onChange, disabled, id }) => (
      <select
        id={id}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={CONTROL_CLASS}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    ),
  };
}

/** Builder: a `<input type="date">` bulk field. Empty value clears the date. */
export function dateField(key: string, label: string, opts?: { min?: string }): BulkField {
  return {
    key,
    label,
    default: "",
    render: ({ value, onChange, disabled, id }) => (
      <input
        id={id}
        type="date"
        aria-label={label}
        min={opts?.min}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={CONTROL_CLASS}
      />
    ),
  };
}

/** Builder: a text `<input>` bulk field. */
export function textField(key: string, label: string, opts?: { placeholder?: string; maxLength?: number }): BulkField {
  return {
    key,
    label,
    default: "",
    render: ({ value, onChange, disabled, id }) => (
      <input
        id={id}
        type="text"
        aria-label={label}
        maxLength={opts?.maxLength}
        placeholder={opts?.placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={CONTROL_CLASS}
      />
    ),
  };
}

interface BulkEditPanelProps {
  lang: Lang;
  count: number;
  fields: readonly BulkField[];
  /** Receives only the ENABLED fields' values (key -> string). */
  onApply: (changes: Record<string, string>) => void;
  onCancel: () => void;
}

/** Generic inline bulk-edit panel: each field has an enable checkbox + control;
 *  Apply emits only the ticked fields. Entity logic (sanitize + setter) lives in
 *  the caller's onApply. Mirrors the tasks BulkEditModal but data-driven. */
export function BulkEditPanel({ lang, count, fields, onApply, onCancel }: BulkEditPanelProps) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const f of fields) v[f.key] = f.default ?? "";
    return v;
  });

  const anyEnabled = fields.some((f) => enabled[f.key]);

  const apply = () => {
    const changes: Record<string, string> = {};
    for (const f of fields) if (enabled[f.key]) changes[f.key] = values[f.key] ?? "";
    onApply(changes);
  };

  return (
    <div className="mb-2 shrink-0 rounded-xl border border-line bg-surface p-4">
      <h3 className="mb-3 text-sm font-medium text-foreground">{t(lang, "bulkEditCount", String(count))}</h3>
      <div className="space-y-3">
        {fields.map((f) => {
          const id = `bulk-${f.key}`;
          const on = !!enabled[f.key];
          return (
            <div key={f.key} className="flex items-start gap-3">
              <input
                id={`${id}-enable`}
                type="checkbox"
                checked={on}
                onChange={() => setEnabled((e) => ({ ...e, [f.key]: !e[f.key] }))}
                className={`mt-2 h-4 w-4 cursor-pointer rounded border-line text-AIPM-dark-blue ${FOCUS_RING} ${TRANSITION}`}
              />
              <div className="min-w-0 flex-1">
                <label htmlFor={`${id}-enable`} className="mb-1 block cursor-pointer text-sm font-medium text-foreground">
                  {f.label}
                </label>
                {f.render({
                  value: values[f.key] ?? "",
                  onChange: (v) => setValues((s) => ({ ...s, [f.key]: v })),
                  disabled: !on,
                  id,
                })}
              </div>
            </div>
          );
        })}
      </div>
      {!anyEnabled && <p className="mt-2 text-xs text-muted-foreground">{t(lang, "bulkEditNoFields")}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className={`rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
        >
          {t(lang, "cancel")}
        </button>
        <button
          type="button"
          onClick={apply}
          disabled={!anyEnabled}
          className={`rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-AIPM-dark-blue/90 disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
        >
          {t(lang, "bulkApplyCount", String(count))}
        </button>
      </div>
    </div>
  );
}
