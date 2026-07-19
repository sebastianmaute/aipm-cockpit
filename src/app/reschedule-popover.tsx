"use client";
import { useState, useRef, useCallback } from "react";
import { type Lang, t } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";
import { isValidIsoDate } from "./action-rebaseline";
import { POPOVER_CONFIRM_BTN } from "./action-cta-styles";
import { ActionPopoverTrigger } from "./action-popover-trigger";
import { Input } from "./form-controls";

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
    <ActionPopoverTrigger
      label={t(lang, "actionReschedule")}
      ariaLabel={t(lang, "actionReschedule")}
      open={open}
      onToggle={toggleOpen}
      onClose={close}
      btnRef={btnRef}
      prominent={prominent}
      panelClassName="w-64 p-2"
    >
      <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t(lang, "actionRescheduleTitle")}
      </label>
      {currentDue && (
        <p className="mb-1 text-[11px] text-muted-foreground">
          {t(lang, "currentDueDate", currentDue)}
        </p>
      )}
      <Input
        type="date"
        aria-label={t(lang, "actionRescheduleTitle")}
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="w-full"
      />
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          disabled={!canConfirm}
          onClick={(e) => { e.stopPropagation(); confirm(); }}
          className={POPOVER_CONFIRM_BTN}
        >
          {t(lang, "actionRescheduleConfirm")}
        </button>
      </div>
    </ActionPopoverTrigger>
  );
}
