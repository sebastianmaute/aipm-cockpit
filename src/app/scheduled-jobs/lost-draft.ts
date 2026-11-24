// src/app/scheduled-jobs/lost-draft.ts — instruction text this tab could not save: a save refused because the job
// changed elsewhere, or a closing save that failed after the editor had closed. Kept per tab in sessionStorage, keyed
// by `jobSaveId`, up to `MAX_LOST_DRAFTS` texts per job (newest first), and offered read-only for copying while the
// job's row is mounted. Never put back into a job. Texts are added and removed ONE AT A TIME (never a whole list
// written over another), and every change is told to `subscribeLostTexts` listeners, so an open row picks up a text a
// closed editor lost after it mounted. Every storage access is guarded: a storage that cannot be used keeps nothing,
// but listeners are still told.

/** The sessionStorage key of the lost-draft map. */
export const LOST_DRAFT_KEY = "aipm-cockpit:scheduled-job-lost-draft";

/** How many lost texts storage keeps per job; a newer one pushes the oldest out of storage (an open row still shows
 *  every text it has offered until a save or Dismiss removes it). */
export const MAX_LOST_DRAFTS = 5;

/** Why the text was lost: its save was refused (the job changed elsewhere) or failed. */
export type LostDraftReason = "dropped" | "notSaved";

export interface LostDraft {
  text: string;
  reason: LostDraftReason;
}

/** A text an open row offers: a kept reason, or "newerVersion" (the job turned into one this version cannot edit),
 *  which is shown while the row is and never kept. */
export interface LostText {
  text: string;
  reason: LostDraftReason | "newerVersion";
}

/** One change to the texts kept for a job: a text added, texts removed (trimmed), or all of them forgotten. */
export type LostTextChange = { added: LostText } | { removed: readonly string[] | "all" };

type Listener = (saveId: string, change: LostTextChange) => void;
const listeners = new Set<Listener>();

/** Calls `listener` with every change made through this module; returns the unsubscribe. */
export function subscribeLostTexts(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function tell(saveId: string, change: LostTextChange): void {
  for (const listener of [...listeners]) listener(saveId, change);
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

function writeOne(saveId: string, list: readonly LostDraft[]): void {
  try {
    const { [saveId]: _old, ...rest } = readAll();
    void _old;
    const all = list.length === 0 ? rest : { ...rest, [saveId]: list.slice(0, MAX_LOST_DRAFTS) };
    if (Object.keys(all).length === 0) sessionStorage.removeItem(LOST_DRAFT_KEY);
    else sessionStorage.setItem(LOST_DRAFT_KEY, JSON.stringify(all));
  } catch {
    return;
  }
}

/** `draft` in front of `list`; a text already there moves to the front with its new reason (never twice). */
export function withLostDraft<T extends { text: string }>(list: readonly T[], draft: T): T[] {
  return [draft, ...list.filter((d) => d.text !== draft.text)];
}

/** Adds one text this tab could not save for `saveId`, in front of any kept before, and tells every open row. It is
 *  kept in storage unless `keep` is false or it is a "newerVersion" text (then it is only told). */
export function addLostText(saveId: string, text: LostText, options: { keep?: boolean } = {}): void {
  const { reason } = text;
  if (options.keep !== false && reason !== "newerVersion") {
    writeOne(saveId, withLostDraft(readAll()[saveId] ?? [], { text: text.text, reason }));
  }
  tell(saveId, { added: { text: text.text, reason } });
}

/** Removes the kept texts equal (trimmed) to any of `texts` — a save of that text, or a job that now holds it. */
export function removeLostTexts(saveId: string, texts: readonly string[]): void {
  const gone = new Set(texts.map((x) => x.trim()));
  const kept = readAll()[saveId] ?? [];
  const left = kept.filter((d) => !gone.has(d.text.trim()));
  if (left.length !== kept.length) writeOne(saveId, left);
  tell(saveId, { removed: [...gone] });
}

/** The texts kept for `saveId`, newest first (read-only). */
export function peekLostDrafts(saveId: string): LostDraft[] {
  return readAll()[saveId] ?? [];
}

/** Forgets every text kept for `saveId`: Dismiss, or its job deleted. */
export function forgetLostDraft(saveId: string): void {
  if (Object.prototype.hasOwnProperty.call(readAll(), saveId)) writeOne(saveId, []);
  tell(saveId, { removed: "all" });
}
