export type ReminderKind = "due" | "birthday" | "jiraToken";

export const SNOOZE_1H = 60 * 60 * 1000;
export const SNOOZE_1D = 24 * 60 * 60 * 1000;

const KEY = (k: ReminderKind) => `lop-app:reminder-snooze:${k}`;

/**
 * Epoch ms the reminder is snoozed until, or null when not snoozed/invalid.
 * An already-elapsed snooze counts as "not snoozed": the stale key is cleared
 * and null is returned, so callers (and `useReminderSnooze`) can treat a
 * non-null result as an active, future snooze.
 */
export function getSnoozedUntil(kind: ReminderKind): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY(kind));
    if (raw == null) return null;
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) return null;
    if (v <= Date.now()) {
      window.localStorage.removeItem(KEY(kind));
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

export function setSnoozedUntil(kind: ReminderKind, untilMs: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY(kind), String(untilMs));
  } catch {
    /* quota / disabled — non-fatal */
  }
}

export function clearSnooze(kind: ReminderKind): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY(kind));
  } catch {
    /* non-fatal */
  }
}
