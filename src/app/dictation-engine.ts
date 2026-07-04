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

/** Space-aware append of a dictated segment to existing text. */
export function appendDictation(prev: string, text: string): string {
  const seg = text.trim();
  if (!seg) return prev;
  if (!prev) return seg;
  return /\s$/.test(prev) ? prev + seg : prev + " " + seg;
}
