"use client";
import { useState, useRef, useCallback } from "react";
import { type Lang, t } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";
import { isValidIsoDate } from "./action-rebaseline";
import { popoverTriggerClass } from "./action-cta-styles";
import { PopoverPanel } from "./popover-panel";

export interface RescheduleBundle {
  onReschedule: (action: SuggestedAction, isoDate: string) => void;
  /** Resolves the entity's CURRENT due date (ISO) for display + prefill. */
  currentDueDate?: (action: SuggestedAction) => string | undefined;
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
  const btnRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  const currentDue = bundle.currentDueDate?.(action);
  const canConfirm = isValidIsoDate(date);
  const toggleOpen = () => { if (!open) setDate(currentDue ?? ""); setOpen((o) => !o); };
  const confirm = () => { bundle.onReschedule(action, date); setDate(""); setOpen(false); };

  return (
    <span className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); toggleOpen(); }}
        className={popoverTriggerClass(prominent)}
      >
        {t(lang, "actionReschedule")}
      </button>
      <PopoverPanel
        open={open}
        anchorRef={btnRef}
        onClose={close}
        role="dialog"
        ariaLabel={t(lang, "actionReschedule")}
        className="w-64 p-2"
      >
        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t(lang, "actionRescheduleTitle")}
        </label>
        {currentDue && (
          <p className="mb-1 text-[11px] text-muted-foreground">
            {t(lang, "currentDueDate", currentDue)}
          </p>
        )}
        <input
          type="date"
          aria-label={t(lang, "actionRescheduleTitle")}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ui-green"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            disabled={!canConfirm}
            onClick={(e) => { e.stopPropagation(); confirm(); }}
            className="cursor-pointer rounded-md border border-line px-3 py-1 text-xs font-medium text-ui-dark-blue transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 dark:text-ui-light-grey"
          >
            {t(lang, "actionRescheduleConfirm")}
          </button>
        </div>
      </PopoverPanel>
    </span>
  );
}
