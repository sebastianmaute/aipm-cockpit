import type { Lang } from "./i18n";
import type { DictationEngine } from "./dictation-engine";
import { createWebSpeechEngine } from "./web-speech-engine";
import { createSttEngine } from "./stt-engine";
import { isIntegrationDisabled } from "./integration-switches";

interface DictationSettings { engine: "web-speech" | "stt"; sttBaseUrl?: string; sttModel?: string; sttApiKey?: string }

/** Pick the engine from settings. STT only when fully configured and this deployment has not
 *  switched it off (§762); else web-speech. The stored choice is kept either way. */
export function resolveDictationEngine(d: DictationSettings | undefined, lang: Lang): DictationEngine {
  if (!isIntegrationDisabled("stt") && d?.engine === "stt" && d.sttBaseUrl?.trim() && d.sttApiKey?.trim()) {
    return createSttEngine({ lang, baseUrl: d.sttBaseUrl.trim(), model: d.sttModel?.trim() || "whisper-1", apiKey: d.sttApiKey.trim() });
  }
  return createWebSpeechEngine(lang);
}
