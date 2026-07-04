"use client";

import { useState } from "react";
import { type Lang, t } from "../i18n";
import { type Settings } from "../settings-types";
import { SegmentedControl } from "../segmented-control";
import { InfoTooltip } from "../info-tooltip";
import { saveSecretValue } from "../use-secrets";
import { loadSealed, removeSealed } from "../secrets-store";
import { FOCUS_RING, TRANSITION } from "../interaction-styles";

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
            <input
              type="text"
              aria-label={t(lang, "dictationSttBaseUrl")}
              value={dictation?.sttBaseUrl ?? ""}
              onChange={(e) => setDictation({ sttBaseUrl: e.target.value })}
              className={`w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none ${FOCUS_RING} ${TRANSITION}`}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">
              {t(lang, "dictationSttModel")}
            </span>
            <input
              type="text"
              aria-label={t(lang, "dictationSttModel")}
              placeholder="whisper-1"
              value={dictation?.sttModel ?? ""}
              onChange={(e) => setDictation({ sttModel: e.target.value })}
              className={`w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-line focus:outline-none ${FOCUS_RING} ${TRANSITION}`}
            />
          </label>
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
              {t(lang, "dictationSttKey")}
              <InfoTooltip text={t(lang, "dictationSttNote")} />
            </span>
            <input
              type="password"
              autoComplete="off"
              aria-label={t(lang, "dictationSttKey")}
              value={dictation?.sttApiKey ?? ""}
              onChange={(e) => handleSttKeyChange(e.target.value)}
              onBlur={handleSttKeyBlur}
              className={`w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none ${FOCUS_RING} ${TRANSITION}`}
            />
          </label>
          <p className="text-xs text-muted-foreground">{t(lang, "dictationSttNote")}</p>
        </div>
      )}
    </div>
  );
}
