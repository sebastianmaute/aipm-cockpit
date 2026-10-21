"use client";
import { useId, useState } from "react";
import { flushSync } from "react-dom";
import { type Lang, t } from "./i18n";
import { Select } from "./form-controls";
import { InfoTooltip } from "./info-tooltip";
import { isIntegrationDisabled } from "./integration-switches";
import { useWorkspace } from "./workspace-context";
import { useActivityLog } from "./use-activity-log";
import { crossRate, roundRate } from "./baseline-currency";
import { convertBucket, convertChange, convertRole, planBaselineSwitch } from "./baseline-switch";
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
  /** The project day (`clock.today`, via `BudgetPanel`), which a switch's history entry starts on. */
  today: string;
}

/**
 * The project baseline-currency picker (§476). Choosing a currency opens a
 * confirmation listing every converted value; only Confirm writes, through the
 * five workspace setters, and it captures NO undo entry (the dialog says the
 * switch cannot be undone; switching back is the way back). Every undo/redo
 * entry captured BEFORE it is retired too — its images hold old-currency
 * amounts — through `useDenominationEpoch`'s share of the undo epoch. Confirm
 * also records ONE `plan.currencySwitched` activity entry (actor "user").
 *
 * ★ Reads `useWorkspace()` itself so `BudgetPanel` need not (it is not memo'd
 * today, but keeping the context read here keeps the panel's props the only
 * thing it depends on).
 * ★ "Disabled while `loadPending`" holds by construction: the whole main-window
 * tree, this control included, is unmounted while a load is pending (§548), so
 * it can never be operated mid-load.
 */
export function BaselineCurrencyControl({ lang, sessionRates, workdayHours, today }: BaselineCurrencyControlProps) {
  const ws = useWorkspace();
  // The Confirm click is a user gesture all the way down, so the leaf names the actor.
  const { logActivityUser } = useActivityLog();
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
      today,
    });

  // The preview's history entry is never written: Confirm re-plans from the
  // live state with its own event-time timestamp. "" keeps `new Date()` out of
  // the render body.
  const preview = pendingTo && sessionRates ? buildPlan(pendingTo, sessionRates, "") : null;
  // A pending choice that is no longer a switch (a peer tab already made it, or the
  // session table went away) is DROPPED, not merely hidden: kept, it would bring the
  // dialog back on its own once the currency changed again. Render-time reconcile —
  // `set-state-in-effect` is banned here.
  if (pendingTo !== null && preview === null) setPendingTo(null);

  const cancel = () => setPendingTo(null);

  const confirm = () => {
    if (!pendingTo || !sessionRates) return;
    const result = buildPlan(pendingTo, sessionRates, new Date().toISOString());
    setPendingTo(null);
    if (!result) return;
    // §476 — decide against the LIVE currency, not the one this render planned from: a
    // peer tab's switch can be queued in the same tick, before this tab re-renders, and
    // converting on top of it would convert the money twice. The probe updater returns
    // `p` unchanged (pure under StrictMode's double invoke); `flushSync` makes it run
    // now, after every update queued before it, so `held` is final when read.
    let held = false;
    flushSync(() => ws.setPlan((p) => {
      held = p.currency === result.from;
      return p;
    }));
    if (!held) return;
    // FUNCTIONAL setters that convert `prev` at the plan's rate (AGENTS.md "N saves in one
    // tick"): a record another writer queued in the same tick is converted too, never
    // overwritten by the snapshot this render planned from. One history append.
    const { rate } = result;
    ws.setRoles((prev) => prev.map((r) => convertRole(r, rate, workdayHours)));
    ws.setBudgets((prev) => prev.map((b) => convertBucket(b, rate)));
    ws.setChanges((prev) => prev.map((c) => convertChange(c, rate)));
    ws.setPlan((p) => ({ ...p, currency: result.to }));
    ws.setBaselineHistory((h) => [...h, result.entry]);
    logActivityUser("plan.currencySwitched", result.from, result.to, roundRate(result.rate), result.fxDate);
  };

  // §762 — a switch needs today's ECB rates; without the ECB the control stays visible, disabled, and says why.
  const ecbOff = isIntegrationDisabled("ecb");
  const disabled = ecbOff || sessionRates === null;

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
          {t(lang, ecbOff ? "integrationNotAvailable" : "baselineCurrencyNeedsRates")}
        </span>
      )}
      {preview && <BaselineSwitchDialog lang={lang} plan={preview} onCancel={cancel} onConfirm={confirm} />}
    </div>
  );
}
