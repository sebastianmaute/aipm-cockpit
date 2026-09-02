"use client";

import { useEffect, useRef, useState } from "react";
import { MicrophoneIcon } from "./icons";
import { type Lang, t } from "./i18n";
import { ToggleButton } from "./toggle-button";
import {
  type Command,
  isVoiceSupported,
  parseCommand,
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
function useVoiceRecognition(lang: Lang, onError: (msg: string) => void) {
  const [listening, setListening] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
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

  function toggle(onFinal: (text: string) => void) {
    if (listening) {
      stopRef.current?.();
      return;
    }
    if (!supported) {
      onError(t(lang, "voiceUnsupported"));
      return;
    }
    setListening(true);
    const stop = startRecognition({
      lang,
      onFinal,
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

  return { listening, supported, toggle };
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
  const { listening, supported, toggle } = useVoiceRecognition(lang, onError);

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
