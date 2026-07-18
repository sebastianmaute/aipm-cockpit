"use client";

import { t, type Lang } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";
import { ToggleButton } from "./toggle-button";

interface BulkEditBarProps {
  lang: Lang;
  count: number;
  open: boolean;
  onToggleOpen: () => void;
  onClear: () => void;
}

/** "N selected" action bar shown above an entity table when rows are selected.
 *  Mirrors the tasks selection bar: a Bulk-edit toggle + Clear. Self-hides at
 *  zero selection. */
export function BulkEditBar({ lang, count, open, onToggleOpen, onClear }: BulkEditBarProps) {
  if (count === 0) return null;
  return (
    <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-line bg-surface-muted px-3 py-1.5">
      <span className="text-xs font-medium text-foreground">{t(lang, "selectionCount", String(count))}</span>
      <ToggleButton pressed={open} onToggle={onToggleOpen}>
        {t(lang, "bulkEdit")}
      </ToggleButton>
      <button
        type="button"
        onClick={onClear}
        className={`rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-surface-muted hover:text-foreground ${INTERACTIVE}`}
      >
        {t(lang, "clearSelection")}
      </button>
    </div>
  );
}
