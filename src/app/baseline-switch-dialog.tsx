"use client";
import { useId, useRef } from "react";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { Button } from "./button";
import { type Lang, type TranslationKey, t, localeFor } from "./i18n";
import type { BaselineSwitchPlan, SwitchRow } from "./baseline-switch";

/**
 * Confirmation for a baseline-currency switch (§476). Pure presentational: the
 * caller owns the plan and applies it on confirm. Escape, the backdrop and the ✕
 * all route to `onCancel` through the shared `Modal` (dismissal stack — see
 * docs/AGENTS/ui-shell.md "dismissal"). Cancel takes focus on open and comes
 * first in the footer, because the confirmed switch cannot be undone.
 */
export interface BaselineSwitchDialogProps {
  lang: Lang;
  plan: BaselineSwitchPlan;
  onCancel: () => void;
  onConfirm: () => void;
}

// The planner reports raw field names; the dialog translates them. A field the
// planner adds later without a key here falls back to its raw name.
const FIELD_LABEL: Readonly<Record<string, TranslationKey>> = {
  internalRate: "baselineSwitchFieldInternalRate",
  externalRate: "baselineSwitchFieldExternalRate",
  internalRateDay: "baselineSwitchFieldInternalRateDay",
  externalRateDay: "baselineSwitchFieldExternalRateDay",
  rateOverrideInternal: "budgetRateOverrideInternal",
  rateOverrideExternal: "budgetRateOverrideExternal",
  costImpact: "changeFieldCostImpact",
};

function fieldLabel(lang: Lang, field: string): string {
  const key = FIELD_LABEL[field];
  return key ? t(lang, key) : field;
}

function formatMoney(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function rowKey(row: SwitchRow): string {
  return `${row.kind}:${row.id}:${row.field}`;
}

export function BaselineSwitchDialog({ lang, plan, onCancel, onConfirm }: BaselineSwitchDialogProps) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const locale = localeFor(lang);
  const title = t(lang, "baselineSwitchTitle", plan.to);
  const rate = new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(plan.rate);

  return (
    <Modal open onClose={onCancel} ariaLabelledby={titleId} align="center" initialFocusRef={cancelRef}>
      <div
        data-modal-panel
        className="relative flex max-h-[85vh] w-[560px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader lang={lang} title={title} titleId={titleId} onClose={onCancel} />
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-6 text-sm text-foreground">
          <p>{t(lang, "baselineSwitchRate", plan.from, rate, plan.to, plan.fxDate)}</p>
          {plan.rows.length > 0 && (
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line text-xs text-muted-foreground">
                  <th scope="col" className="py-1 pr-3 font-medium">{t(lang, "baselineSwitchColItem")}</th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">{t(lang, "baselineSwitchColBefore")}</th>
                  <th scope="col" className="py-1 text-right font-medium">{t(lang, "baselineSwitchColAfter")}</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((row) => (
                  <tr key={rowKey(row)} className="border-b border-line last:border-b-0">
                    <td className="py-1 pr-3">
                      {row.label}
                      <span className="text-muted-foreground"> – {fieldLabel(lang, row.field)}</span>
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums">{formatMoney(row.before, plan.from, locale)}</td>
                    <td className="py-1 text-right tabular-nums">{formatMoney(row.after, plan.to, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-muted-foreground">{t(lang, "baselineSwitchPast")}</p>
          <p className="font-medium">{t(lang, "baselineSwitchNoUndo")}</p>
          <div className="flex justify-end gap-2">
            <Button ref={cancelRef} variant="secondary" size="sm" onClick={onCancel}>
              {t(lang, "cancel")}
            </Button>
            <Button variant="primary" size="sm" onClick={onConfirm}>
              {t(lang, "baselineSwitchConfirm", plan.to)}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
