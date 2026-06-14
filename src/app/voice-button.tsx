"use client";

import { useEffect, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import {
  type Command,
  isVoiceSupported,
  parseCommand,
  startRecognition,
} from "./voice";

function MicIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      className={className ?? "h-5 w-5"}
    >
      <path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" />
      <path d="M5.5 9.643a.75.75 0 00-1.5 0V10c0 3.06 2.29 5.585 5.25 5.954V17.5h-1.5a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-1.5v-1.546A6.001 6.001 0 0016 10v-.357a.75.75 0 00-1.5 0V10a4.5 4.5 0 01-9 0v-.357z" />
    </svg>
  );
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

  function handleClick() {
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
      onFinal: (text) => {
        const cmd = parseCommand(text, lang);
        onCommand(cmd, text);
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

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={listening}
      aria-label={
        listening ? t(lang, "voiceListening") : t(lang, "voiceCommand")
      }
      title={
        supported
          ? listening
            ? t(lang, "voiceListening")
            : t(lang, "voiceCommandTip")
          : t(lang, "voiceUnsupported")
      }
      disabled={!supported}
      className={`rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-AIPM-green disabled:cursor-not-allowed disabled:opacity-50 ${
        listening
          ? "animate-pulse bg-AIPM-pink/15 text-AIPM-dark-blue dark:bg-AIPM-pink/20 dark:text-AIPM-light-grey"
          : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
      }`}
    >
      <MicIcon />
    </button>
  );
}

export function InlineMicButton({
  lang,
  onTranscript,
  onError,
}: {
  lang: Lang;
  onTranscript: (text: string) => void;
  onError: (msg: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  // Same SSR-hydration concern as VoiceCommandButton. This component
  // currently only mounts inside the (initially closed) task modal, so the
  // mismatch doesn't fire in practice — but the lazy useState pattern is
  // the right shape regardless and protects against future refactors that
  // would surface this button during initial render.
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client-only hydration; lazy initializer would run during SSR
    setSupported(isVoiceSupported());
    return () => {
      stopRef.current?.();
    };
  }, []);

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
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
      onFinal: (text) => onTranscript(text),
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

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={listening}
      aria-label={
        listening ? t(lang, "voiceListening") : t(lang, "voiceFieldHint")
      }
      title={
        listening ? t(lang, "voiceListening") : t(lang, "voiceFieldHint")
      }
      className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 ${
        listening
          ? "animate-pulse text-AIPM-pink-strong"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <MicIcon className="h-4 w-4" />
    </button>
  );
}
