import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "./i18n";
import { getCtor } from "./voice";
import { dictationBlockedByConsent, resolveDictationEngine } from "./dictation-config";
import { DICTATION_NEEDS_AI_CONSENT, type DictationEngine } from "./dictation-engine";

const TAP_MS = 250;

export function hashKey(s: string | undefined): string {
  if (!s) return "";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}

interface Args {
  lang: Lang;
  enabled: boolean;
  onAppendFinal: (text: string) => void;
  onInterim: (text: string) => void;
  onError: (err: string) => void;
  dictation?: { engine: "web-speech" | "stt"; sttBaseUrl?: string; sttModel?: string; sttApiKey?: string };
  /** Cloud STT is used only when the AI data disclosure is accepted (D9); with STT chosen and no consent,
   *  dictation is unavailable (`unavailable`), never switched to another engine. */
  aiConsented: boolean;
}

export function usePushToTalk({ lang, enabled, onAppendFinal, onInterim, onError, dictation, aiConsented }: Args) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const supported = useMemo(() => getCtor() !== null, []);
  const engineRef = useRef<DictationEngine | null>(null);
  const pressedAtRef = useRef(0);
  const wasListeningRef = useRef(false);
  const listeningRef = useRef(false);
  const pressingRef = useRef(false);
  const cfgKey = `${lang}|${dictation?.engine ?? "web-speech"}|${dictation?.sttBaseUrl ?? ""}|${dictation?.sttModel ?? ""}|${hashKey(dictation?.sttApiKey)}|${aiConsented ? "c" : "n"}`;
  const cfgKeyRef = useRef(cfgKey);

  const unavailable = dictationBlockedByConsent(dictation, aiConsented);

  const engine = (): DictationEngine | null => {
    if (!engineRef.current || cfgKeyRef.current !== cfgKey) {
      engineRef.current?.stop();
      engineRef.current = resolveDictationEngine(dictation, lang, aiConsented);
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
    // AI-01 — speech-to-text without its consent: unavailable, never another engine.
    const current = unavailable ? null : engine();
    if (!current) { onError(DICTATION_NEEDS_AI_CONSENT); return; }
    const ok = current.start({ onFinal: onAppendFinal, onInterim, onError: handleError, onStatus: (s) => setTranscribing(s === "transcribing") });
    if (ok) { listeningRef.current = true; setListening(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, unavailable, lang, onAppendFinal, onInterim, onError, handleError]);

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

  return { listening, transcribing, supported, unavailable, buttonHandlers, toggle, press, release };
}
