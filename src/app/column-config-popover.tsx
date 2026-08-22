"use client";

import { useCallback, useRef, useState } from "react";
import { Cog6ToothIcon } from "./icons";
import { type Lang, t, type TranslationKey } from "./i18n";
import { PopoverPanel } from "./popover-panel";
import { Checkbox } from "./form-controls";
import { INTERACTIVE } from "./interaction-styles";

export interface ColumnConfigCol {
  key: string;
  labelKey: TranslationKey;
}

interface ColumnConfigPopoverProps {
  lang: Lang;
  cols: readonly ColumnConfigCol[];
  /** Currently hidden column keys. */
  hidden: Set<string>;
  onToggle: (key: string) => void;
}

/** Reusable "configure columns" gear popover: a checklist where a ticked box
 *  means the column is VISIBLE. Mirrors the tasks-view column manager. */
export function ColumnConfigPopover({ lang, cols, hidden, onToggle }: ColumnConfigPopoverProps) {
  const [open, setOpen] = useState(false);
  // PopoverPanel portals the checklist to <body> so the gear popover escapes the
  // toolbar's `overflow` clip; it owns dismiss (stable onClose) + anchoring.
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t(lang, "colConfigTitle")}
        title={t(lang, "colConfigTitle")}
        aria-expanded={open}
        className={`rounded-md p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground ${INTERACTIVE}`}
      >
        <Cog6ToothIcon aria-hidden="true" className="h-4 w-4" />
      </button>
      <PopoverPanel
        open={open}
        anchorRef={buttonRef}
        onClose={close}
        role="dialog"
        ariaLabel={t(lang, "colConfigTitle")}
        className="w-52 p-3"
      >
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(lang, "colConfigTitle")}</p>
        <ul className="space-y-1">
          {cols.map(({ key, labelKey }) => (
            <li key={key}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm text-foreground hover:bg-surface-muted">
                <Checkbox
                  size="sm"
                  checked={!hidden.has(key)}
                  onChange={() => onToggle(key)}
                />
                {t(lang, labelKey)}
              </label>
            </li>
          ))}
        </ul>
      </PopoverPanel>
    </div>
  );
}
