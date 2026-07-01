"use client";
import { useState, useRef, useEffect } from "react";
import { type Lang, t } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";
import { isValidIsoDate } from "./action-rebaseline";
import { usePopoverDismiss } from "./use-popover-dismiss";
import { popoverTriggerClass } from "./action-cta-styles";

export interface RescheduleBundle {
  onReschedule: (action: SuggestedAction, isoDate: string) => void;
}

interface ReschedulePopoverProps {
  lang: Lang;
  action: SuggestedAction;
  bundle: RescheduleBundle;
  /** Hero surface renders the trigger as a prominent filled CTA. */
  prominent?: boolean;
}

export function ReschedulePopover({ lang, action, bundle, prominent }: ReschedulePopoverProps) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const wrapRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);

  usePopoverDismiss(open, wrapRef, () => setOpen(false));

  useEffect(() => {
    if (open) popRef.current?.querySelector<HTMLElement>("input,button,[tabindex]")?.focus();
  }, [open]);

  const canConfirm = isValidIsoDate(date);
  const toggleOpen = () => { if (!open) setDate(""); setOpen((o) => !o); };
  const confirm = () => { bundle.onReschedule(action, date); setDate(""); setOpen(false); };

  return (
    <span ref={wrapRef} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); toggleOpen(); }}
        className={popoverTriggerClass(prominent)}
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
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t(lang, "actionRescheduleTitle")}
          </label>
          <input
            type="date"
            aria-label={t(lang, "actionRescheduleTitle")}
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
