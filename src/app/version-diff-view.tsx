// src/app/version-diff-view.tsx
// Read-only grouped diff display for version compare. Two layouts:
//  - "inline" (default): one row per record, before→after shown inline; in the
//    vs-now mode it also carries restore checkboxes (+ optional per-record
//    "Restore this" buttons via onRestoreRecord).
//  - "sideBySide": two columns (earlier | later) for a two-version compare.
// Presentational only.

import { useState } from "react";
import { t } from "./i18n";
import type { Lang } from "./i18n";
import type { VersionChange, ChangeType } from "./version-diff";
import { changeKey, type RestoreSelection } from "./version-restore";

const TYPE_KEY: Record<ChangeType, "historyAdded" | "historyRemoved" | "historyModified"> = {
  added: "historyAdded", removed: "historyRemoved", modified: "historyModified",
};
const TYPE_CLASS: Record<ChangeType, string> = {
  added: "text-AIPM-green-strong", removed: "text-AIPM-pink-strong", modified: "text-muted-foreground",
};

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function VersionDiffView({
  lang,
  changes,
  selectable = false,
  selection = {},
  onToggleRecord,
  onToggleField,
  onRestoreRecord,
  layout = "inline",
  leftLabel,
  rightLabel,
}: {
  lang: Lang;
  changes: VersionChange[];
  selectable?: boolean;
  selection?: RestoreSelection;
  onToggleRecord?: (key: string) => void;
  onToggleField?: (key: string, field: string) => void;
  /** When set (vs-now compare), each record row gets a "Restore this" button
   *  that restores just that record. */
  onRestoreRecord?: (key: string) => void;
  /** "inline" stacks before→after per field; "sideBySide" shows two columns. */
  layout?: "inline" | "sideBySide";
  /** Column headers for the side-by-side layout (the two versions' labels). */
  leftLabel?: string;
  rightLabel?: string;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (changes.length === 0) {
    return <p className="text-sm text-muted-foreground">{t(lang, "historyNoChanges")}</p>;
  }
  const groups = new Map<string, VersionChange[]>();
  for (const c of changes) groups.set(c.collectionLabel, [...(groups.get(c.collectionLabel) ?? []), c]);

  const keyOf = (c: VersionChange) => changeKey(c.collection, c.recordId);
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  if (layout === "sideBySide") {
    // For a two-version compare: earlier state on the left, later on the right.
    // `before` is the earlier (from) version, `after` the later (to) version.
    return (
      <div className="flex flex-col gap-3">
        {(leftLabel || rightLabel) && (
          <div className="grid grid-cols-2 gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span className="truncate">{leftLabel}</span>
            <span className="truncate">{rightLabel}</span>
          </div>
        )}
        {[...groups.entries()].map(([label, items]) => (
          <div key={label}>
            <h3 className="mb-1 text-sm font-semibold text-foreground">{label}</h3>
            <ul className="flex flex-col gap-2">
              {items.map((c) => (
                <li key={keyOf(c)} className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-foreground">{c.recordLabel}</span>
                    <span className={`text-xs ${TYPE_CLASS[c.type]}`}>{t(lang, TYPE_KEY[c.type])}</span>
                  </div>
                  <ul className="flex flex-col gap-0.5">
                    {c.fields.map((f) => (
                      <li key={f.field} className="grid grid-cols-2 gap-3 text-xs">
                        <span className="flex flex-wrap items-baseline gap-1">
                          <span className="font-medium text-muted-foreground">{f.label}:</span>
                          <span className="text-foreground">{fmt(f.before)}</span>
                        </span>
                        <span className="flex flex-wrap items-baseline gap-1">
                          <span className="font-medium text-muted-foreground">{f.label}:</span>
                          <span className="text-foreground">{fmt(f.after)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {[...groups.entries()].map(([label, items]) => (
        <div key={label}>
          <h3 className="mb-1 text-sm font-semibold text-foreground">{label}</h3>
          <ul className="flex flex-col gap-1">
            {items.map((c) => {
              const k = keyOf(c);
              const expandable = c.fields.length > 0;
              return (
                <li key={k} className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm">
                  <div className="flex items-center gap-1">
                    {selectable && (
                      <input
                        type="checkbox"
                        checked={selection[keyOf(c)] !== undefined}
                        onChange={() => onToggleRecord?.(keyOf(c))}
                        aria-label={c.recordLabel}
                        className="accent-AIPM-dark-blue mr-2"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => expandable && toggle(k)}
                      className="flex w-full items-center justify-between text-left"
                    >
                      <span className="text-foreground">{c.recordLabel}</span>
                      <span className={`text-xs ${TYPE_CLASS[c.type]}`}>{t(lang, TYPE_KEY[c.type])}</span>
                    </button>
                    {onRestoreRecord && (
                      <button
                        type="button"
                        onClick={() => onRestoreRecord(keyOf(c))}
                        className="ml-2 shrink-0 cursor-pointer rounded-md border border-line px-2 py-0.5 text-xs font-medium text-AIPM-dark-blue transition-colors hover:bg-surface-muted dark:text-AIPM-light-grey"
                      >
                        {t(lang, "historyRestoreRecord")}
                      </button>
                    )}
                  </div>
                  {expandable && open.has(k) && (
                    <ul className="mt-1 flex flex-col gap-0.5 border-t border-line pt-1">
                      {c.fields.map((f) => (
                        <li key={f.field} className="flex flex-wrap items-center gap-1 text-xs">
                          {selectable && (
                            <input
                              type="checkbox"
                              checked={selection[keyOf(c)] === "all" || (Array.isArray(selection[keyOf(c)]) && (selection[keyOf(c)] as string[]).includes(f.field))}
                              onChange={() => onToggleField?.(keyOf(c), f.field)}
                              aria-label={f.label}
                              className="accent-AIPM-dark-blue mr-1"
                            />
                          )}
                          <span className="font-medium text-muted-foreground">{f.label}:</span>
                          <span className="text-AIPM-pink-strong line-through">{fmt(f.before)}</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-AIPM-green-strong">{fmt(f.after)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
