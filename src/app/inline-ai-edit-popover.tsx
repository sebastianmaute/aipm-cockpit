"use client";
import { useEffect, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { FieldError } from "./field-feedback";
import { type EditPlan } from "./inline-ai-edit/plan";
import { type InlinePhase } from "./use-inline-ai-edit";
import { usePopoverDismiss } from "./use-popover-dismiss";
import { MODAL_BACKDROP_CLASS } from "./modal";
import { INTERACTIVE, FOCUS_RING, TRANSITION } from "./interaction-styles";
import { Button } from "./button";

export interface InlineAiEditPopoverProps {
  lang: Lang;
  itemTitle: string;
  entityLabel: string;
  phase: InlinePhase;
  plan: EditPlan | null;
  clarifyText: string;
  errorText: string;
  onSubmit: (instruction: string) => void;
  onApply: () => void;
  onCancel: () => void;
}

export function InlineAiEditPopover(props: InlineAiEditPopoverProps) {
  const { lang, itemTitle, entityLabel, phase, plan, clarifyText, errorText, onSubmit, onApply, onCancel } = props;
  const [value, setValue] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  usePopoverDismiss(true, ref, onCancel);
  // Focus management for the aria-modal dialog: move focus to the NL input on
  // open and RESTORE it to the trigger (the ✨ button) on close. Not a state
  // update, so no set-state-in-effect concern.
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => prevFocus?.focus?.();
  }, []);
  // Trap Tab within the dialog so keyboard focus can't escape to the background
  // (parity with the shared Modal; the bespoke overlay isn't a Modal instance).
  const onKeyDownTrap = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const focusables = ref.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    );
    const list = focusables ? Array.from(focusables) : [];
    if (list.length === 0) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const busy = phase === "thinking" || phase === "applying";

  return (
    <div className={`fixed inset-0 z-[70] flex items-center justify-center ${MODAL_BACKDROP_CLASS} p-4`}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={t(lang, "inlineAiEdit")}
        onKeyDown={onKeyDownTrap}
        className="w-[420px] max-w-[95vw] rounded-xl border border-line bg-surface p-4"
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">{t(lang, "inlineAiEditTitle")}</h2>
          <button type="button" onClick={onCancel} aria-label={t(lang, "cancel")} className={`rounded-md px-2 text-muted-foreground hover:text-foreground ${INTERACTIVE}`}>✕</button>
        </div>
        <p className="mb-3 truncate text-xs text-muted-foreground"><span className="font-medium">{entityLabel}</span> · {itemTitle}</p>

        {phase !== "preview" && (
          <form onSubmit={(e) => { e.preventDefault(); if (value.trim() && !busy) onSubmit(value.trim()); }}>
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label={t(lang, "inlineAiEditTitle")}
              placeholder={t(lang, "inlineAiEditPlaceholder")}
              disabled={busy}
              className={`w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground disabled:opacity-50 ${FOCUS_RING} ${TRANSITION}`}
            />
            <div className="mt-2 flex justify-end">
              <Button type="submit" size="sm" disabled={busy || !value.trim()}>
                {t(lang, "inlineAiEdit")}
              </Button>
            </div>
          </form>
        )}

        {phase === "thinking" && <p className="mt-3 text-xs text-muted-foreground">{t(lang, "inlineAiEditThinking")}</p>}

        {phase === "clarify" && (
          <p className="mt-3 text-xs text-foreground"><span className="font-medium">{t(lang, "inlineAiEditClarify")}</span> {clarifyText}</p>
        )}

        {phase === "error" && errorText && <FieldError>{errorText}</FieldError>}

        {phase === "preview" && plan && (
          <div className="mt-1">
            <p className="mb-2 text-xs font-medium text-foreground">{t(lang, "inlineAiEditPreview")}</p>
            <ul className="mb-3 space-y-1 text-xs text-foreground">
              {plan.updates.map((d) => (
                <li key={d.field}><span className="font-medium">{d.field}</span>: {d.before || "—"} → {d.after || "—"}</li>
              ))}
              {plan.creates.map((c, i) => (<li key={`c${i}`}>{t(lang, "inlineAiEditCreate", c.entity, c.title)}</li>))}
              {plan.deletes.map((del, i) => (<li key={`d${i}`}>{t(lang, "inlineAiEditDelete", del.entity, del.label)}</li>))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={onCancel}>{t(lang, "cancel")}</Button>
              <Button size="sm" onClick={onApply}>{t(lang, "inlineAiEditApply")}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
