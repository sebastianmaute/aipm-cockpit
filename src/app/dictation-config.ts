import type { Lang } from "./i18n";
import type { DictationEngine } from "./dictation-engine";
import { createWebSpeechEngine } from "./web-speech-engine";
import { createSttEngine } from "./stt-engine";
import { isIntegrationDisabled } from "./integration-switches";

interface DictationSettings { engine: "web-speech" | "stt"; sttBaseUrl?: string; sttModel?: string; sttApiKey?: string }

/** AI-01 — speech-to-text is the chosen engine and this deployment has not switched it off (§762), but
 *  AI is off or the AI data disclosure is not accepted (D9: the audio leaves the device). Dictation is then
 *  UNAVAILABLE: never a silent switch to the browser's own speech recognition, which in some browsers sends the
 *  audio to the browser maker's service. */
export function dictationBlockedByConsent(d: DictationSettings | undefined, aiConsented: boolean): boolean {
  return !aiConsented && d?.engine === "stt" && !isIntegrationDisabled("stt");
}

/** Pick the engine from settings. `null` when `dictationBlockedByConsent`. STT when fully configured, this
 *  deployment has not switched it off (§762) and the AI data disclosure is accepted; else web-speech. The stored
 *  choice is kept either way. */
export function resolveDictationEngine(d: DictationSettings | undefined, lang: Lang, aiConsented: boolean): DictationEngine | null {
  if (dictationBlockedByConsent(d, aiConsented)) return null;
  if (aiConsented && !isIntegrationDisabled("stt") && d?.engine === "stt" && d.sttBaseUrl?.trim() && d.sttApiKey?.trim()) {
    return createSttEngine({ lang, baseUrl: d.sttBaseUrl.trim(), model: d.sttModel?.trim() || "whisper-1", apiKey: d.sttApiKey.trim() });
  }
  return createWebSpeechEngine(lang);
}
