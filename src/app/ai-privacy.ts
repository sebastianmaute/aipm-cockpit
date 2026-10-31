// src/app/ai-privacy.ts — what the AI transport does with people in a request.
//
// A request is either unprotected (sent as it is) or protected: the transport redacts every
// outgoing body through `session` and restores the real names in the reply. `privacy` is REQUIRED
// on every send path, so tsc forces each caller to decide. A request that mixes projects is
// protected if ANY of them is, and its session holds every one of their dictionaries.

import { buildPeopleDictionary, type PeopleDictionary } from "./ai-people-dictionary";
import { isPeopleProtected, isPeopleProtectionForced } from "./ai-people-protection";
import { redactionSessionFor, type RedactionSession } from "./ai-people-redact";
import type { Workspace } from "./workspace";

export type AiPrivacy = { protected: false } | { protected: true; session: RedactionSession };

/** Protected if any project is; the session covers the people of ALL the given projects. */
export function aiPrivacyFor(projects: readonly { key: string; ws: Workspace }[]): AiPrivacy {
  if (!projects.some((p) => isPeopleProtected(p.ws.settingsOverrides))) return { protected: false };
  const keys = projects.map((p) => p.key);
  const dicts = projects.map((p) => buildPeopleDictionary(p.ws));
  return { protected: true, session: redactionSessionFor(keys, dicts) };
}

/** The session key of a project that does not exist yet; no stored project can carry it (ids are never
 *  bracketed). */
const NEW_PROJECT_KEY = "(new project)";
const NO_PEOPLE: PeopleDictionary = { names: [], emails: [], phones: [] };

/** The create-project wizard (review 2, B): no workspace yet, so no people are known. Unprotected unless the
 *  deployment FORCES protection; then it is protected with an EMPTY dictionary, so email addresses, phone
 *  numbers and IBANs are still redacted by their patterns, and an image or non-text document is refused. */
export function aiPrivacyForNewProject(): AiPrivacy {
  if (!isPeopleProtectionForced()) return { protected: false };
  return { protected: true, session: redactionSessionFor([NEW_PROJECT_KEY], [NO_PEOPLE]) };
}

/** Thrown before any request when a protected body holds content that cannot be redacted. */
export class AiPeopleProtectedContentError extends Error {
  constructor() {
    super("ai-people-protected-content");
    this.name = "AiPeopleProtectedContentError";
  }
}

/** True when the body holds an image block, or a document block that is not plain text. */
export function hasUnredactableContent(body: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  return holdsUnredactableContent(parsed);
}

/** The same test over a value (a content block, a message, a history): the chat asks it when a file is
 *  attached and before a turn is committed, so it never commits a turn the transport would refuse. */
export function holdsUnredactableContent(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(holdsUnredactableContent);
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.type === "image") return true;
  if (o.type === "document") {
    const src = o.source as Record<string, unknown> | undefined;
    if (src?.type !== "text") return true;
  }
  return Object.values(o).some(holdsUnredactableContent);
}
