"use client";
import { useState, useRef, useEffect } from "react";
import { type Lang, t } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";
import { isValidIsoDate } from "./action-rebaseline";

export interface RescheduleBundle {
  onReschedule: (action: SuggestedAction, isoDate: string) => void;
}

interface ReschedulePopoverProps {
  lang: Lang;
  action: SuggestedAction;
  bundle: RescheduleBundle;
}

export function ReschedulePopover({ lang, action, bundle }: ReschedulePopoverProps) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const popRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (open) popRef.current?.querySelector<HTMLElement>("input,button,[tabindex]")?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const canConfirm = isValidIsoDate(date);
  const toggleOpen = () => { if (!open) setDate(""); setOpen((o) => !o); };
  const confirm = () => { bundle.onReschedule(action, date); setDate(""); setOpen(false); };

  return (
    <span className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); toggleOpen(); }}
        className="cursor-pointer rounded-md border border-line px-2 py-1 text-xs font-medium text-AIPM-dark-blue transition-colors hover:border-AIPM-dark-blue/40 hover:bg-AIPM-dark-blue/10 dark:text-AIPM-light-grey"
      >
        {t(lang, "actionReschedule")}
      </button>
      {open && (
        <span
          ref={popRef}
          role="dialog"
          aria-label={t(lang, "actionReschedule")}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
          className="absolute right-0 top-full z-20 mt-1 w-64 rounded-md border border-line bg-surface p-2"
        >
          <label
            htmlFor="reschedule-date-input"
            className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            {t(lang, "actionRescheduleTitle")}
          </label>
          <input
            id="reschedule-date-input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-AIPM-green"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={!canConfirm}
              onClick={(e) => { e.stopPropagation(); confirm(); }}
              className="cursor-pointer rounded-md border border-line px-3 py-1 text-xs font-medium text-AIPM-dark-blue transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 dark:text-AIPM-light-grey"
            >
              {t(lang, "actionRescheduleConfirm")}
            </button>
          </div>
        </span>
      )}
    </span>
  );
}
