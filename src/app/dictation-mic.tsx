"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { MicrophoneIcon } from "@heroicons/react/24/outline";
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
  /** Replaces the mic button's default padding (`px-2 py-1`) so a caller can
   *  match a sibling control's geometry. REPLACES rather than appends: two
   *  padding utilities in one class list are resolved by Tailwind's
   *  stylesheet order, not by their order in the attribute, so appending is
   *  not a reliable override. */
  padding?: string;
  /** Non-padding layout extras (e.g. flex/centring) appended to the button's
   *  class list. */
  className?: string;
}

export function useDictationMic({
  lang,
  dictation,
  enabled = true,
  label,
  onAppendFinal,
  padding,
  className,
}: UseDictationMicArgs) {
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

  const pressRef = useRef(ptt.press);
  const releaseRef = useRef(ptt.release);
  useEffect(() => { pressRef.current = ptt.press; releaseRef.current = ptt.release; });

  const target = useMemo<DictationTarget>(() => ({
    press: () => pressRef.current(),
    release: () => releaseRef.current(),
    label,
  }), [label]);
  const registration = useMemo(() => ({
    onFocus: () => setActiveDictationTarget(target),
    onBlur: () => clearDictationTargetIf(target),
  }), [target]);
  useEffect(() => () => { clearDictationTargetIf(target); }, [target]);

  const mic = ptt.supported ? (
    <button
      type="button"
      aria-pressed={ptt.listening}
      aria-label={`${t(lang, "dictationHold")} – ${label}`}
      title={`${t(lang, "dictationHold")} – ${label}`}
      className={`rounded-md border border-line ${padding ?? "px-2 py-1"} ${INTERACTIVE} ${ptt.listening ? "text-ui-green-strong" : "text-muted-foreground"}${className ? ` ${className}` : ""}`}
      {...ptt.buttonHandlers}
    >
      <MicrophoneIcon aria-hidden="true" className="h-4 w-4" />
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
