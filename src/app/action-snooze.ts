// src/app/action-snooze.ts
//
// Per-action snooze store: actionId -> snoozed-until epoch ms. Feeds the
// next-actions engine's `dismissed` set so snoozed actions drop out of the
// queue until their timer expires. localStorage-backed, fully guarded.
export const ACTION_SNOOZE_KEY = "aipm-cockpit:action-snooze";

function read(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ACTION_SNOOZE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function write(map: Record<string, number>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACTION_SNOOZE_KEY, JSON.stringify(map));
  } catch {
    /* quota / disabled - non-fatal */
  }
}

/** Snoozed action ids whose timer is still in the future. Prunes expired
 *  entries (persisting the pruned map). */
export function getSnoozedActionIds(now: number): Set<string> {
  const map = read();
  const live: Record<string, number> = {};
  let pruned = false;
  for (const [id, until] of Object.entries(map)) {
    if (typeof until === "number" && until > now) live[id] = until;
    else pruned = true;
  }
  if (pruned) write(live);
  return new Set(Object.keys(live));
}

export function snoozeAction(actionId: string, durationMs: number, now: number): void {
  const map = read();
  map[actionId] = now + durationMs;
  write(map);
}

export function clearActionSnooze(actionId: string): void {
  const map = read();
  if (actionId in map) {
    delete map[actionId];
    write(map);
  }
}

/** The next upcoming expiry > now, or null. Used to schedule a re-render. */
export function nextSnoozeExpiry(now: number): number | null {
  const future = Object.values(read()).filter((v) => typeof v === "number" && v > now);
  return future.length ? Math.min(...future) : null;
}
