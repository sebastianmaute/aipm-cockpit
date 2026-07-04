import { useCallback, useMemo, useRef, useState } from "react";
import type { Lang } from "./i18n";
import { getCtor } from "./voice";
import { createWebSpeechEngine } from "./web-speech-engine";
import type { DictationEngine } from "./dictation-engine";

const TAP_MS = 250;

interface Args {
  lang: Lang;
  enabled: boolean;
  onAppendFinal: (text: string) => void;
  onInterim: (text: string) => void;
  onError: (err: string) => void;
}

export function usePushToTalk({ lang, enabled, onAppendFinal, onInterim, onError }: Args) {
  const [listening, setListening] = useState(false);
  const supported = useMemo(() => getCtor() !== null, []);
  const engineRef = useRef<DictationEngine | null>(null);
  const pressedAtRef = useRef(0);
  const wasListeningRef = useRef(false);
  const listeningRef = useRef(false);

  const engine = () => {
    if (!engineRef.current) engineRef.current = createWebSpeechEngine(lang);
    return engineRef.current;
  };

  const startHold = useCallback(() => {
    if (!enabled) { onError("disabled"); return; }
    if (listeningRef.current) return;
    const ok = engine().start({ onFinal: onAppendFinal, onInterim, onError });
    if (ok) { listeningRef.current = true; setListening(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, lang, onAppendFinal, onInterim, onError]);

  const stopHold = useCallback(() => {
    engineRef.current?.stop();
    listeningRef.current = false;
    setListening(false);
  }, []);

  const press = useCallback(() => {
    pressedAtRef.current = Date.now();
    wasListeningRef.current = listeningRef.current;
    if (!listeningRef.current) startHold();
  }, [startHold]);

  const release = useCallback(() => {
    const held = Date.now() - pressedAtRef.current;
    if (held >= TAP_MS) { stopHold(); return; }   // HOLD → release stops
    if (wasListeningRef.current) stopHold();        // TAP while already latched → stop
    // else: first TAP → stay latched (no-op)
  }, [stopHold]);

  const toggle = useCallback(() => { if (listeningRef.current) stopHold(); else startHold(); }, [startHold, stopHold]);

  const buttonHandlers = useMemo(() => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); press(); },
    onPointerUp: () => release(),
    onPointerLeave: () => { if (listeningRef.current) stopHold(); },
    onPointerCancel: () => { if (listeningRef.current) stopHold(); },
    onKeyDown: (e: React.KeyboardEvent) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); press(); } },
    onKeyUp: (e: React.KeyboardEvent) => { if (e.key === " " || e.key === "Enter") release(); },
  }), [press, release, stopHold]);

  return { listening, supported, buttonHandlers, toggle };
}
