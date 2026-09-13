// src/app/action-snooze.ts
//
// Per-action snooze store: actionId -> snoozed-until epoch ms. Feeds the
// next-actions engine's `dismissed` set so snoozed actions drop out of the
// queue until their timer expires. localStorage-backed, fully guarded.
import { readDeviceJson, writeDeviceJson } from "./device-store";

export const ACTION_SNOOZE_KEY = "aipm-cockpit:action-snooze";

function read(): Record<string, number> {
  const parsed = readDeviceJson<unknown>(ACTION_SNOOZE_KEY, null);
  return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
}

function write(map: Record<string, number>): void {
  writeDeviceJson(ACTION_SNOOZE_KEY, map);
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

/** Snooze a grouped row: the primary AND every other id in its ActionGroup.
 *  Snoozing the primary alone would let the row reappear at once with the next
 *  signal promoted. `snooze` is the caller's store writer (e.g. the
 *  `useActionSnooze` hook's), so this stays free of storage and React. */
export function snoozeGroupIds(
  snooze: (id: string, ms: number) => void,
  primaryId: string,
  ms: number,
  extraIds?: readonly string[],
): void {
  snooze(primaryId, ms);
  extraIds?.forEach((id) => snooze(id, ms));
}

/** The next upcoming expiry > now, or null. Used to schedule a re-render. */
export function nextSnoozeExpiry(now: number): number | null {
  const future = Object.values(read()).filter((v) => typeof v === "number" && v > now);
  return future.length ? Math.min(...future) : null;
}
