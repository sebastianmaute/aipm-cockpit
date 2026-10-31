// src/app/ai-privacy.ts — what the AI transport does with people in a request.
//
// A request is either unprotected (sent as it is) or protected: the transport redacts every
// outgoing body through `session` and restores the real names in the reply. A protected request
// refuses an image or non-text document (`refuseUnredactable`), except the unforced create-project
// wizard's, which only pattern-redacts and keeps reading PDFs (review 3, R3). `privacy` is REQUIRED
// on every send path, so tsc forces each caller to decide. A request that mixes projects is
// protected if ANY of them is, and its session holds every one of their dictionaries.

import { buildPeopleDictionary, type PeopleDictionary } from "./ai-people-dictionary";
import { isPeopleProtected, isPeopleProtectionForced } from "./ai-people-protection";
import { redactionSessionFor, type RedactionSession } from "./ai-people-redact";
import type { Workspace } from "./workspace";

export type AiPrivacy =
  | { protected: false }
  | {
      protected: true;
      session: RedactionSession;
      /** True: an image or non-text document is refused before sending (`AiPeopleProtectedContentError`). False
       *  only for the create-project wizard while the deployment does not force protection. Required, so tsc makes
       *  every builder state it. */
      refuseUnredactable: boolean;
    };

/** Protected if any project is; the session covers the people of ALL the given projects. */
export function aiPrivacyFor(projects: readonly { key: string; ws: Workspace }[]): AiPrivacy {
  if (!projects.some((p) => isPeopleProtected(p.ws.settingsOverrides))) return { protected: false };
  const keys = projects.map((p) => p.key);
  const dicts = projects.map((p) => buildPeopleDictionary(p.ws));
  return { protected: true, session: redactionSessionFor(keys, dicts), refuseUnredactable: true };
}

/** The session key of a project that does not exist yet; no stored project can carry it (ids are never
 *  bracketed). */
const NEW_PROJECT_KEY = "(new project)";
const NO_PEOPLE: PeopleDictionary = { names: [], emails: [], phones: [] };

/** The create-project wizard: no workspace yet, so no people are known. ALWAYS protected with an EMPTY dictionary
 *  (review 3, R3), so email addresses, phone numbers and IBANs are redacted by their patterns and restored in the
 *  reply; names cannot be. An image or non-text document is refused only when the deployment FORCES protection
 *  (review 2, B); otherwise it is sent, so the wizard keeps reading PDFs. */
export function aiPrivacyForNewProject(): AiPrivacy {
  return {
    protected: true,
    session: redactionSessionFor([NEW_PROJECT_KEY], [NO_PEOPLE]),
    refuseUnredactable: isPeopleProtectionForced(),
  };
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
 *  attached and before a turn is committed, so it never commits a turn the transport would refuse.
 *  Only CONTENT is walked: a body's `messages`, and the `content` of a message or a tool_result (nested
 *  arrays included). Never a `tool_use.input`: an image-shaped object the model wrote there is data, not an
 *  image the request carries, and would lock every later protected send in the thread (review 4, M2). */
export function holdsUnredactableContent(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(holdsUnredactableContent);
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.type === "image") return true;
  if (o.type === "document") {
    const src = o.source as Record<string, unknown> | undefined;
    if (src?.type !== "text") return true;
  }
  return holdsUnredactableContent(o.messages) || holdsUnredactableContent(o.content);
}
