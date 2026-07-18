"use client";

import { useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { type Lang, t } from "../i18n";
import { type Settings } from "../settings-types";
import { SegmentedControl } from "../segmented-control";
import { InfoTooltip } from "../info-tooltip";
import { FieldHint } from "../field-hint";
import { saveSecretValue } from "../use-secrets";
import { loadSealed, removeSealed } from "../secrets-store";
import { INTERACTIVE } from "../interaction-styles";
import { eventToCombo, eventComboFromMouse, mouseButtonToToken } from "../dictation-hotkey";
import { Input } from "../form-controls";

const IGNORED_MODIFIER_KEYS = ["Control", "Shift", "Alt", "Meta"];

interface DictationSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
}

type DictationEngineId = "web-speech" | "stt";

export function DictationSection({ lang, settings, onChange }: DictationSectionProps) {
  const dictation = settings.dictation;
  const engine: DictationEngineId = dictation?.engine ?? "web-speech";
  const [sttKeyStored, setSttKeyStored] = useState(() => loadSealed("sttApiKey") != null);
  const [hotkeyArmed, setHotkeyArmed] = useState(false);
  const hotkey = dictation?.hotkey ?? "F4";

  function setDictation(patch: Partial<NonNullable<Settings["dictation"]>>) {
    onChange({ ...settings, dictation: { engine, ...dictation, ...patch } });
  }

  function handleSttKeyChange(value: string) {
    setDictation({ sttApiKey: value });
  }

  function handleSttKeyBlur() {
    const v = (settings.dictation?.sttApiKey ?? "").trim();
    if (v) {
      void saveSecretValue("sttApiKey", v, "device").then(() => setSttKeyStored(true));
    } else if (sttKeyStored) {
      removeSealed("sttApiKey");
      setSttKeyStored(false);
    }
  }

  function handleHotkeyCapture(e: KeyboardEvent<HTMLButtonElement>) {
    if (!hotkeyArmed) return;
    if (IGNORED_MODIFIER_KEYS.includes(e.key)) return;
    e.preventDefault();
    const combo = eventToCombo(e);
    setDictation({ hotkey: combo });
    setHotkeyArmed(false);
  }

  function handleHotkeyReset() {
    setDictation({ hotkey: "F4" });
    setHotkeyArmed(false);
  }

  /** While armed, intercept a capturable mouse button (middle / Back / Forward) before the
   *  browser acts on it (Back/Forward nav) — mirrors handleHotkeyCapture's keyboard path.
   *  A non-capturable button (left/right) just disarms without touching the event, so a normal
   *  click/context-menu is never stolen. Bound to BOTH mousedown and auxclick since engines
   *  differ on which event initiates history navigation. */
  function handleHotkeyMouseCapture(e: ReactMouseEvent<HTMLButtonElement>) {
    if (!hotkeyArmed) return;
    const token = mouseButtonToToken(e.button);
    if (!token) {
      setHotkeyArmed(false);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const combo = eventComboFromMouse(e);
    if (combo) setDictation({ hotkey: combo });
    setHotkeyArmed(false);
  }

  return (
    <div className="mb-4">
      <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
        {t(lang, "dictationEngine")}
      </span>
      <SegmentedControl<DictationEngineId>
        value={engine}
        ariaLabel={t(lang, "dictationEngine")}
        className="w-full"
        options={[
          { value: "web-speech", label: t(lang, "dictationEngineWebSpeech") },
          { value: "stt", label: t(lang, "dictationEngineStt") },
        ]}
        onChange={(v) => setDictation({ engine: v })}
      />

      {engine === "stt" && (
        <div className="mt-3 flex flex-col gap-2">
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">
              {t(lang, "dictationSttBaseUrl")}
            </span>
            <Input
              type="text"
              className="w-full"
              aria-label={t(lang, "dictationSttBaseUrl")}
              value={dictation?.sttBaseUrl ?? ""}
              onChange={(e) => setDictation({ sttBaseUrl: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">
              {t(lang, "dictationSttModel")}
            </span>
            <Input
              type="text"
              className="w-full"
              aria-label={t(lang, "dictationSttModel")}
              placeholder="whisper-1"
              value={dictation?.sttModel ?? ""}
              onChange={(e) => setDictation({ sttModel: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
              {t(lang, "dictationSttKey")}
              <InfoTooltip text={t(lang, "dictationSttNote")} />
            </span>
            <Input
              type="password"
              className="w-full"
              autoComplete="off"
              aria-label={t(lang, "dictationSttKey")}
              value={dictation?.sttApiKey ?? ""}
              onChange={(e) => handleSttKeyChange(e.target.value)}
              onBlur={handleSttKeyBlur}
            />
          </label>
          <FieldHint>{t(lang, "dictationSttNote")}</FieldHint>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-1">
        <span className="mb-1 block text-sm font-medium text-foreground">
          {t(lang, "dictationHotkey")}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={t(lang, "dictationHotkey")}
            onClick={() => setHotkeyArmed(true)}
            onKeyDown={handleHotkeyCapture}
            onMouseDown={handleHotkeyMouseCapture}
            onAuxClick={handleHotkeyMouseCapture}
            onBlur={() => setHotkeyArmed(false)}
            className={`rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground ${INTERACTIVE}`}
          >
            {hotkeyArmed ? t(lang, "dictationHotkeySet") : hotkey}
          </button>
          <button
            type="button"
            aria-label={t(lang, "dictationHotkeyReset")}
            onClick={handleHotkeyReset}
            className={`rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground ${INTERACTIVE}`}
          >
            {t(lang, "dictationHotkeyReset")}
          </button>
        </div>
        <FieldHint>{t(lang, "dictationHotkeyNote")}</FieldHint>
      </div>
    </div>
  );
}
