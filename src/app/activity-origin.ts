// src/app/activity-origin.ts — which AI feature wrote an activity entry (§799). Pure and i18n-free.
//
// `origin` rides on an entry beside `actor: "ai"`. It carries NO user-authored text (no prompt, thread
// name or job name): only a feature id and, for chat in Turso mode, an optional thread/request link.
// `threadId` and `requestId` are present together or not at all.

export const AI_FEATURES = [
  "chat",
  "chatProposal",
  "inlineEdit",
  "insightRecommendation",
  "allocationPlan",
  "wbsPlan",
  "taskDedup",
  "raciSuggest",
  "meetingReport",
] as const;

export type AiFeature = (typeof AI_FEATURES)[number];

/** Writers use `AiFeature`; a STORED value may be any string (forward compatibility, as `kind` and `actor`). */
export interface AiOrigin {
  readonly feature: string;
  readonly threadId?: string;
  readonly requestId?: string;
}

const KNOWN: ReadonlySet<string> = new Set(AI_FEATURES);

/** Own-property safe: `"toString"` is not a feature. */
export function isKnownAiFeature(f: string): f is AiFeature {
  return KNOWN.has(f);
}

/** A frozen origin; absent link keys are omitted, never `undefined`. */
export function aiOrigin(feature: AiFeature, link?: { threadId: string; requestId: string }): AiOrigin {
  return Object.freeze(link ? { feature, threadId: link.threadId, requestId: link.requestId } : { feature });
}

const isNonEmptyString = (x: unknown): x is string => typeof x === "string" && x.length > 0;

/** Load-boundary repair. `null` = drop the origin (the entry survives). A well-formed input is returned
 *  BY REFERENCE; a half link is stripped to the bare feature. */
export function sanitizeAiOrigin(v: unknown): AiOrigin | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as { feature?: unknown; threadId?: unknown; requestId?: unknown };
  if (!isNonEmptyString(o.feature)) return null;
  const hasThread = o.threadId !== undefined;
  const hasRequest = o.requestId !== undefined;
  if (!hasThread && !hasRequest) return v as AiOrigin;
  if (isNonEmptyString(o.threadId) && isNonEmptyString(o.requestId)) return v as AiOrigin;
  return { feature: o.feature };
}
