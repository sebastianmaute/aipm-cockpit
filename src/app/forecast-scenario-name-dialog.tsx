"use client";

// The scenario name prompt (§502, spec §4.2): Rename in the Scenarios list, and "Save as scenario" in What-if
// mode, where `note` shows the value frozen at save ("+10% = 6 tasks today"). On the shared `Modal`. The name is
// local state seeded at mount (the caller mounts the dialog fresh per open), and it is checked before `onSave`:
// the hook refuses an empty or taken name without a toast.

import { useId, useState } from "react";
import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { Button } from "./button";
import { Input } from "./form-controls";
import { SCENARIO_NAME_MAX, isScenarioNameTaken, type ForecastScenario } from "./forecast-scenarios";

export type ForecastScenarioNameDialogProps = {
  lang: Lang;
  open: boolean;
  title: string;
  initialName: string;
  note?: string;
  list: readonly ForecastScenario[];
  /** The scenario being renamed (its own name is not "taken"); null when saving a new one. */
  exceptId: number | null;
  onSave: (name: string) => void;
  onCancel: () => void;
};

type NameError = "empty" | "long" | "taken";

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
  if (!p.open) return null;

  const save = () => {
    const e = nameError(name, p.list, p.exceptId);
    setError(e);
    if (e === null) p.onSave(name.trim());
    else document.getElementById(`${id}-name`)?.focus();
  };
  const message = error === "empty" ? t(lang, "forecastScenarioErrNameEmpty")
    : error === "long" ? t(lang, "forecastScenarioErrTooLong", SCENARIO_NAME_MAX)
      : error === "taken" ? t(lang, "forecastScenarioErrNameTaken") : null;

  return (
    <Modal open onClose={p.onCancel} ariaLabelledby={`${id}-title`} align="center">
      <div data-modal-panel className="relative flex w-[420px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface">
        <ModalHeader lang={lang} title={p.title} titleId={`${id}-title`} onClose={p.onCancel} />
        <div className="flex flex-col gap-4 p-6">
          {p.note && <p className="text-sm text-muted-foreground">{p.note}</p>}
          <ScenarioNameField
            lang={lang} id={`${id}-name`} value={name} message={message} onEnter={save}
            onChange={(v) => {
              setName(v);
              setError(null);
            }}
          />
          <ScenarioDialogActions lang={lang} onCancel={p.onCancel} onSave={save} />
        </div>
      </div>
    </Modal>
  );
}

/** The name field both scenario dialogs use. The message sits OUTSIDE the label, so it describes the field
 *  (`aria-describedby`) without becoming part of its name. */
export function ScenarioNameField({ lang, id, value, message, onChange, onEnter }: {
  lang: Lang; id: string; value: string; message: string | null; onChange: (v: string) => void; onEnter?: () => void;
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
      {message !== null && <span id={`${id}-err`} className="text-xs font-medium text-ui-pink-strong">{message}</span>}
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
