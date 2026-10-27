// src/app/ai-permission-store.ts — AI-01: how the AI master switch and the two consent records are persisted.
// Extracted from use-settings.ts (M2) without a change in behaviour.
//
// ★ TWO LAYERS. The PURE CORE (every function taking its state as an argument) decides, from the stored AI state,
//   this page's unsaved narrowing and an action, what a write stores, what the page's state becomes after it
//   succeeds or fails, and what is published for the send-time checks. The PAGE STATE below it is one module
//   variable (`pageStore`) holding the two page-level records, so it holds for every `useSettings` instance on
//   the page and a reload forgets it. Nothing here touches `localStorage`: `use-settings.ts` reads the stored
//   AI state and passes it in, and its `writeSettings` stays the only writer of the settings key.
import type { AiConsent } from "./ai-consent";
import { isPlainObject } from "./sanitize";
import { sanitizeAiConfig, type AiConfig, type Settings } from "./settings-types";

/** The AI fields a revocation or a switch-off changes: the master switch and the two consent records. */
export type PersistedAiState = { enabled: boolean; consent: AiConsent | undefined; backgroundConsent: AiConsent | undefined };

/** One of the three AI permission fields `writeSettings` guards: the master switch and the two consent records. */
export type AiPermissionField = "enabled" | "consent" | "backgroundConsent";

/** The three AI permission fields as an `AiConfig` holds them (the switch may be unset). */
export type AiPermission = Pick<AiConfig, AiPermissionField>;

/** What this page withdrew from the stored AI permission and could not save (`writeSettings` failed): the switch
 *  turned off, and the stored consent records it withdrew. A record counts only while storage still holds that
 *  same record: a different one is a newer accept made elsewhere, which this page takes. */
export type UnsavedNarrowing = { switchedOff: boolean; consent: AiConsent | undefined; backgroundConsent: AiConsent | undefined };

/** The page-level records of the store.
 *  `unsavedNarrowing` — set when a write fails, from the narrowing that write carried; cleared when a write
 *  succeeds, since every write persists it (a write narrows against the page's state).
 *  `reportedRevokeAi` — the AI slice of a revoke that could not be saved and is committed anyway, which
 *  Settings → AI has already reported (`noteConsentRevokeNotSaved`). The persist effect does not raise the generic
 *  "settings could not be saved" notice for a commit carrying THIS slice, in any instance: the revoke's own
 *  commit. A commit with any other AI slice raises it as usual, and any successful write clears the note. (A
 *  later edit that keeps the slice cannot reach that notice before a successful write: the revoke's commit already
 *  put every instance on the failing edge, and a new instance loads a slice of its own.) A failed ACCEPT notes
 *  nothing: it is not committed, so no generic notice follows it to suppress. It only steers that notice. Saving
 *  the revoke later needs nothing from it: the next ordinary write that succeeds persists the withdrawal, because
 *  a withdrawal narrows. */
export type AiPermissionStore = { unsavedNarrowing: UnsavedNarrowing | null; reportedRevokeAi: AiConfig | null };

export const EMPTY_AI_PERMISSION_STORE: AiPermissionStore = { unsavedNarrowing: null, reportedRevokeAi: null };

// ── Pure core ────────────────────────────────────────────────────────────────────────────────────────────────

/** The AI switch and consent records of a stored settings blob (`raw`, the settings key's value), through the load
 *  sanitizer. No settings or an unreadable blob read as switched off with no consent. */
export function parseStoredAiState(raw: string | null): PersistedAiState {
  let ai: AiConfig;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    ai = sanitizeAiConfig(isPlainObject(parsed) && isPlainObject(parsed.ai) ? parsed.ai : {});
  } catch {
    ai = sanitizeAiConfig({});
  }
  return { enabled: ai.enabled === true, consent: ai.consent, backgroundConsent: ai.backgroundConsent };
}

function sameConsent(a: AiConsent | undefined, b: AiConsent | undefined): boolean {
  return a?.acceptedAt === b?.acceptedAt && a?.disclosureVersion === b?.disclosureVersion && (a?.route ?? "direct") === (b?.route ?? "direct");
}

/** Whether `ai` holds the switch and the two records of `p`. */
export function sameAiState(ai: AiPermission, p: PersistedAiState): boolean {
  return (ai.enabled === true) === p.enabled && sameConsent(ai.consent, p.consent) && sameConsent(ai.backgroundConsent, p.backgroundConsent);
}

