"use client";
import { useEffect, useMemo, useState } from "react";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import type { Settings } from "./settings-types";
import { usePushToTalk } from "./use-push-to-talk";
import { reportCapabilityGap } from "./guard-feedback";
import { useToastContext } from "./toast-context";
import { INTERACTIVE } from "./interaction-styles";
import { setActiveDictationTarget, clearDictationTargetIf, type DictationTarget } from "./dictation-target";

interface UseDictationMicArgs {
  lang: Lang;
  dictation?: Settings["dictation"];
  enabled?: boolean;
  label: string;
  onAppendFinal: (text: string) => void;
}

export function useDictationMic({ lang, dictation, enabled = true, label, onAppendFinal }: UseDictationMicArgs) {
  const showToast = useToastContext();
  const [interim, setInterim] = useState("");
  const ptt = usePushToTalk({
    lang,
    enabled,
    dictation,
    onAppendFinal: (txt) => { onAppendFinal(txt); setInterim(""); },
    onInterim: (txt) => setInterim(txt),
    onError: (err) => {
      setInterim("");
      if (err === "not-allowed") reportCapabilityGap(showToast, lang, "dictation.micDenied", "dictationMicDenied");
      else if (err.startsWith("stt-")) showToast("error", t(lang, "dictationTranscribeFailed"));
      else if (err === "not-supported") showToast("error", t(lang, "dictationRecordUnsupported"));
    },
  });

  const target = useMemo<DictationTarget>(() => ({ press: ptt.press, release: ptt.release, label }), [ptt.press, ptt.release, label]);
  const registration = useMemo(() => ({
    onFocus: () => setActiveDictationTarget(target),
    onBlur: () => clearDictationTargetIf(target),
  }), [target]);
  useEffect(() => () => { clearDictationTargetIf(target); }, [target]);

  const mic = ptt.supported ? (
    <button
      type="button"
      aria-pressed={ptt.listening}
      aria-label={t(lang, "dictationHold")}
      title={t(lang, "dictationHold")}
      className={`rounded-md border border-line px-2 py-1 ${INTERACTIVE} ${ptt.listening ? "text-AIPM-green-strong" : "text-muted-foreground"}`}
      {...ptt.buttonHandlers}
    >
      🎙
    </button>
  ) : null;

  const status = (ptt.listening || ptt.transcribing) ? (
    <span className="text-xs text-muted-foreground" aria-live="polite">
      {ptt.transcribing ? t(lang, "dictationTranscribing") : t(lang, "dictationListening")}
      {interim ? ` ${interim}` : ""}
    </span>
  ) : null;

  return { mic, status, registration, supported: ptt.supported };
}
