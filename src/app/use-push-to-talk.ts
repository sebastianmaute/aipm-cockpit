import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "./i18n";
import { getCtor } from "./voice";
import { resolveDictationEngine } from "./dictation-config";
import type { DictationEngine } from "./dictation-engine";

const TAP_MS = 250;

interface Args {
  lang: Lang;
  enabled: boolean;
  onAppendFinal: (text: string) => void;
  onInterim: (text: string) => void;
  onError: (err: string) => void;
  dictation?: { engine: "web-speech" | "stt"; sttBaseUrl?: string; sttModel?: string; sttApiKey?: string };
}

export function usePushToTalk({ lang, enabled, onAppendFinal, onInterim, onError, dictation }: Args) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const supported = useMemo(() => getCtor() !== null, []);
  const engineRef = useRef<DictationEngine | null>(null);
  const pressedAtRef = useRef(0);
  const wasListeningRef = useRef(false);
  const listeningRef = useRef(false);
  const pressingRef = useRef(false);
  const cfgKey = `${lang}|${dictation?.engine ?? "web-speech"}|${dictation?.sttBaseUrl ?? ""}|${dictation?.sttModel ?? ""}|${dictation?.sttApiKey ? "k" : ""}`;
  const cfgKeyRef = useRef(cfgKey);

  const engine = () => {
    if (!engineRef.current || cfgKeyRef.current !== cfgKey) {
      engineRef.current?.stop();
      engineRef.current = resolveDictationEngine(dictation, lang);
      cfgKeyRef.current = cfgKey;
    }
    return engineRef.current;
  };

  const stopHold = useCallback(() => {
    engineRef.current?.stop();
    listeningRef.current = false;
    setListening(false);
    setTranscribing(false);
    onInterim("");
  }, [onInterim]);

  const handleError = useCallback((err: string) => {
    if (err === "not-allowed" || err === "not-supported" || err === "audio-capture") {
      listeningRef.current = false;
      setListening(false);
      setTranscribing(false);
      onInterim("");
    }
    onError(err);
  }, [onInterim, onError]);

  useEffect(() => () => { engineRef.current?.stop(); }, []);

  const startHold = useCallback(() => {
    if (!enabled) { onError("disabled"); return; }
    if (listeningRef.current) return;
    const ok = engine().start({ onFinal: onAppendFinal, onInterim, onError: handleError, onStatus: (s) => setTranscribing(s === "transcribing") });
    if (ok) { listeningRef.current = true; setListening(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, lang, onAppendFinal, onInterim, onError, handleError]);

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
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); pressingRef.current = true; press(); },
    onPointerUp: () => { pressingRef.current = false; release(); },
    onPointerLeave: () => { if (pressingRef.current) { pressingRef.current = false; release(); } },
    onPointerCancel: () => { if (pressingRef.current) { pressingRef.current = false; release(); } },
    onKeyDown: (e: React.KeyboardEvent) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); press(); } },
    onKeyUp: (e: React.KeyboardEvent) => { if (e.key === " " || e.key === "Enter") release(); },
  }), [press, release]);

  return { listening, transcribing, supported, buttonHandlers, toggle };
}