const STORAGE_AI_FIELDS: ReadonlySet<string> = new Set(["enabled", "consent", "backgroundConsent"]);

function sameKeysExcept(a: Record<string, unknown>, b: Record<string, unknown>, skip: (key: string) => boolean): boolean {
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!skip(key) && a[key] !== b[key]) return false;
  }
  return true;
}

/** True when `next` differs from `base` in nothing but the three AI fields and those equal `fromStorage`: the
 *  change was read from another tab's write, so it is neither written back nor broadcast. Any other change in the
 *  same commit (a local edit batched with it) makes this false, so that edit is still saved and sent. */
export function isOnlyStorageAiChange(base: Settings | null, next: Settings, fromStorage: PersistedAiState | null): boolean {
  if (base === null || fromStorage === null || !sameAiState(next.ai, fromStorage)) return false;
  const rec = (s: unknown) => s as Record<string, unknown>;
  return sameKeysExcept(rec(base), rec(next), (key) => key === "ai")
    && sameKeysExcept(rec(base.ai), rec(next.ai), (key) => STORAGE_AI_FIELDS.has(key));
}

/** `settings` with the switch and the two records of `fresh`; `settings` itself when it already holds them. */
export function withAiState(settings: Settings, fresh: PersistedAiState): Settings {
  return sameAiState(settings.ai, fresh) ? settings : { ...settings, ai: { ...settings.ai, ...fresh } };
}

/** `ai` with `n` applied: the switch off when it was switched off, and a consent record removed when it is the one
 *  this page withdrew. */
export function withUnsavedNarrowing<T extends Partial<AiPermission>>(ai: T, n: UnsavedNarrowing | null): T {
  if (n === null) return ai;
  const withdrawn = (held: AiConsent | undefined, gone: AiConsent | undefined) => gone !== undefined && sameConsent(held, gone);
  return {
    ...ai,
    enabled: n.switchedOff ? false : ai.enabled,
    consent: withdrawn(ai.consent, n.consent) ? undefined : ai.consent,
    backgroundConsent: withdrawn(ai.backgroundConsent, n.backgroundConsent) ? undefined : ai.backgroundConsent,
  };
}

/** The AI switch and consent records in effect on a page: `stored`, narrowed by what the page withdrew and could
 *  not save. What a load, a re-read and every write's narrow-only base read. */
export function pageAiStateOf(store: AiPermissionStore, stored: PersistedAiState): PersistedAiState {
  return withUnsavedNarrowing(stored, store.unsavedNarrowing);
}

/** The AI switch and consent records of `ai`, taken only where they NARROW `base` (the switch off, a consent
 *  record absent); everywhere else `base`'s.
 *  ★ This is what an ORDINARY write persists, with `base` the page's state: an instance holding an older copy
 *  (another tab, a popout, a page restored from the back/forward cache, an instance whose load finished after a
 *  change elsewhere) can never write a withdrawn consent or a switch-off back to "on", and a withdrawal that could
 *  not be saved at the time is saved by the next ordinary write that succeeds. The cost is the opposite
 *  direction, deliberately: an instance that missed a WIDENING (an accept or a switch-on elsewhere) narrows it
 *  again on its next write. That fails closed, and the `storage`, `pageshow` and `visibilitychange` re-reads in
 *  `useSettings` keep the window small. */
export function narrowOnly(ai: AiPermission, base: PersistedAiState): AiPermission {
  return {
    // `ai.enabled` itself when it is not "on" (false, or unset), so an unset switch stays unset.
    enabled: ai.enabled === true ? base.enabled : ai.enabled,
    consent: ai.consent === undefined ? undefined : base.consent,
    backgroundConsent: ai.backgroundConsent === undefined ? undefined : base.backgroundConsent,
  };
}

/** The AI permission a write persists: `narrowOnly` against the page's state `page`, except that each field in
 *  `widen` is taken from `ai` as it is. Only `persistAiConsentChange` passes a field to widen. */
export function aiPermissionToWrite(ai: AiPermission, widen: readonly AiPermissionField[], page: PersistedAiState): AiPermission {
  const permission = narrowOnly(ai, page);
  for (const field of widen) {
    if (field === "enabled") permission.enabled = ai.enabled;
    else permission[field] = ai[field];
  }
  return permission;
}

