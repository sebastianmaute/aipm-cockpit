import type { Lang } from "./i18n";
import { getCtor, startRecognition } from "./voice";
import {
  DICTATION_PEOPLE_FORCED,
  DICTATION_PEOPLE_LOCK_UNCONFIRMED,
  type DictationEngine,
  type DictationHandlers,
} from "./dictation-engine";
import { checkSpeechPeopleLock } from "./speech-people-lock";

/** Web Speech API dictation engine. Restarts while active (Web Speech ends on a
 *  silence gap even in continuous mode) so a held button keeps recording.
 *
 *  §789: the browser's recogniser makes no request to this app, so each start first asks the server whether the
 *  organisation now forces people protection (`checkSpeechPeopleLock`) and listens only on a clear answer. A lock,
 *  or no trustworthy answer, starts nothing (fail closed). `start` still answers synchronously: true means the
 *  hold has begun, and a refusal arrives through `onError`. A stop while the check is out wins: the recogniser
 *  is never created. The silence-gap restarts are one hold and are not checked again. */
export function createWebSpeechEngine(lang: Lang): DictationEngine {
  let active = false;
  let stopFn: (() => void) | null = null;
  // Bumped by every start, so a check that resolves for an earlier hold is ignored once a new hold has begun.
  let generation = 0;

  const begin = (handlers: DictationHandlers): boolean => {
    stopFn = startRecognition({
      lang,
      continuous: true,
      onInterim: handlers.onInterim,
      onFinal: handlers.onFinal,
      onError: (e) => {
        const code = e === "service-not-allowed" ? "not-allowed" : e;
        if (code === "not-allowed" || code === "audio-capture") { active = false; stopFn = null; }
        handlers.onError(code);
      },
      onEnd: () => { if (active) begin(handlers); },
    });
    return stopFn !== null;
  };

  return {
    start(handlers) {
      if (getCtor() === null) { handlers.onError("not-supported"); return false; }
      active = true;
      const mine = ++generation;
      void checkSpeechPeopleLock().then((lock) => {
        if (mine !== generation || !active) return;
        if (lock !== "clear") {
          active = false;
          handlers.onError(lock === "locked" ? DICTATION_PEOPLE_FORCED : DICTATION_PEOPLE_LOCK_UNCONFIRMED);
          return;
        }
        if (!begin(handlers)) { active = false; handlers.onError("not-supported"); }
      });
      return true;
    },
    stop() {
      active = false; // set BEFORE stopping so the final onEnd does not restart; also drops a check still out
      stopFn?.();
      stopFn = null;
    },
  };
}
