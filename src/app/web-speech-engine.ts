import type { Lang } from "./i18n";
import { startRecognition } from "./voice";
import type { DictationEngine, DictationHandlers } from "./dictation-engine";

/** Web Speech API dictation engine. Restarts while active (Web Speech ends on a
 *  silence gap even in continuous mode) so a held button keeps recording. */
export function createWebSpeechEngine(lang: Lang): DictationEngine {
  let active = false;
  let stopFn: (() => void) | null = null;

  const begin = (handlers: DictationHandlers): boolean => {
    stopFn = startRecognition({
      lang,
      continuous: true,
      onInterim: handlers.onInterim,
      onFinal: handlers.onFinal,
      onError: (e) => handlers.onError(e === "service-not-allowed" ? "not-allowed" : e),
      onEnd: () => { if (active) begin(handlers); },
    });
    return stopFn !== null;
  };

  return {
    start(handlers) {
      active = true;
      const ok = begin(handlers);
      if (!ok) { active = false; handlers.onError("not-supported"); }
      return ok;
    },
    stop() {
      active = false; // set BEFORE stopping so the final onEnd does not restart
      stopFn?.();
      stopFn = null;
    },
  };
}
