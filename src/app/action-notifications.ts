import type { SuggestedAction } from "./next-actions/types";

const URGENT_TIER = "now" as const;

/** now-tier actions whose id is not yet in the seen set. Order preserved. */
export function newUrgentActions(
  actions: readonly SuggestedAction[],
  seenIds: readonly string[],
): SuggestedAction[] {
  const seen = new Set(seenIds);
  return actions.filter((a) => a.tier === URGENT_TIER && !seen.has(a.id));
}

export type NotificationPlan =
  | { kind: "single"; action: SuggestedAction }
  | { kind: "summary"; count: number };

/** null when nothing new; single for exactly one; summary for more than one. */
export function buildNotificationPlan(
  newUrgent: readonly SuggestedAction[],
): NotificationPlan | null {
  if (newUrgent.length === 0) return null;
  if (newUrgent.length === 1) return { kind: "single", action: newUrgent[0] };
  return { kind: "summary", count: newUrgent.length };
}

/**
 * Next seen-id set = exactly the currently present-and-urgent ids (deduped).
 * An id enters "seen" only while present and urgent and drops out the moment it
 * is gone, so a cleared-then-returning signal is treated as new and re-notifies.
 */
export function nextSeenIds(actions: readonly SuggestedAction[]): string[] {
  const urgentIds = actions.filter((a) => a.tier === URGENT_TIER).map((a) => a.id);
  return [...new Set(urgentIds)];
}
