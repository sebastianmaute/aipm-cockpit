// src/app/version-diff-view.tsx
// Read-only grouped diff display for version compare. Two layouts:
//  - "inline" (default): one row per record, before→after shown inline; in the
//    vs-now mode it also carries restore checkboxes (+ optional per-record
//    "Restore this" buttons via onRestoreRecord).
//  - "sideBySide": two columns (earlier | later) for a two-version compare.
// Presentational only.
//
// ★★ A change carrying `restorable: false` (documents, documentVersions) gets
// NEITHER a checkbox NOR a restore button in EITHER layout — `applyRestore`
// skips those collections, so both controls would be silent no-ops reporting
// success. The row renders `historyNotRestorable` in their place instead.

import { useState } from "react";
import { t } from "./i18n";
import type { Lang } from "./i18n";
import type { VersionChange, ChangeType } from "./version-diff";
import { changeKey, type RestoreSelection } from "./version-restore";
import { Checkbox } from "./form-controls";
import { buildRowTokens, rowLabel } from "./row-tokens";

const TYPE_KEY: Record<ChangeType, "historyAdded" | "historyRemoved" | "historyModified"> = {
  added: "historyAdded", removed: "historyRemoved", modified: "historyModified",
};
const TYPE_CLASS: Record<ChangeType, string> = {
  added: "text-ui-green-strong", removed: "text-ui-pink-strong", modified: "text-muted-foreground",
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
        {[...groups.entries()].map(([label, items]) => {
          const tokens = buildRowTokens(items.map((c) => ({ id: keyOf(c), name: c.recordLabel })));
          return (
          <div key={label}>
            <h3 className="mb-1 text-sm font-semibold text-foreground">{label}</h3>
            <ul className="flex flex-col gap-2">
              {items.map((c) => {
                const k = keyOf(c);
                const revertible = c.restorable !== false;
                return (
                <li key={k} className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-foreground">{c.recordLabel}</span>
                    <span className="flex items-center gap-2">
                      <span className={`text-xs ${TYPE_CLASS[c.type]}`}>{t(lang, TYPE_KEY[c.type])}</span>
                      {!revertible && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {t(lang, "historyNotRestorable")}
                        </span>
                      )}
                      {onRestoreRecord && revertible && (
                        <button
                          type="button"
                          onClick={() => onRestoreRecord(k)}
                          title={t(lang, "historyRestoreRecordHint")}
                          aria-label={rowLabel(t(lang, "historyRestoreRecord"), tokens.get(k) ?? c.recordLabel)}
                          className="shrink-0 cursor-pointer rounded-md border border-line px-2 py-0.5 text-xs font-medium text-ui-dark-blue transition-colors hover:bg-surface-muted dark:text-ui-light-grey"
                        >
                          {t(lang, "historyRestoreRecord")}
                        </button>
                      )}
                    </span>
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
                );
              })}
            </ul>
          </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {[...groups.entries()].map(([label, items]) => {
        // ★★ Row-unique accessible names. `recordLabel` uses the record's
        // nameField, and two documents titled "Q3 report" (or two tasks named
        // "Alpha") are ordinary — so the bare label names two checkboxes
        // identically, a WCAG 2.4.6 fail no gate in this repo can see. A
        // per-item component cannot fix this: only the list owner can see the
        // siblings, which is why the map is built HERE and threaded down.
        const tokens = buildRowTokens(items.map((c) => ({ id: keyOf(c), name: c.recordLabel })));
        return (
        <div key={label}>
          <h3 className="mb-1 text-sm font-semibold text-foreground">{label}</h3>
          <ul className="flex flex-col gap-1">
            {items.map((c) => {
              const k = keyOf(c);
              const expandable = c.fields.length > 0;
              // ★★ `restorable: false` (documents, documentVersions) is
              // diff-visible but `applyRestore` SKIPS it — so a checkbox or a
              // restore button here would be a silent no-op that reports
              // success. The row says so instead.
              const revertible = c.restorable !== false;
              return (
                <li key={k} className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm">
                  <div className="flex items-center gap-1">
                    {selectable && revertible && (
                      <Checkbox
                        checked={selection[k] !== undefined}
                        onChange={() => onToggleRecord?.(k)}
                        aria-label={rowLabel(t(lang, "historySelectRecord"), tokens.get(k) ?? c.recordLabel)}
                        className="mr-2"
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
                    {!revertible && (
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                        {t(lang, "historyNotRestorable")}
                      </span>
                    )}
                    {onRestoreRecord && revertible && (
                      <button
                        type="button"
                        onClick={() => onRestoreRecord(k)}
                        title={t(lang, "historyRestoreRecordHint")}
                        aria-label={rowLabel(t(lang, "historyRestoreRecord"), tokens.get(k) ?? c.recordLabel)}
                        className="ml-2 shrink-0 cursor-pointer rounded-md border border-line px-2 py-0.5 text-xs font-medium text-ui-dark-blue transition-colors hover:bg-surface-muted dark:text-ui-light-grey"
                      >
                        {t(lang, "historyRestoreRecord")}
                      </button>
                    )}
                  </div>
                  {expandable && open.has(k) && (
                    <ul className="mt-1 flex flex-col gap-0.5 border-t border-line pt-1">
                      {c.fields.map((f) => (
                        <li key={f.field} className="flex flex-wrap items-center gap-1 text-xs">
                          {selectable && revertible && (
                            <Checkbox
                              size="sm"
                              checked={selection[k] === "all" || (Array.isArray(selection[k]) && (selection[k] as string[]).includes(f.field))}
                              onChange={() => onToggleField?.(k, f.field)}
                              aria-label={f.label}
                              className="mr-1"
                            />
                          )}
                          <span className="font-medium text-muted-foreground">{f.label}:</span>
                          <span className="text-ui-pink-strong line-through">{fmt(f.before)}</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-ui-green-strong">{fmt(f.after)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        );
      })}
    </div>
  );
}
