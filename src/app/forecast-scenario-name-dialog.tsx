"use client";

// The scenario name prompt (§502, spec §4.2): Rename in the Scenarios list, and "Save as scenario" in What-if
// mode, where `note` shows the value frozen at save ("+10% = 6 tasks today"). On the shared `Modal`. The name is
// local state seeded at mount (the caller mounts the dialog fresh per open), and it is checked before `onSave`:
// the hook refuses an empty or taken name without a toast. A write refused anyway (the cap or the name was taken
// elsewhere between open and Save) comes back from `onSave` as its reason: the dialog stays open and says it.
// ★ A refusal is ANNOUNCED two ways: the message is a `role="alert"` region, and focus moves to the field only
// AFTER the commit (`useFocusAfterCommit`), once `aria-invalid` and `aria-describedby` are rendered. A focus call
// inside the Save handler ran before React committed them, so a screen reader heard the field with no error.

import { useId, useLayoutEffect, useState } from "react";
import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { Button } from "./button";
import { Input } from "./form-controls";
import {
  MAX_FORECAST_SCENARIOS, MAX_SCENARIO_CHANGES, SCENARIO_NAME_MAX, isScenarioNameTaken, validateScenarioDraft,
  type ForecastScenario, type ScenarioChange, type ScenarioError,
} from "./forecast-scenarios";

export function draftErrorText(lang: Lang, e: ScenarioError): string {
  switch (e) {
    case "name-empty": return t(lang, "forecastScenarioErrNameEmpty");
    case "name-long": return t(lang, "forecastScenarioErrTooLong", SCENARIO_NAME_MAX);
    case "name-taken": return t(lang, "forecastScenarioErrNameTaken");
    case "too-many-changes": return t(lang, "forecastScenarioErrTooMany", MAX_SCENARIO_CHANGES);
    case "cap": return t(lang, "forecastScenarioCapReached", MAX_FORECAST_SCENARIOS);
  }
}

/** Why a create/update/rename the hook refused (it returns null/false without a toast): the draft rule it now
 *  fails against the current list, else the generic "changed elsewhere" (a concurrent delete, which the hook
 *  also toasts). */
export function scenarioRefusalText(
  lang: Lang, d: { name: string; changes: readonly ScenarioChange[] }, list: readonly ForecastScenario[], exceptId: number | null,
): string {
  const e = validateScenarioDraft(d, list, exceptId);
  return e === null ? t(lang, "forecastScenarioErrRefused") : draftErrorText(lang, e);
}

export type ForecastScenarioNameDialogProps = {
  lang: Lang;
  open: boolean;
  title: string;
  initialName: string;
  note?: string;
  list: readonly ForecastScenario[];
  /** The scenario being renamed (its own name is not "taken"); null when saving a new one. */
  exceptId: number | null;
  /** null = saved (the caller closes the dialog); a string = refused, shown beside the name. */
  onSave: (name: string) => string | null;
  onCancel: () => void;
};

type NameError = "empty" | "long" | "taken";

/** Focus an element by id AFTER the next commit: a refused field once it is marked invalid, or the row that
 *  takes over from a deleted one. `requests` counts the calls, so a repeated refusal can remount its alert (an
 *  unchanged message in a kept node is not announced again). The effect only moves focus — it sets no state. */
export function useFocusAfterCommit(): { requests: number; requestFocus: (id: string) => void } {
  const [request, setRequest] = useState<{ id: string; n: number } | null>(null);
  useLayoutEffect(() => {
    if (request !== null) document.getElementById(request.id)?.focus();
  }, [request]);
  return {
    requests: request?.n ?? 0,
    requestFocus: (id: string) => setRequest((prev) => ({ id, n: (prev?.n ?? 0) + 1 })),
  };
}

export function nameError(name: string, list: readonly ForecastScenario[], exceptId: number | null): NameError | null {
  const trimmed = name.trim();
  if (trimmed === "") return "empty";
  if (trimmed.length > SCENARIO_NAME_MAX) return "long";
  return isScenarioNameTaken(list, trimmed, exceptId) ? "taken" : null;
}

export function ForecastScenarioNameDialog(p: ForecastScenarioNameDialogProps) {
  const { lang } = p;
  const id = useId();
  const [name, setName] = useState(p.initialName);
  const [error, setError] = useState<NameError | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const { requests: refusals, requestFocus } = useFocusAfterCommit();
  if (!p.open) return null;

  const save = () => {
    const e = nameError(name, p.list, p.exceptId);
    setError(e);
    const reason = e === null ? p.onSave(name.trim()) : null;
    setRefused(reason);
    if (e !== null || reason !== null) requestFocus(`${id}-name`);
  };
  const message = error === "empty" ? t(lang, "forecastScenarioErrNameEmpty")
    : error === "long" ? t(lang, "forecastScenarioErrTooLong", SCENARIO_NAME_MAX)
      : error === "taken" ? t(lang, "forecastScenarioErrNameTaken") : refused;

  return (
    <Modal open onClose={p.onCancel} ariaLabelledby={`${id}-title`} align="center">
      <div data-modal-panel className="relative flex w-[420px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface">
        <ModalHeader lang={lang} title={p.title} titleId={`${id}-title`} onClose={p.onCancel} />
        <div className="flex flex-col gap-4 p-6">
          {p.note && <p className="text-sm text-muted-foreground">{p.note}</p>}
          <ScenarioNameField
            lang={lang} id={`${id}-name`} value={name} message={message} alertKey={refusals} onEnter={save}
            onChange={(v) => {
              setName(v);
              setError(null);
              setRefused(null);
            }}
          />
          <ScenarioDialogActions lang={lang} onCancel={p.onCancel} onSave={save} />
        </div>
      </div>
    </Modal>
  );
}

/** The name field both scenario dialogs use. The message sits OUTSIDE the label, so it describes the field
 *  (`aria-describedby`) without becoming part of its name, and it is an alert, so it is announced even when the
 *  field already has focus. `alertKey` (the refusal count) remounts it on each refusal. `announce={false}` drops
 *  the alert role for a caller that announces the refusal in one summary of its own (the scenario editor). */
export function ScenarioNameField({ lang, id, value, message, alertKey, announce = true, onChange, onEnter }: {
  lang: Lang; id: string; value: string; message: string | null; alertKey?: number; announce?: boolean;
  onChange: (v: string) => void; onEnter?: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1 text-sm text-foreground">
        {t(lang, "forecastScenarioName")}
        <Input
          id={id}
          autoFocus
          value={value}
          invalid={message !== null}
          aria-describedby={message !== null ? `${id}-err` : undefined}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (onEnter && e.key === "Enter" && !e.nativeEvent.isComposing) onEnter();
          }}
        />
      </label>
      {message !== null && <span key={alertKey} id={`${id}-err`} role={announce ? "alert" : undefined} className="text-xs font-medium text-ui-pink-strong">{message}</span>}
    </div>
  );
}

export function ScenarioDialogActions({ lang, onCancel, onSave }: { lang: Lang; onCancel: () => void; onSave: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" size="sm" onClick={onCancel}>{t(lang, "cancel")}</Button>
      <Button variant="primary" size="sm" onClick={onSave}>{t(lang, "forecastScenarioSave")}</Button>
    </div>
  );
}
