"use client";
import { useState, useRef, useCallback } from "react";
import { type Lang, t } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";
import type { RaidItem, Resource } from "./types";
import { ResourcePicker, type ResourcePickerValue } from "./resource-picker";
import { isValidEmail } from "./sanitize";
import { planEscalation } from "./action-escalate";
import { popoverTriggerClass } from "./action-cta-styles";
import { PopoverPanel } from "./popover-panel";

export interface EscalateBundle {
  resources: readonly Resource[];
  onCreateResource: (name: string, email: string) => number;
  raid: readonly RaidItem[];
  onEscalate: (
    action: SuggestedAction,
    recipient: { name: string; email: string; resourceId: number | null },
  ) => void;
}

interface EscalatePopoverProps {
  lang: Lang;
  action: SuggestedAction;
  bundle: EscalateBundle;
  /** Hero surface renders the trigger as a prominent filled CTA. */
  prominent?: boolean;
}

const EMPTY_RECIPIENT: ResourcePickerValue = { name: "", email: "", resourceId: null };

export function EscalatePopover({ lang, action, bundle, prominent }: EscalatePopoverProps) {
  const [open, setOpen] = useState(false);
  const [recipient, setRecipient] = useState<ResourcePickerValue>(EMPTY_RECIPIENT);
  const [emailInput, setEmailInput] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  const id = action.cta.kind === "open" ? Number(action.cta.id) : -1;
  const item = bundle.raid.find((r) => r.id === id);
  const plan = item ? planEscalation(item) : null;

  // Email comes from ResourcePicker selection (if it carries an email) or the standalone email input.
  const resolvedEmail = recipient.email || emailInput;
  const canConfirm = isValidEmail(resolvedEmail);

  const toggleOpen = () => {
    if (!open) { setRecipient(EMPTY_RECIPIENT); setEmailInput(""); }
    setOpen((o) => !o);
  };

  const confirm = () => {
    bundle.onEscalate(action, {
      name: recipient.name,
      email: resolvedEmail,
      resourceId: recipient.resourceId ?? null,
    });
    setRecipient(EMPTY_RECIPIENT);
    setEmailInput("");
    setOpen(false);
  };

  const handlePickerChange = (next: { name: string; email: string; resourceId: number | null }) => {
    setRecipient(next);
    if (next.email) setEmailInput(next.email);
  };

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
        {t(lang, "actionEscalate")}
      </button>
      <PopoverPanel
        open={open && !!plan}
        anchorRef={btnRef}
        onClose={close}
        role="dialog"
        ariaLabel={t(lang, "actionEscalateTitle")}
        className="w-72 p-2"
      >
        {plan && (
          <>
          <p className="mb-2 text-xs text-foreground">
            {plan.raisesSeverity && plan.from && plan.to
              ? t(lang, "actionEscalateRaiseSeverity", plan.from, plan.to)
              : plan.reason === "risk"
                ? t(lang, "actionEscalateNotifyOnlyRisk")
                : t(lang, "actionEscalateNotifyOnlyMax")}
          </p>
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t(lang, "actionEscalateRecipient")}
          </span>
          <ResourcePicker
            lang={lang}
            value={recipient}
            resources={bundle.resources}
            contacts={[]}
            onCreateResource={bundle.onCreateResource}
            onChange={handlePickerChange}
          />
          <input
            type="email"
            aria-label={t(lang, "actionEscalateEmailPlaceholder")}
            placeholder={t(lang, "actionEscalateEmailPlaceholder")}
            value={emailInput}
            onChange={(e) => {
              setEmailInput(e.target.value);
              setRecipient((r) => ({ ...r, email: e.target.value }));
            }}
            className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ui-green"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={!canConfirm}
              onClick={(e) => { e.stopPropagation(); confirm(); }}
              className="cursor-pointer rounded-md border border-line px-3 py-1 text-xs font-medium text-ui-dark-blue transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 dark:text-ui-light-grey"
            >
              {t(lang, "actionEscalateConfirm")}
            </button>
          </div>
          </>
        )}
      </PopoverPanel>
    </span>
  );
}
