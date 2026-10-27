import type { Lang } from "./i18n";
import {
  DICTATION_AI_DEPLOYMENT_INVALID,
  DICTATION_AI_DEPLOYMENT_OFF,
  DICTATION_NEEDS_AI_CONSENT,
  DICTATION_STT_NOT_SET_UP,
  type DictationEngine,
} from "./dictation-engine";
import { createWebSpeechEngine } from "./web-speech-engine";
import { createSttEngine } from "./stt-engine";
import { isIntegrationDisabled } from "./integration-switches";
import { getAiDeploymentState } from "./ai-deployment";

interface DictationSettings { engine: "web-speech" | "stt"; sttBaseUrl?: string; sttModel?: string; sttApiKey?: string }

/** Why dictation is unavailable, or `null` when it is available. Only speech-to-text can be unavailable, and
 *  only while it is the chosen engine and this deployment has not switched it off (§762; then the browser's
 *  engine is used, the one Settings → Dictation then shows):
 *  - `DICTATION_AI_DEPLOYMENT_OFF` / `DICTATION_AI_DEPLOYMENT_INVALID` — the organisation switched AI off for this
 *    deployment, or its AI gateway setting is invalid. Checked first: no consent the user gives changes it;
 *  - AI-01 `DICTATION_NEEDS_AI_CONSENT` — AI is off or the AI data disclosure is not accepted (D9: the audio
 *    leaves the device);
 *  - AI-01 `DICTATION_STT_NOT_SET_UP` — the service address or key is missing. A key that is not in memory
 *    (sealed but unreadable on this device, or still locked behind a passphrase) counts as missing.
 *  Either way dictation is UNAVAILABLE: never a silent switch to the browser's own speech recognition, which in
 *  some browsers sends the audio to the browser maker's service. */
export function dictationUnavailableReason(d: DictationSettings | undefined, aiConsented: boolean): string | null {
  if (d?.engine !== "stt" || isIntegrationDisabled("stt")) return null;
  const deployment = getAiDeploymentState();
  if (deployment.invalid) return DICTATION_AI_DEPLOYMENT_INVALID;
  if (deployment.off) return DICTATION_AI_DEPLOYMENT_OFF;
  if (!aiConsented) return DICTATION_NEEDS_AI_CONSENT;
  if (!d.sttBaseUrl?.trim() || !d.sttApiKey?.trim()) return DICTATION_STT_NOT_SET_UP;
  return null;
}

/** Pick the engine from settings. `null` when `dictationUnavailableReason` gives a reason. Speech-to-text when
 *  it is the chosen engine and this deployment has not switched it off (§762); else web-speech. The stored
 *  choice is kept either way. */
export function resolveDictationEngine(d: DictationSettings | undefined, lang: Lang, aiConsented: boolean): DictationEngine | null {
  if (dictationUnavailableReason(d, aiConsented) !== null) return null;
  if (d?.engine === "stt" && !isIntegrationDisabled("stt") && d.sttBaseUrl?.trim() && d.sttApiKey?.trim()) {
    return createSttEngine({ lang, baseUrl: d.sttBaseUrl.trim(), model: d.sttModel?.trim() || "whisper-1", apiKey: d.sttApiKey.trim() });
  }
  return createWebSpeechEngine(lang);
}
