// src/app/scheduled-jobs/lost-draft.ts — instruction text this tab could not save: a save refused because the job
// changed elsewhere, or a closing save that failed after the editor had closed. Kept per tab in sessionStorage, keyed
// by `jobSaveId`, up to `MAX_LOST_DRAFTS` texts per job (newest first), and offered read-only for copying the next time
// the job's row mounts. Never put back into a job. Every access is guarded: a storage that cannot be used behaves as if
// nothing was kept.

/** The sessionStorage key of the lost-draft map. */
export const LOST_DRAFT_KEY = "aipm-cockpit:scheduled-job-lost-draft";

/** How many lost texts are kept per job; a newer one pushes the oldest out. */
export const MAX_LOST_DRAFTS = 3;

/** Why the text was lost: its save was refused (the job changed elsewhere) or failed. */
export type LostDraftReason = "dropped" | "notSaved";

export interface LostDraft {
  text: string;
  reason: LostDraftReason;
}

function isLostDraft(value: unknown): value is LostDraft {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.text === "string" && (v.reason === "dropped" || v.reason === "notSaved");
}

function readAll(): Record<string, LostDraft[]> {
  try {
    const raw = sessionStorage.getItem(LOST_DRAFT_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, LostDraft[]> = {};
    for (const [k, v] of Object.entries(parsed)) {
      // An entry of another shape (an older single-text entry) is ignored.
      if (!Array.isArray(v)) continue;
      const list = v.filter(isLostDraft).map((d) => ({ text: d.text, reason: d.reason }));
      if (list.length > 0) out[k] = list.slice(0, MAX_LOST_DRAFTS);
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, LostDraft[]>): void {
  try {
    if (Object.keys(all).length === 0) sessionStorage.removeItem(LOST_DRAFT_KEY);
    else sessionStorage.setItem(LOST_DRAFT_KEY, JSON.stringify(all));
  } catch {
    return;
  }
}

/** `draft` in front of `list`: a text already there moves to the front with its new reason; at most `MAX_LOST_DRAFTS`. */
export function withLostDraft<T extends { text: string }>(list: readonly T[], draft: T): T[] {
  return [draft, ...list.filter((d) => d.text !== draft.text)].slice(0, MAX_LOST_DRAFTS);
}

/** Replaces the texts kept for `saveId` (an empty list forgets them). */
export function setLostDrafts(saveId: string, list: readonly LostDraft[]): void {
  const { [saveId]: _old, ...rest } = readAll();
  void _old;
  writeAll(list.length === 0 ? rest : { ...rest, [saveId]: list.slice(0, MAX_LOST_DRAFTS) });
}

/** Keeps a text this tab could not save for `saveId`, in front of any kept before. */
export function keepLostDraft(saveId: string, draft: LostDraft): void {
  setLostDrafts(saveId, withLostDraft(readAll()[saveId] ?? [], draft));
}

/** The texts kept for `saveId`, newest first (read-only). */
export function peekLostDrafts(saveId: string): LostDraft[] {
  return readAll()[saveId] ?? [];
}

/** Forgets the texts kept for `saveId` (dismissed, superseded by a saved edit, or its job deleted). */
export function forgetLostDraft(saveId: string): void {
  if (!Object.prototype.hasOwnProperty.call(readAll(), saveId)) return;
  setLostDrafts(saveId, []);
}
