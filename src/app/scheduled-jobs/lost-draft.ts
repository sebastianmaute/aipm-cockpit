// src/app/scheduled-jobs/lost-draft.ts — instruction text whose closing save failed or was refused after the editor
// had closed (nothing could tell the user then). Kept per tab in sessionStorage, keyed by `jobSaveId`, and shown again
// the next time the job's row mounts. Every access is guarded: a storage that cannot be used behaves as if nothing was
// kept (the text is lost, as it was before this store existed).

/** The sessionStorage key of the lost-draft map. */
export const LOST_DRAFT_KEY = "aipm-cockpit:scheduled-job-lost-draft";

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

function readAll(): Record<string, LostDraft> {
  try {
    const raw = sessionStorage.getItem(LOST_DRAFT_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, LostDraft> = {};
    for (const [k, v] of Object.entries(parsed)) if (isLostDraft(v)) out[k] = { text: v.text, reason: v.reason };
    return out;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, LostDraft>): void {
  try {
    if (Object.keys(all).length === 0) sessionStorage.removeItem(LOST_DRAFT_KEY);
    else sessionStorage.setItem(LOST_DRAFT_KEY, JSON.stringify(all));
  } catch {
    return;
  }
}

/** Keeps the text a closed editor could not save for `saveId` (the newest one wins). */
export function keepLostDraft(saveId: string, draft: LostDraft): void {
  writeAll({ ...readAll(), [saveId]: draft });
}

/** The text kept for `saveId`, if any (read-only). */
export function peekLostDraft(saveId: string): LostDraft | null {
  return readAll()[saveId] ?? null;
}

/** Forgets the text kept for `saveId` (restored into the field, or its job deleted). */
export function forgetLostDraft(saveId: string): void {
  const all = readAll();
  if (!Object.prototype.hasOwnProperty.call(all, saveId)) return;
  const { [saveId]: _gone, ...rest } = all;
  void _gone;
  writeAll(rest);
}
