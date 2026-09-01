"use client";
import { useState, useRef, useCallback } from "react";
import { type Lang, t } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";
import type { RaidItem, Resource } from "./types";
import { ResourcePicker, type ResourcePickerValue } from "./resource-picker";
import { isValidEmail } from "./sanitize";
import { planEscalation } from "./action-escalate";
import { POPOVER_CONFIRM_BTN } from "./action-cta-styles";
import { ActionPopoverTrigger } from "./action-popover-trigger";
import { Input } from "./form-controls";

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
  /** Occurrence-qualified row name, threaded from the list owner. REQUIRED —
   *  see `ActionPopoverTrigger` (§324). */
  rowToken: string;
  /** Hero surface renders the trigger as a prominent filled CTA. */
  prominent?: boolean;
}

const EMPTY_RECIPIENT: ResourcePickerValue = { name: "", email: "", resourceId: null };

export function EscalatePopover({ lang, action, bundle, rowToken, prominent }: EscalatePopoverProps) {
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
    // Adopt a picked address; on a CLEAR (the ✕ empties name AND email) drop the
    // previously adopted one too — `resolvedEmail` falls back to `emailInput`,
    // so leaving it set kept the just-cleared recipient armed as the send
    // target under an empty name. A pick that carries a name but no email
    // preserves a manually typed address.
    if (next.email || !next.name) setEmailInput(next.email);
  };

  return (
    <ActionPopoverTrigger
      label={t(lang, "actionEscalate")}
      ariaLabel={t(lang, "actionEscalateTitle")}
      rowToken={rowToken}
      open={open}
      panelOpen={open && !!plan}
      onToggle={toggleOpen}
      onClose={close}
      btnRef={btnRef}
      prominent={prominent}
      panelClassName="w-72 p-2"
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
            // The visible <span> above is NOT an accessible label — without this
            // the combobox has no name at all.
            aria-label={t(lang, "actionEscalateRecipient")}
          />
          <Input
            type="email"
            aria-label={t(lang, "actionEscalateEmailPlaceholder")}
            placeholder={t(lang, "actionEscalateEmailPlaceholder")}
            value={emailInput}
            onChange={(e) => {
              setEmailInput(e.target.value);
              setRecipient((r) => ({ ...r, email: e.target.value }));
            }}
            className="mt-1 w-full"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={!canConfirm}
              onClick={(e) => { e.stopPropagation(); confirm(); }}
              className={POPOVER_CONFIRM_BTN}
            >
              {t(lang, "actionEscalateConfirm")}
            </button>
          </div>
          </>
        )}
    </ActionPopoverTrigger>
  );
}
