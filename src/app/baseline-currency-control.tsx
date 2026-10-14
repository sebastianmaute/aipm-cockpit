"use client";
import { useId, useState } from "react";
import { type Lang, t } from "./i18n";
import { Select } from "./form-controls";
import { InfoTooltip } from "./info-tooltip";
import { useWorkspace } from "./workspace-context";
import { crossRate } from "./baseline-currency";
import { planBaselineSwitch } from "./baseline-switch";
import { roleLabel } from "./resource-foundation";
import { BaselineSwitchDialog } from "./baseline-switch-dialog";
import { SUPPORTED_CURRENCIES, isBudgetCurrency, type BudgetCurrency, type FxRates } from "./types";

export interface BaselineCurrencyControlProps {
  lang: Lang;
  /** The table a refresh fetched in THIS session (`useFxRates().sessionRates`),
   *  never the cached `workspace.fxRates`: the switch converts every stored rate
   *  once, at today's rate, so a months-old cached table must not drive it. */
  sessionRates: FxRates | null;
  workdayHours: number;
}

/**
 * The project baseline-currency picker (§476). Choosing a currency opens a
 * confirmation listing every converted value; only Confirm writes, through the
 * five workspace setters, and it captures NO undo entry (the dialog says the
 * switch cannot be undone; switching back is the way back).
 *
 * ★ Reads `useWorkspace()` itself so `BudgetPanel` need not (it is not memo'd
 * today, but keeping the context read here keeps the panel's props the only
 * thing it depends on).
 * ★ "Disabled while `loadPending`" holds by construction: the whole main-window
 * tree, this control included, is unmounted while a load is pending (§548), so
 * it can never be operated mid-load.
 */
export function BaselineCurrencyControl({ lang, sessionRates, workdayHours }: BaselineCurrencyControlProps) {
  const ws = useWorkspace();
  const { plan, roles, budgets, changes, disciplines, grades } = ws;
  const [pendingTo, setPendingTo] = useState<BudgetCurrency | null>(null);
  const selectId = useId();
  const needsRatesId = useId();
  const from = plan.currency;

  const buildPlan = (to: BudgetCurrency, rates: FxRates, nowIso: string) =>
    planBaselineSwitch({
      from,
      to,
      sessionRates: rates,
      roles,
      buckets: budgets,
      changes,
      workdayHours,
      roleLabel: (r) => roleLabel(r, disciplines, grades),
      nowIso,
    });

  // The preview's history entry is never written: Confirm re-plans from the
  // live state with its own event-time timestamp. "" keeps `new Date()` out of
  // the render body.
  const preview = pendingTo && sessionRates ? buildPlan(pendingTo, sessionRates, "") : null;

  const cancel = () => setPendingTo(null);

  const confirm = () => {
    if (!pendingTo || !sessionRates) return;
    const result = buildPlan(pendingTo, sessionRates, new Date().toISOString());
    setPendingTo(null);
    if (!result) return;
    ws.setRoles(result.roles);
    ws.setBudgets(result.buckets);
    ws.setChanges(result.changes);
    ws.setPlan((p) => ({ ...p, currency: result.to }));
    ws.setBaselineHistory((h) => [...h, result.entry]);
  };

  const disabled = sessionRates === null;

  return (
    <div className="flex items-center gap-1.5 text-sm print:hidden">
      <label htmlFor={selectId} className="text-muted-foreground">
        {t(lang, "baselineCurrencyLabel")}
      </label>
      <Select
        id={selectId}
        size="xs"
        value={from}
        disabled={disabled}
        aria-describedby={disabled ? needsRatesId : undefined}
        onChange={(e) => {
          const to = e.target.value;
          if (isBudgetCurrency(to) && to !== from) setPendingTo(to);
        }}
      >
        {SUPPORTED_CURRENCIES.map((c) => (
          <option key={c} value={c} disabled={c !== from && (!sessionRates || crossRate(sessionRates, from, c) === null)}>
            {c}
          </option>
        ))}
      </Select>
      <InfoTooltip text={t(lang, "baselineCurrencyHint")} />
      {disabled && (
        <span id={needsRatesId} className="text-xs text-muted-foreground">
          {t(lang, "baselineCurrencyNeedsRates")}
        </span>
      )}
      {preview && <BaselineSwitchDialog lang={lang} plan={preview} onCancel={cancel} onConfirm={confirm} />}
    </div>
  );
}
