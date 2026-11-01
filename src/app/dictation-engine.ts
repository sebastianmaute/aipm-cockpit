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
 *  is chosen without it (`dictationUnavailableReason`), or a speech-to-text recording discarded because the
 *  consent was withdrawn before it was sent. */
export const DICTATION_NEEDS_AI_CONSENT = "needs-ai-consent";

/** AI-01 — the `onError` code for a press while speech-to-text is chosen, consented to, but not usable: its
 *  service address or key is missing, or the key is not in memory (`dictationUnavailableReason`). ★ Not `stt-`-prefixed:
 *  that prefix is a failed transcription. */
export const DICTATION_STT_NOT_SET_UP = "speech-service-not-set-up";

/** The deployment's AI setting stops speech-to-text: switched off by the organisation, an invalid gateway setting,
 *  or (for a recording, asked before the upload) a setting that could not be confirmed. The first two are also
 *  `dictationUnavailableReason`'s reasons for a disabled mic.
 *  ★ Not `stt-`-prefixed: that prefix is a failed transcription. */
export const DICTATION_AI_DEPLOYMENT_OFF = "ai-deployment-off";
export const DICTATION_AI_DEPLOYMENT_INVALID = "ai-deployment-invalid";
export const DICTATION_AI_DEPLOYMENT_UNCONFIRMED = "ai-deployment-unconfirmed";
/** §786: the organisation forced people protection while this tab was open, so a recording is discarded unsent. */
export const DICTATION_PEOPLE_FORCED = "people-forced";

/** Space-aware append of a dictated segment to existing text. */
export function appendDictation(prev: string, text: string): string {
  const seg = text.trim();
  if (!seg) return prev;
  if (!prev) return seg;
  return /\s$/.test(prev) ? prev + seg : prev + " " + seg;
}
