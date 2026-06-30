"use client";

import { useRef, useState } from "react";
import { type Lang, t, type TranslationKey } from "./i18n";
import { usePopoverDismiss } from "./use-popover-dismiss";
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
  const wrapRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, wrapRef, () => setOpen(false));

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t(lang, "colConfigTitle")}
        title={t(lang, "colConfigTitle")}
        aria-expanded={open}
        className={`rounded-md p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground ${INTERACTIVE}`}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
          <path fillRule="evenodd" d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.25 1.252a6.013 6.013 0 011.317.757l1.198-.42a1 1 0 011.15.376l1.18 2.044a1 1 0 01-.205 1.274l-.96.836a6.02 6.02 0 010 1.514l.96.836a1 1 0 01.205 1.274l-1.18 2.044a1 1 0 01-1.15.376l-1.198-.42a6.014 6.014 0 01-1.317.757l-.25 1.252a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.25-1.252a6.013 6.013 0 01-1.317-.757l-1.198.42a1 1 0 01-1.15-.376L2.745 13.3a1 1 0 01.205-1.274l.96-.836a6.023 6.023 0 010-1.514l-.96-.836a1 1 0 01-.205-1.274L3.925 5.52a1 1 0 011.15-.376l1.198.42a6.013 6.013 0 011.317-.757l.25-1.252zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t(lang, "colConfigTitle")}
          className="absolute right-0 top-full z-40 mt-1 w-52 rounded-lg border border-line bg-surface p-3"
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(lang, "colConfigTitle")}</p>
          <ul className="space-y-1">
            {cols.map(({ key, labelKey }) => (
              <li key={key}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm text-foreground hover:bg-surface-muted">
                  <input
                    type="checkbox"
                    checked={!hidden.has(key)}
                    onChange={() => onToggle(key)}
                    className="h-3.5 w-3.5 rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green"
                  />
                  {t(lang, labelKey)}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
