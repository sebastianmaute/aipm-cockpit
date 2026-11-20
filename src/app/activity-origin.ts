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

/** §799 — the two origins of ONE chat send: `chat` for the writes it runs, `proposal` for a plan it stages
 *  (which keeps it even when applied after a later send). `requestId` is the send's own, minted once on its
 *  user item (`newRequestId`), so a §798 rate-limit retry inside the send keeps it and no two sends share it.
 *  The caller captures the result as a local value and passes it along; it is never read back from a ref.
 *  ★★ The link is gated on `tursoMode`, NOT on `threadId`: `ensureThreadForSend` returns the retained thread
 *   id in file mode too, and file mode has no saved thread to link to. */
export function chatSendOrigins(
  tursoMode: boolean, threadId: string | null, requestId: string,
): { readonly chat: AiOrigin; readonly proposal: AiOrigin } {
  const link = tursoMode && threadId && requestId ? { threadId, requestId } : undefined;
  return { chat: aiOrigin("chat", link), proposal: aiOrigin("chatProposal", link) };
}

const isNonEmptyString = (x: unknown): x is string => typeof x === "string" && x.length > 0;

/** Load-boundary repair. `null` = drop the origin (the entry survives). The result holds ONLY `feature` and,
 *  when both are valid, `threadId` + `requestId`: an unknown extra key is stripped (no user-written string may
 *  ride the origin) and a half link is stripped to the bare feature. An input that already has exactly those
 *  keys is returned BY REFERENCE, so a clean entry keeps its identity. */
export function sanitizeAiOrigin(v: unknown): AiOrigin | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as { feature?: unknown; threadId?: unknown; requestId?: unknown };
  if (!isNonEmptyString(o.feature)) return null;
  const keys = Object.keys(o);
  if (keys.length === 1) return v as AiOrigin;
  const hasLink = isNonEmptyString(o.threadId) && isNonEmptyString(o.requestId);
  if (hasLink && keys.length === 3) return v as AiOrigin;
  return hasLink ? { feature: o.feature, threadId: o.threadId as string, requestId: o.requestId as string } : { feature: o.feature };
}