/** A write carrying `attempted` failed: where it narrows `stored`, or null when it narrows nothing. `attempted` is
 *  already narrowed against the page's state, so a narrowing noted earlier is carried on. */
export function narrowingAfterFailedWrite(stored: PersistedAiState, attempted: Partial<AiPermission>): UnsavedNarrowing | null {
  const switchedOff = stored.enabled && attempted.enabled !== true;
  const consent = attempted.consent === undefined ? stored.consent : undefined;
  const backgroundConsent = attempted.backgroundConsent === undefined ? stored.backgroundConsent : undefined;
  return switchedOff || consent || backgroundConsent ? { switchedOff, consent, backgroundConsent } : null;
}

/** One write of the settings key, planned: what it stores, and the store after it succeeds or fails. */
export type AiPermissionWritePlan = { permission: AiPermission; afterSuccess: AiPermissionStore; afterFailure: AiPermissionStore };

/** Plans a write of settings whose AI slice is `ai` (undefined: a partial settings object that says nothing about AI
 *  permission, so the page's state is kept), widening the fields in `widen`, with `stored` the AI state persisted
 *  now. A success persists the page's unsaved narrowing (the write narrowed against it) and clears both records;
 *  a failure keeps the reported revoke and notes the narrowing the write carried — a failed widening is not
 *  committed by its caller, so only that narrowing counts. */
export function planAiPermissionWrite(
  store: AiPermissionStore,
  stored: PersistedAiState,
  ai: AiConfig | undefined,
  widen: readonly AiPermissionField[],
): AiPermissionWritePlan {
  const page = pageAiStateOf(store, stored);
  const permission = ai ? aiPermissionToWrite(ai, widen, page) : page;
  const attempted = ai ? narrowOnly(ai, page) : page;
  return {
    permission,
    afterSuccess: EMPTY_AI_PERMISSION_STORE,
    afterFailure: { ...store, unsavedNarrowing: narrowingAfterFailedWrite(stored, attempted) },
  };
}

/** The AI fields published for the send-time checks: `ai` with the page's unsaved narrowing applied, so a copy that
 *  still holds a withdrawn consent (a stale object committed after the revoke) cannot re-arm the flags while the
 *  withdrawal is not saved. */
export function aiToPublishOf(store: AiPermissionStore, ai: AiConfig): AiConfig {
  return withUnsavedNarrowing(ai, store.unsavedNarrowing);
}

// ── Page state ───────────────────────────────────────────────────────────────────────────────────────────────

let pageStore: AiPermissionStore = EMPTY_AI_PERMISSION_STORE;

/** The AI state in effect on this page, given the stored one (`pageAiStateOf` over this page's store). */
export function pageAiState(stored: PersistedAiState): PersistedAiState {
  return pageAiStateOf(pageStore, stored);
}

/** Plans a write against this page's store (`planAiPermissionWrite`); hand the outcome to `settleAiPermissionWrite`. */
export function planPageAiPermissionWrite(
  stored: PersistedAiState,
  ai: AiConfig | undefined,
  widen: readonly AiPermissionField[],
): AiPermissionWritePlan {
  return planAiPermissionWrite(pageStore, stored, ai, widen);
}

/** Records the outcome of a planned write in this page's store. */
export function settleAiPermissionWrite(plan: AiPermissionWritePlan, ok: boolean): void {
  pageStore = ok ? plan.afterSuccess : plan.afterFailure;
}

/** `ai` as this page publishes it for the send-time checks (`aiToPublishOf`). */
export function aiForPublish(ai: AiConfig): AiConfig {
  return aiToPublishOf(pageStore, ai);
}

/** Settings → AI reported that this revoke could not be saved; call it just before committing it. */
export function noteConsentRevokeNotSaved(revoked: Settings): void {
  pageStore = { ...pageStore, reportedRevokeAi: revoked.ai };
}

/** Whether `ai` is the AI slice of a revoke Settings → AI already reported as not saved. */
export function isReportedRevoke(ai: AiConfig): boolean {
  return ai === pageStore.reportedRevokeAi;
}

/** Test seam: forget a noted revoke and an unsaved narrowing. */
export function __resetConsentFailureForTests(): void {
  pageStore = EMPTY_AI_PERMISSION_STORE;
}
