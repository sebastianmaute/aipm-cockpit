import type { Lang } from "./i18n";
import {
  DICTATION_AI_DEPLOYMENT_INVALID,
  DICTATION_AI_DEPLOYMENT_OFF,
  DICTATION_AI_DEPLOYMENT_UNCONFIRMED,
  DICTATION_NEEDS_AI_CONSENT,
  type DictationEngine,
  type DictationHandlers,
} from "./dictation-engine";
import { isInteractiveConsentLive } from "./ai-consent";
import { AiDeploymentError, confirmAiDeployment } from "./ai-transport";

export interface SttConfig { lang: Lang; baseUrl: string; model: string; apiKey: string; }

/** OpenAI-compatible STT engine: record with MediaRecorder, transcribe the clip
 *  via the same-origin /api/stt proxy on stop. No live interim. */
export function createSttEngine(cfg: SttConfig): DictationEngine {
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: BlobPart[] = [];
  let handlers: DictationHandlers | null = null;
  let stopped = false;
  let started = false;

  const cleanupStream = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; };

  const transcribe = async (blob: Blob) => {
    // AI-01 — the send-time check: a recording finished after AI was switched off or the consent withdrawn
    // is discarded here, never uploaded.
    if (!isInteractiveConsentLive()) {
      handlers?.onStatus?.("idle");
      handlers?.onError(DICTATION_NEEDS_AI_CONSENT);
      return;
    }
    handlers?.onStatus?.("transcribing");
    try {
      // The deployment's AI setting, asked before the upload as before every AI send: switched off or
      // invalid discards the clip; unconfirmed sends nothing. Each has its own code, because the user
      // cannot turn the deployment back on. A changed route does not matter here: STT goes through
      // `/api/stt`, never the Anthropic route.
      try {
        await confirmAiDeployment();
      } catch (e) {
        const reason = e instanceof AiDeploymentError ? e.reason : "unconfirmed";
        if (reason !== "route-changed") {
          handlers?.onError(
            reason === "off"
              ? DICTATION_AI_DEPLOYMENT_OFF
              : reason === "invalid"
                ? DICTATION_AI_DEPLOYMENT_INVALID
                : DICTATION_AI_DEPLOYMENT_UNCONFIRMED,
          );
          return;
        }
      }
      const form = new FormData();
      form.append("file", blob, "audio.webm");
      form.append("model", cfg.model);
      form.append("baseUrl", cfg.baseUrl);
      const res = await fetch("/api/stt", { method: "POST", headers: { "x-stt-key": cfg.apiKey }, body: form });
      if (!res.ok) { handlers?.onError(`stt-${res.status}`); return; }
      const data = (await res.json()) as { text?: string };
      if (data.text && data.text.trim()) handlers?.onFinal(data.text.trim());
    } catch {
      handlers?.onError("stt-network");
    } finally {
      handlers?.onStatus?.("idle");
    }
  };

  return {
    start(h) {
      handlers = h;
      if (started) return true; // already capturing / acquiring — ignore re-entry
      started = true;
      stopped = false;
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        h.onError("not-supported"); return false;
      }
      chunks = [];
      navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => {
        if (stopped) { s.getTracks().forEach((t) => t.stop()); return; } // aborted during the permission prompt — release the mic
        stream = s;
        recorder = new MediaRecorder(s);
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = () => {
          cleanupStream();
          const blob = new Blob(chunks, { type: recorder?.mimeType || "audio/webm" });
          if (blob.size === 0) { h.onStatus?.("idle"); return; }
          void transcribe(blob);
        };
        recorder.start();
      }).catch(() => { if (!stopped) h.onError("not-allowed"); });
      return true; // async; mic-denied arrives via onError → hook resets
    },
    stop() {
      stopped = true;
      started = false;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      else cleanupStream();
      recorder = null;
    },
  };
}
