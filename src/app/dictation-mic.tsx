"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { MicrophoneIcon } from "./icons";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import type { Settings } from "./settings-types";
import { usePushToTalk } from "./use-push-to-talk";
import { reportCapabilityGap } from "./guard-feedback";
import { useToastContext } from "./toast-context";
import { PRESS, TRANSITION } from "./interaction-styles";
import { ToggleButton } from "./toggle-button";
import { setActiveDictationTarget, clearDictationTargetIf, type DictationTarget } from "./dictation-target";

interface UseDictationMicArgs {
  lang: Lang;
  dictation?: Settings["dictation"];
  enabled?: boolean;
  label: string;
  onAppendFinal: (text: string) => void;
  /** Replaces the mic button's default padding (`px-2! py-1!`) so a caller can
   *  match a sibling control's geometry. It REPLACES that default rather than
   *  joining it — two padding utilities in one class list are resolved by
   *  Tailwind's stylesheet order, not by their order in the attribute.
   *  ★★ Each utility MUST carry Tailwind v4's trailing `!`. The button is a
   *  `ToggleButton`, whose own chip geometry (`px-2.5 py-1.5`) is in the same
   *  class list; without `!` which one wins is decided by the generated
   *  stylesheet, which no call site controls. And it must be a literal in the
   *  CALLER's source — Tailwind extracts class candidates statically, so a
   *  `!` appended at runtime would name a utility that was never generated. */
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

  // ★★ WCAG 1.4.1. The listening cue used to be the icon colour ALONE
  //    (`--ui-green-strong` vs `--muted-foreground`), which clears 3:1 in
  //    exactly ONE of the seven scheme combos (harbor-light, 3.08) and
  //    measures 1.20-2.72 in the other six. The "Listening" text is not a
  //    fallback either: this hook hands back `mic` and `status` as SEPARATE
  //    nodes, so where the text lands — or whether it is rendered at all — is
  //    the consumer's choice, and note-log-panel drops it. `ToggleButton`
  //    gives the button the shared non-colour marker, so it carries its own
  //    state however a consumer arranges the pieces.
  // ★ No `lang` is passed: the primitive's tooltip suffix says "click to turn
  //   on/off", which misdescribes a push-to-talk control that is HELD. The
  //   title stays the caller's own hold instruction.
  // ★ `FOCUS_RING` is dropped from the composed classes — it is byte-identical
  //   to the ring the primitive already emits when unpressed, and the primitive
  //   additionally recolours it to match the pressed accent. Only `TRANSITION`
  //   and `PRESS` still have to come from here.
  const mic = ptt.supported ? (
    <ToggleButton
      pressed={ptt.listening}
      // Push-to-talk has no click semantic: the hold is driven entirely by
      // `pressHandlers`, and their keydown calls preventDefault, which
      // suppresses the synthetic click a keyboard press would otherwise emit.
      onToggle={() => {}}
      // Icon-only on screen, so the (row-unique) name rides an `sr-only`
      // child rather than an `aria-label` — name-from-content yields the same
      // string, and passing both would leave the visible-to-AT span dead.
      title={`${t(lang, "dictationHold")} – ${label}`}
      icon={<MicrophoneIcon aria-hidden="true" className="h-4 w-4" />}
      className={`${padding ?? "px-2! py-1!"} ${TRANSITION} ${PRESS}${className ? ` ${className}` : ""}`}
      pressHandlers={ptt.buttonHandlers}
    >
      <span className="sr-only">{`${t(lang, "dictationHold")} – ${label}`}</span>
    </ToggleButton>
  ) : null;

  const status = (ptt.listening || ptt.transcribing) ? (
    <span className="text-xs text-muted-foreground" aria-live="polite">
      {ptt.transcribing ? t(lang, "dictationTranscribing") : t(lang, "dictationListening")}
      {interim ? ` ${interim}` : ""}
    </span>
  ) : null;

  return { mic, status, registration, supported: ptt.supported };
}
