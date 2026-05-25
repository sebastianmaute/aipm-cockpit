export type ReminderKind = "due" | "birthday";

export const SNOOZE_1H = 60 * 60 * 1000;
export const SNOOZE_1D = 24 * 60 * 60 * 1000;

const KEY = (k: ReminderKind) => `lop-app:reminder-snooze:${k}`;

/** Epoch ms the reminder is snoozed until, or null when not snoozed/invalid. */
export function getSnoozedUntil(kind: ReminderKind): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY(kind));
    if (raw == null) return null;
    const v = Number(raw);
    return Number.isFinite(v) && v > 0 ? v : null;
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
