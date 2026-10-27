// The engine seam a future STT backend plugs into. Pure — no React. SP1 ships one impl.
export interface DictationHandlers {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (err: string) => void; // "not-allowed" | "not-supported" | SR error code
  onStatus?: (status: "transcribing" | "idle") => void; // STT-only; web-speech ignores it
}
export interface DictationEngine {
  /** Begin capturing. Returns false if unsupported / failed to start. */
  start(handlers: DictationHandlers): boolean;
  /** Stop capturing. Idempotent. */
  stop(): void;
}

/** AI-01 — the `onError` code when dictation needs the AI consent it does not have: a press while speech-to-text
 *  is chosen without it (`dictationBlockedByConsent`), or a speech-to-text recording discarded because the consent
 *  was withdrawn before it was sent. */
export const DICTATION_NEEDS_AI_CONSENT = "needs-ai-consent";

/** Space-aware append of a dictated segment to existing text. */
export function appendDictation(prev: string, text: string): string {
  const seg = text.trim();
  if (!seg) return prev;
  if (!prev) return seg;
  return /\s$/.test(prev) ? prev + seg : prev + " " + seg;
}
