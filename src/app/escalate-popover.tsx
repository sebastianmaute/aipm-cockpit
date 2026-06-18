"use client";
import { useState, useRef, useEffect } from "react";
import { type Lang, t } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";
import type { RaidItem, Resource } from "./types";
import { ResourcePicker, type ResourcePickerValue } from "./resource-picker";
import { isValidEmail } from "./sanitize";
import { planEscalation } from "./action-escalate";

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
}

const EMPTY_RECIPIENT: ResourcePickerValue = { name: "", email: "", resourceId: null };

export function EscalatePopover({ lang, action, bundle }: EscalatePopoverProps) {
  const [open, setOpen] = useState(false);
  const [recipient, setRecipient] = useState<ResourcePickerValue>(EMPTY_RECIPIENT);
  const [emailInput, setEmailInput] = useState("");
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
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); toggleOpen(); }}
        className="cursor-pointer rounded-md border border-line px-2 py-1 text-xs font-medium text-AIPM-dark-blue transition-colors hover:border-AIPM-dark-blue/40 hover:bg-AIPM-dark-blue/10 dark:text-AIPM-light-grey"
      >
        {t(lang, "actionEscalate")}
      </button>
      {open && plan && (
        <span
          ref={popRef}
          role="dialog"
          aria-label={t(lang, "actionEscalateTitle")}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
          className="absolute right-0 top-full z-20 mt-1 w-72 rounded-md border border-line bg-surface p-2"
        >
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
            className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-AIPM-green"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={!canConfirm}
              onClick={(e) => { e.stopPropagation(); confirm(); }}
              className="cursor-pointer rounded-md border border-line px-3 py-1 text-xs font-medium text-AIPM-dark-blue transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 dark:text-AIPM-light-grey"
            >
              {t(lang, "actionEscalateConfirm")}
            </button>
          </div>
        </span>
      )}
    </span>
  );
}
