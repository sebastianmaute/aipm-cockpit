// src/app/ai-consent.ts
// A versioned record of the AI disclosure the user accepted on THIS device.
// Device settings only: never in the workspace, exports, Turso or recovery.
import type { AiConfig } from "./settings-types";
import { type AiRoute, currentAiRoute, getAiDeploymentState, isAiDeploymentOn } from "./ai-deployment";

/** Bump when the disclosure text changes materially: every stored consent then reads as stale.
 *  ★★ Also bump whenever `AI_DATA_PATHS` (ai-disclosure.ts) changes WHAT IS SENT — a row added,
 *  removed or re-levelled, or a data text naming more or fewer fields — and add that version's pin in
 *  ai-disclosure.test.ts, which hashes every English label and data text and fails until the pin
 *  matches. A wording-only text change re-pins the current version instead.
 *  2 — AI people protection: the table gained its protected column and a v1 consent is asked again. */
export const AI_DISCLOSURE_VERSION = 2;

/** `route` is where the AI traffic went when the user accepted; absent counts as `direct`. `keyRestricted` is
 *  whether the deployment restricted AI to its organisation's Anthropic keys then; absent counts as false. */
export type AiConsent = { acceptedAt: string; disclosureVersion: number; route?: AiRoute; keyRestricted?: boolean };

const MAX_ACCEPTED_AT_LENGTH = 40;

export function newConsent(now: Date): AiConsent {
  const consent: AiConsent = { acceptedAt: now.toISOString(), disclosureVersion: AI_DISCLOSURE_VERSION, route: currentAiRoute() };
  return getAiDeploymentState().keyRestricted ? { ...consent, keyRestricted: true } : consent;
}

/** True iff a consent exists and was given for the disclosure text that is current now, over the route the
 *  deployment uses now, with the key restriction on or off as it is now (a consent given for another route, or
 *  before the restriction was switched on or off, reads as stale, so the user is asked again). */
export function isConsentCurrent(c: AiConsent | undefined): boolean {
  return c !== undefined
    && c.disclosureVersion === AI_DISCLOSURE_VERSION
    && (c.route ?? "direct") === currentAiRoute()
    && (c.keyRestricted ?? false) === getAiDeploymentState().keyRestricted;
}

/** Load-time validation: anything that is not a well-formed record is no consent at all. */
export function sanitizeConsent(v: unknown): AiConsent | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const { acceptedAt, disclosureVersion, route, keyRestricted } = v as Record<string, unknown>;
  if (typeof acceptedAt !== "string" || acceptedAt.length > MAX_ACCEPTED_AT_LENGTH) return undefined;
  if (Number.isNaN(Date.parse(acceptedAt))) return undefined;
  if (typeof disclosureVersion !== "number" || !Number.isInteger(disclosureVersion) || disclosureVersion < 1) {
    return undefined;
  }
  // A record with no route predates routes and counts as direct. A route that is present but not one this release
  // knows (written by a later release, say, before a rollback) is no consent at all, so the user is asked again:
  // read as direct, consent given for another route would become consent for a direct one. A keyRestricted other
  // than `true` is dropped (absent counts as false).
  const restricted = keyRestricted === true ? { keyRestricted: true } : {};
  if (route === undefined) return { acceptedAt, disclosureVersion, ...restricted };
  if (route === "direct" || route === "gateway" || route === "relay") return { acceptedAt, disclosureVersion, route, ...restricted };
  return undefined;
}

export class AiConsentRevokedError extends Error {
  constructor() {
    super("AI consent was revoked");
    this.name = "AiConsentRevokedError";
  }
}

/** An unattended request stopped because this week's usage reached the user's weekly hard cap. Only the
 *  background level is ever stopped by it. */
export class AiWeeklyCapReachedError extends Error {
  constructor() {
    super("The weekly AI hard cap was reached");
    this.name = "AiWeeklyCapReachedError";
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
// Published by the usage provider (the only reader of the week's total): this week's usage reached the hard cap.
let backgroundCapReached = false;

/** Records whether this week's usage has reached the weekly hard cap. It pauses background AI only. */
export function publishBackgroundCapState(reached: boolean): void {
  backgroundCapReached = reached;
}

export function isBackgroundCapReached(): boolean {
  return backgroundCapReached;
}

/** Whether interactive AI may run under these settings: the AI master switch is on and the interactive consent is
 *  current (the key is not part of it). The published interactive flag and every request made before a send (the
 *  key check and the model list, M4) read this one rule. */
export function isInteractiveAiAllowed(ai: Pick<AiConfig, "enabled" | "consent"> | undefined): boolean {
  return isAiDeploymentOn() && ai?.enabled === true && isConsentCurrent(ai.consent);
}

/** Records the two send-time flags from the current settings. Interactive: the AI master switch is on
 *  and the interactive consent is current (the key is not part of it). Background: interactive, and the
 *  background consent is current too. */
export function publishAiConsentState(ai: AiConfig | undefined): void {
  interactiveConsentLive = isInteractiveAiAllowed(ai);
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

/** Throws unless the published settings also carry a current background consent, and while the weekly hard cap is
 *  reached. A missing consent wins over the cap. Call before every unattended send. */
export function assertBackgroundConsentLive(): void {
  if (!backgroundConsentLive) throw new AiConsentRevokedError();
  if (backgroundCapReached) throw new AiWeeklyCapReachedError();
}

/** The assertion for `level`. */
export function assertAiConsentLive(level: AiConsentLevel): void {
  if (level === "background") assertBackgroundConsentLive();
  else assertInteractiveConsentLive();
}
