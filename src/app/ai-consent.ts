// src/app/ai-consent.ts
// A versioned record of the AI disclosure the user accepted on THIS device.
// Device settings only: never in the workspace, exports, Turso or recovery.
import type { AiConfig } from "./settings-types";

/** Bump when the disclosure text changes materially: every stored consent then reads as stale.
 *  ★★ Also bump whenever `AI_DATA_PATHS` (ai-disclosure.ts) changes — a row added, removed,
 *  re-levelled or re-keyed — and add that version's pin in ai-disclosure.test.ts, which fails
 *  until both are done. Stays 1 until a disclosure has shipped. */
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

// Module state (the integration-switches.ts pattern): plain functions on the request path
// ask here without a prop being threaded through. Default: not live.
let interactiveConsentLive = false;

/** Records whether the current settings carry a current interactive consent. */
export function publishAiConsentState(ai: AiConfig | undefined): void {
  interactiveConsentLive = isConsentCurrent(ai?.consent);
}

/** Throws unless the published settings carry a current interactive consent. Call before every send. */
export function assertInteractiveConsentLive(): void {
  if (!interactiveConsentLive) throw new AiConsentRevokedError();
}
