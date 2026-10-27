// src/app/ai-consent.ts
// A versioned record of the AI disclosure the user accepted on THIS device.
// Device settings only: never in the workspace, exports, Turso or recovery.
import type { AiConfig } from "./settings-types";

/** Bump when the disclosure text changes materially: every stored consent then reads as stale.
 *  ★★ Also bump whenever `AI_DATA_PATHS` (ai-disclosure.ts) changes WHAT IS SENT — a row added,
 *  removed or re-levelled, or a data text naming more or fewer fields — and add that version's pin in
 *  ai-disclosure.test.ts, which hashes every English label and data text and fails until the pin
 *  matches. A wording-only text change re-pins the current version instead. Stays 1 until a
 *  disclosure has shipped. */
export const AI_DISCLOSURE_VERSION = 1;

export type AiConsent = { acceptedAt: string; disclosureVersion: number };

const MAX_ACCEPTED_AT_LENGTH = 40;

export function newConsent(now: Date): AiConsent {
  return { acceptedAt: now.toISOString(), disclosureVersion: AI_DISCLOSURE_VERSION };
}

/** True iff a consent exists and was given for the disclosure text that is current now. */
export function isConsentCurrent(c: AiConsent | undefined): boolean {
  return c !== undefined && c.disclosureVersion === AI_DISCLOSURE_VERSION;
}

/** Load-time validation: anything that is not a well-formed record is no consent at all. */
export function sanitizeConsent(v: unknown): AiConsent | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const { acceptedAt, disclosureVersion } = v as Record<string, unknown>;
  if (typeof acceptedAt !== "string" || acceptedAt.length > MAX_ACCEPTED_AT_LENGTH) return undefined;
  if (Number.isNaN(Date.parse(acceptedAt))) return undefined;
  if (typeof disclosureVersion !== "number" || !Number.isInteger(disclosureVersion) || disclosureVersion < 1) {
    return undefined;
  }
  return { acceptedAt, disclosureVersion };
}

export class AiConsentRevokedError extends Error {
  constructor() {
    super("AI consent was revoked");
    this.name = "AiConsentRevokedError";
  }
}

/** Which consent a request needs: `interactive` for a request the user started, `background` for an
 *  unattended run (the scheduled-job analysis, the automatic insight recommendation run, the scheduled
 *  digest narrative), which also needs the separate background consent. */
export type AiConsentLevel = "interactive" | "background";

// Module state (the integration-switches.ts pattern): plain functions on the request path
// ask here without a prop being threaded through. Default: not live.
let interactiveConsentLive = false;
let backgroundConsentLive = false;

/** Records the two send-time flags from the current settings. Interactive: the AI master switch is on
 *  and the interactive consent is current (the key is not part of it). Background: interactive, and the
 *  background consent is current too. */
export function publishAiConsentState(ai: AiConfig | undefined): void {
  interactiveConsentLive = ai?.enabled === true && isConsentCurrent(ai.consent);
  backgroundConsentLive = interactiveConsentLive && isConsentCurrent(ai?.backgroundConsent);
}

/** The published interactive flag: what speech-to-text asks before it uploads a finished recording. */
export function isInteractiveConsentLive(): boolean {
  return interactiveConsentLive;
}

/** Throws unless the published settings have AI switched on with a current interactive consent. Call before every send. */
export function assertInteractiveConsentLive(): void {
  if (!interactiveConsentLive) throw new AiConsentRevokedError();
}

/** Throws unless the published settings also carry a current background consent. Call before every unattended send. */
export function assertBackgroundConsentLive(): void {
  if (!backgroundConsentLive) throw new AiConsentRevokedError();
}

/** The assertion for `level`. */
export function assertAiConsentLive(level: AiConsentLevel): void {
  if (level === "background") assertBackgroundConsentLive();
  else assertInteractiveConsentLive();
}
