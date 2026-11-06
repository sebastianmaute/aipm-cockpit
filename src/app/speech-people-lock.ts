// src/app/speech-people-lock.ts — §789: the people-lock check built-in speech runs before it listens.
//
// The browser's own speech recognition (dictation's web-speech engine and voice commands) makes no request to
// this app, so a people-protection lock an organisation adds while a tab is open never reached it: the AI
// transport learns of the lock only on its next AI send. Both paths now ask `GET /api/ai/status` at each start.
//
// Only the `peopleForced` answer is read. Built-in speech is not an AI send, so AI switched off or misconfigured
// does not stop it; that is `confirmAiDeployment`'s job (`ai-transport.ts`) for the cloud STT engine.
// FAIL CLOSED (owner decision 2026-11-06): an answer that cannot be trusted, or no answer, is "unconfirmed" and
// the caller does not start. A lock is folded into the page as the AI transport does (`addDisabledIntegration`);
// locks only ever add, so a lock the page already knows answers without a request.
// A request that takes longer than SPEECH_PEOPLE_LOCK_TIMEOUT_MS is aborted and also answers "unconfirmed", so a
// stalled server tells the user instead of leaving the control showing "listening" with nothing recording.

import { requestAiStatus } from "./ai-status-request";
import { addDisabledIntegration, isIntegrationDisabled } from "./integration-switches";

export type SpeechPeopleLock = "clear" | "locked" | "unconfirmed";

/** How long a start waits for the status route before it gives up and starts nothing. */
export const SPEECH_PEOPLE_LOCK_TIMEOUT_MS = 5000;

export async function checkSpeechPeopleLock(): Promise<SpeechPeopleLock> {
  if (isIntegrationDisabled("ai-people")) return "locked";
  let body: unknown;
  // A plain timer, not AbortSignal.timeout: the abort also covers reading the body, and tests drive it with fake timers.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SPEECH_PEOPLE_LOCK_TIMEOUT_MS);
  try {
    const res = await requestAiStatus(controller.signal);
    if (res.status !== 200) return "unconfirmed";
    body = await res.json();
  } catch {
    return "unconfirmed";
  } finally {
    clearTimeout(timer);
  }
  const peopleForced = typeof body === "object" && body !== null ? (body as Record<string, unknown>).peopleForced : undefined;
  if (typeof peopleForced !== "boolean") return "unconfirmed";
  if (!peopleForced) return "clear";
  addDisabledIntegration("ai-people");
  return "locked";
}
