"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MicrophoneIcon, MicrophoneSlashIcon } from "./icons";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import type { Settings } from "./settings-types";
import { usePushToTalk } from "./use-push-to-talk";
import { reportCapabilityGap } from "./guard-feedback";
import { useToastContext } from "./toast-context";
import { PRESS, TRANSITION } from "./interaction-styles";
import { ToggleButton } from "./toggle-button";
import { setActiveDictationTarget, clearDictationTargetIf, type DictationTarget } from "./dictation-target";
import { usePeopleProtected } from "./ai-privacy-context";
import {
  DICTATION_AI_DEPLOYMENT_INVALID,
  DICTATION_AI_DEPLOYMENT_OFF,
  DICTATION_AI_DEPLOYMENT_UNCONFIRMED,
  DICTATION_NEEDS_AI_CONSENT,
  DICTATION_PEOPLE_FORCED,
  DICTATION_STT_NOT_SET_UP,
} from "./dictation-engine";

interface UseDictationMicArgs {
  lang: Lang;
  dictation?: Settings["dictation"];
  /** `isAiConsentedForDictation(settings.ai)`: cloud speech-to-text sends audio off-device, so it needs the AI switch on and the AI data disclosure accepted. */
  aiConsented: boolean;
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
  aiConsented,
  enabled = true,
  label,
  onAppendFinal,
  padding,
  className,
}: UseDictationMicArgs) {
  const showToast = useToastContext();
  const [interim, setInterim] = useState("");
  const unavailableReasonId = useId();
  // AI people protection: the id of the dictation-off reason, as the field's accessible DESCRIPTION.
  const offReasonId = useId();
  // AI people protection (P9): with protection on, dictation is OFF — both engines send audio to a third
  // party and audio cannot be redacted. Read HERE, once for every mic in the app, so a new dictation site is
  // covered without anyone remembering to. `enabled: false` also stops the focused-field hotkey (`target.press`).
  const peopleProtected = usePeopleProtected();
  const ptt = usePushToTalk({
    lang,
    enabled: enabled && !peopleProtected,
    dictation,
    aiConsented: aiConsented && !peopleProtected,
    onAppendFinal: (txt) => { onAppendFinal(txt); setInterim(""); },
    onInterim: (txt) => setInterim(txt),
    onError: (err) => {
      setInterim("");
      if (err === "not-allowed") reportCapabilityGap(showToast, lang, "dictation.micDenied", "dictationMicDenied");
      else if (err.startsWith("stt-")) showToast("error", t(lang, "dictationTranscribeFailed"));
      else if (err === "not-supported") showToast("error", t(lang, "dictationRecordUnsupported"));
      else if (err === DICTATION_NEEDS_AI_CONSENT) showToast("error", t(lang, "dictationUnavailableNeedsAiConsent"));
      else if (err === DICTATION_STT_NOT_SET_UP) showToast("error", t(lang, "dictationUnavailableSttNotSetUp"));
      else if (err === DICTATION_AI_DEPLOYMENT_OFF) showToast("error", t(lang, "aiDeploymentOff"));
      else if (err === DICTATION_AI_DEPLOYMENT_INVALID) showToast("error", t(lang, "aiDeploymentInvalid"));
      else if (err === DICTATION_AI_DEPLOYMENT_UNCONFIRMED) showToast("error", t(lang, "aiDeploymentUnconfirmed"));
      else if (err === DICTATION_PEOPLE_FORCED) showToast("error", t(lang, "dictationUnavailablePeopleProtected"));
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
  // AI-01 — speech-to-text chosen without the AI consent, or not fully set up: the button is disabled, and the
  // reason is its accessible description (a disabled button leaves the tab order, so it cannot explain itself on
  // focus).
  const reason = !ptt.unavailable
    ? null
    : t(
        lang,
        ptt.unavailableReason === DICTATION_STT_NOT_SET_UP
          ? "dictationUnavailableSttNotSetUp"
          : ptt.unavailableReason === DICTATION_AI_DEPLOYMENT_OFF
            ? "aiDeploymentOff"
            : ptt.unavailableReason === DICTATION_AI_DEPLOYMENT_INVALID
              ? "aiDeploymentInvalid"
              : "dictationUnavailableNeedsAiConsent",
      );
  // ★★ Review rounds 1–2 (I2): only where a mic WOULD render (`ptt.supported`), and compact. Several callers
  //   place the mic INSIDE a field's <label> (the milestone name), where any exposed text — even an
  //   `aria-label` — joins that input's accessible NAME. So the icon is `aria-hidden` (its `title` is the
  //   sighted hover hint), and the reason reaches assistive tech as the field's DESCRIPTION: a `hidden` span
  //   (hidden content stays out of a label's name) that every call site names in its input's
  //   `aria-describedby` through `describedById`.
  const mic = !ptt.supported ? null : peopleProtected ? (
    <>
      <span
        data-dictation-off
        aria-hidden="true"
        title={t(lang, "dictationUnavailablePeopleProtected")}
        className="inline-flex items-center px-1 text-muted-foreground"
      >
        <MicrophoneSlashIcon aria-hidden="true" className="h-4 w-4" />
      </span>
      <span id={offReasonId} hidden>{t(lang, "dictationUnavailablePeopleProtected")}</span>
    </>
  ) : (
    <>
    <ToggleButton
      disabled={ptt.unavailable}
      ariaDescribedBy={ptt.unavailable ? unavailableReasonId : undefined}
      pressed={ptt.listening}
      // Push-to-talk has no click semantic: the hold is driven entirely by
      // `pressHandlers`, and their keydown calls preventDefault, which
      // suppresses the synthetic click a keyboard press would otherwise emit.
      onToggle={() => {}}
      // ★ Green rather than the primitive's dark-blue chrome default. The green
      //   was never the problem — the problem was that it was the ONLY cue;
      //   `accent="green"` puts it on a border derived to clear 3:1 against
      //   --line and leaves the shared non-colour marker to carry SC 1.4.1.
      // ★★ WHAT SURVIVES IS THE BORDER AND THE 10% TINT, NOT THE GLYPH, and an
      //   earlier wording here ("keeps its GREEN identity") overstated that.
      //   `PRESSED.green` sets `text-ui-dark-blue dark:text-ui-light-grey` and
      //   the mic glyph is `currentColor`, so the LISTENING icon — formerly
      //   `--ui-green-strong` — is now dark-blue in light schemes and
      //   light-grey in dark ones. Deliberate and left alone: the marker plus
      //   the derived border already carry the requirement, and recolouring the
      //   glyph back would be an unmeasured change to a primitive every other
      //   consumer shares.
      accent="green"
      // Icon-only on screen, so the (row-unique) name rides an `sr-only`
      // child rather than an `aria-label` — name-from-content yields the same
      // string, and passing both would leave the visible-to-AT span dead.
      title={reason ?? `${t(lang, "dictationHold")} – ${label}`}
      icon={<MicrophoneIcon aria-hidden="true" className="h-4 w-4" />}
      className={`${padding ?? "px-2! py-1!"} ${TRANSITION} ${PRESS}${className ? ` ${className}` : ""}`}
      pressHandlers={ptt.buttonHandlers}
    >
      <span className="sr-only">{`${t(lang, "dictationHold")} – ${label}`}</span>
    </ToggleButton>
    {reason && <span id={unavailableReasonId} hidden>{reason}</span>}
    </>
  );

  const status = (ptt.listening || ptt.transcribing) ? (
    <span className="text-xs text-muted-foreground" aria-live="polite">
      {ptt.transcribing ? t(lang, "dictationTranscribing") : t(lang, "dictationListening")}
      {interim ? ` ${interim}` : ""}
    </span>
  ) : null;

  // `describedById`: every call site adds it to its field's `aria-describedby`. Defined ONLY while the reason
  // element above is rendered, so an unprotected field's description is exactly what it was (no dangling id).
  // ★ A rich-text editor reads `ariaDescribedBy` at MOUNT, so one mounted before protection switched on does
  //   not gain the description until it remounts (the next time its window opens); the mic is gone either way.
  const describedById = ptt.supported && peopleProtected ? offReasonId : undefined;
  return { mic, status, registration, supported: ptt.supported, describedById };
}
