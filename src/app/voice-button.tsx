"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MicrophoneIcon, MicrophoneSlashIcon } from "./icons";
import { type Lang, t } from "./i18n";
import { usePeopleProtected } from "./ai-privacy-context";
import { ToggleButton } from "./toggle-button";
import {
  type Command,
  isVoiceSupported,
  parseCommand,
  type RecognitionStop,
  startRecognition,
} from "./voice";

function MicIcon({ className }: { className?: string }) {
  return <MicrophoneIcon aria-hidden="true" className={className ?? "h-5 w-5"} />;
}

// Shared speech-recognition state + lifecycle for the two mic buttons below.
// Only the `onFinal` transcript handler differs between call sites, so it is
// passed into `toggle` at click time; everything else (listening/supported
// state, the SSR-safe `supported` hydration, start/stop bookkeeping, and the
// permission/error mapping) is identical and lives here.
//
// AI people protection (owner decision 2026-10-31, after spec P9): while the open project protects its people,
// voice commands are OFF — the browser's built-in recognition can send the audio to the browser vendor. Read from
// `usePeopleProtected`, the same source as the dictation gate, and enforced HERE in `toggle`, so no caller of this
// hook can construct a recogniser while protected, whatever it renders. Fail closed: protected outside the provider.
export function useVoiceRecognition(lang: Lang, onError: (msg: string) => void) {
  const peopleProtected = usePeopleProtected();
  const [listening, setListening] = useState(false);
  const stopRef = useRef<RecognitionStop | null>(null);
  // The protection as of the last commit, for a result the browser delivers after protection switched on.
  const protectedRef = useRef(peopleProtected);
  // `isVoiceSupported()` reads `window.SpeechRecognition`, which doesn't
  // exist during SSR (returns false there) but does exist in Chrome / Edge
  // (returns true). Calling it directly during render would cause a
  // hydration mismatch — server emits `disabled title="unsupported"`,
  // client emits `title="click and dictate"`. We keep render-time output
  // SSR-shaped (supported = false) and update once on mount.
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client-only hydration; lazy initializer would run during SSR
    setSupported(isVoiceSupported());
    return () => {
      stopRef.current?.();
    };
  }, []);

  // Protection switched on mid-listen: ABORT the recogniser, never `stop` — a stop still delivers the pending final
  // result, which would run a command heard before the switch. Its `onEnd` clears `listening`.
  useEffect(() => {
    protectedRef.current = peopleProtected;
    if (peopleProtected) stopRef.current?.abort();
  }, [peopleProtected]);

  function toggle(onFinal: (text: string) => void) {
    if (listening) {
      stopRef.current?.();
      return;
    }
    if (peopleProtected) {
      onError(t(lang, "voiceCommandUnavailablePeopleProtected"));
      return;
    }
    if (!supported) {
      onError(t(lang, "voiceUnsupported"));
      return;
    }
    setListening(true);
    const stop = startRecognition({
      lang,
      // Belt and braces with the abort above: a result that still arrives under protection runs nothing.
      onFinal: (text) => {
        if (!protectedRef.current) onFinal(text);
      },
      onEnd: () => {
        setListening(false);
        stopRef.current = null;
      },
      onError: (err) => {
        setListening(false);
        stopRef.current = null;
        if (err === "not-allowed" || err === "service-not-allowed") {
          onError(t(lang, "voicePermissionDenied"));
        } else if (err !== "aborted" && err !== "no-speech") {
          onError(t(lang, "voiceFailed"));
        }
      },
    });
    stopRef.current = stop;
    if (!stop) setListening(false);
  }

  return { listening, supported, peopleProtected, toggle };
}

export function VoiceCommandButton({
  lang,
  onCommand,
  onError,
}: {
  lang: Lang;
  onCommand: (cmd: Command, originalText: string) => void;
  onError: (msg: string) => void;
}) {
  const { listening, supported, peopleProtected, toggle } = useVoiceRecognition(lang, onError);
  const offReasonId = useId();

  // AI people protection: the button is replaced by a compact marker, as the dictation mic is. Unlike the mic
  // this control never sits inside a field's <label>, so the marker can carry its own short name ("Voice command
  // off") and name the reason as its accessible DESCRIPTION through a `hidden` element; `title` is the sighted
  // hover hint. Not a disabled button: a disabled control leaves the tab order and cannot explain itself.
  if (peopleProtected) {
    const reason = t(lang, "voiceCommandUnavailablePeopleProtected");
    return (
      <>
        <span
          data-voice-off
          role="img"
          aria-label={t(lang, "voiceCommandOff")}
          aria-describedby={offReasonId}
          title={reason}
          className="inline-flex items-center px-1 text-muted-foreground"
        >
          <MicrophoneSlashIcon aria-hidden="true" className="h-5 w-5" />
        </span>
        <span id={offReasonId} hidden>{reason}</span>
      </>
    );
  }

  function handleClick() {
    toggle((text) => {
      const cmd = parseCommand(text, lang);
      onCommand(cmd, text);
    });
  }

  // Accessible name is PINNED to the enabled action (voice command); the
  // pressed state conveys listening, so it announces "Voice command, pressed"
  // — not "Listening, pressed" (WCAG 4.1.2 pin-the-enabled-label). The visible
  // title still flips for sighted hover.
  //
  // ★★ WCAG 1.4.1. The listening tint measured 1.21-1.42:1 against the idle
  //    background in ALL SEVEN scheme combos, i.e. it is not a distinction any
  //    user perceives — `animate-pulse` was carrying the entire state cue, and
  //    motion is no substitute (it is suppressed under prefers-reduced-motion
  //    and says nothing in a still frame). `ToggleButton` supplies the shared
  //    non-colour marker; the pulse is kept as a secondary cue, not the cue.
  // ★ Adopting the primitive turns this bare top-bar icon into a bordered
  //   chip. That footprint change was put to the user and approved on
  //   2026-09-01 under the confirm-before-window-changes rule (the top bar is
  //   window chrome) — do not "restore" the borderless look.
  // ★ The label is icon-only on screen, so it goes in an `sr-only` child,
  //   which still contributes the accessible name from content. `lang` is
  //   passed so the primitive appends the on/off state to the TOOLTIP (the
  //   accessible description) — the name above stays fixed either way. While
  //   unsupported the button is `disabled`, and the primitive suppresses that
  //   suffix, so the unsupported title stays the bare explanation.
  return (
    <ToggleButton
      pressed={listening}
      onToggle={handleClick}
      disabled={!supported}
      accent="pink"
      icon={<MicIcon />}
      title={
        supported
          ? listening
            ? t(lang, "voiceListening")
            : t(lang, "voiceCommandTip")
          : t(lang, "voiceUnsupported")
      }
      className={listening ? "animate-pulse" : undefined}
      lang={lang}
    >
      <span className="sr-only">{t(lang, "voiceCommand")}</span>
    </ToggleButton>
  );
}
