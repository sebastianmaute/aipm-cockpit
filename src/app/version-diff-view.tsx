// src/app/version-diff-view.tsx
// Read-only grouped diff display for version compare (Slice 2). Restore controls
// (checkboxes) are added in Slice 3. Presentational only.

import { useState } from "react";
import { t } from "./i18n";
import type { Lang } from "./i18n";
import type { VersionChange, ChangeType } from "./version-diff";
import { changeKey, type RestoreSelection } from "./version-restore";

const TYPE_KEY: Record<ChangeType, "historyAdded" | "historyRemoved" | "historyModified"> = {
  added: "historyAdded", removed: "historyRemoved", modified: "historyModified",
};
const TYPE_CLASS: Record<ChangeType, string> = {
  added: "text-AIPM-green-strong", removed: "text-AIPM-pink", modified: "text-muted-foreground",
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
}: {
  lang: Lang;
  changes: VersionChange[];
  selectable?: boolean;
  selection?: RestoreSelection;
  onToggleRecord?: (key: string) => void;
  onToggleField?: (key: string, field: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (changes.length === 0) {
    return <p className="text-sm text-muted-foreground">{t(lang, "historyNoChanges")}</p>;
  }
  const groups = new Map<string, VersionChange[]>();
  for (const c of changes) groups.set(c.collectionLabel, [...(groups.get(c.collectionLabel) ?? []), c]);

  const keyOf = (c: VersionChange) => changeKey(c.collection, c.recordId);
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

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
                          <span className="text-AIPM-pink line-through">{fmt(f.before)}</span>
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
