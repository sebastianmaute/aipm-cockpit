// src/app/ai-privacy.ts — what the AI transport does with people in a request.
//
// A request is either unprotected (sent as it is) or protected: the transport redacts every
// outgoing body through `session` and restores the real names in the reply. `privacy` is REQUIRED
// on every send path, so tsc forces each caller to decide. A request that mixes projects is
// protected if ANY of them is, and its session holds every one of their dictionaries.

import { buildPeopleDictionary } from "./ai-people-dictionary";
import { isPeopleProtected } from "./ai-people-protection";
import { redactionSessionFor, type RedactionSession } from "./ai-people-redact";
import type { Workspace } from "./workspace";

export type AiPrivacy = { protected: false } | { protected: true; session: RedactionSession };

/** Temporary: every existing feature call site passes this until Task 4 threads the real
 *  privacy through. Task 4 removes every use of it. */
export const PRIVACY_NOT_YET_THREADED: AiPrivacy = { protected: false } as const;

/** Protected if any project is; the session covers the people of ALL the given projects. */
export function aiPrivacyFor(projects: readonly { key: string; ws: Workspace }[]): AiPrivacy {
  if (!projects.some((p) => isPeopleProtected(p.ws.settingsOverrides))) return { protected: false };
  const keys = projects.map((p) => p.key);
  const dicts = projects.map((p) => buildPeopleDictionary(p.ws));
  return { protected: true, session: redactionSessionFor(keys, dicts) };
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
  return scan(parsed);
}

function scan(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(scan);
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.type === "image") return true;
  if (o.type === "document") {
    const src = o.source as Record<string, unknown> | undefined;
    if (src?.type !== "text") return true;
  }
  return Object.values(o).some(scan);
}
