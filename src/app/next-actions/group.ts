// src/app/next-actions/group.ts
//
// Pure, i18n-free presentation layer over the flat scored action list. Collapses
// multiple signals on the SAME entity into one group so the surface renders one
// row per thing-you-act-on. `computeNextActions` stays flat — this is layered on
// top by the surface only; learning/notifications/AI keep the flat list.
import type { SuggestedAction, ActionTier } from "./types";

export interface ActionGroup {
  /** `${cta.view}:${cta.id}` when the primary opens an entity, `workload:${resourceId}`
   *  for an open-tasks-for primary; else the primary's own id (snooze-only actions
   *  never merge). */
  key: string;
  /** Highest-scoring action in the group. */
  primary: SuggestedAction;
  /** Remaining actions for this entity, score desc then id asc. */
  extra: readonly SuggestedAction[];
  /** = primary.score (max wins — entity shows at its most-urgent signal). */
  score: number;
  /** = primary.tier. */
  tier: ActionTier;
}

// Open-CTA keys use the `${view}:${id}` prefix, so action `id`s must NOT adopt
// that `view:id` shape — a snooze-only id like "raid:42" would otherwise collide
// with an open-CTA group key for RAID entity 42. `open-tasks-for` keys on the
// resource for the same reason; everything else falls back to the action's own id.
function groupKey(a: SuggestedAction): string {
  if (a.cta.kind === "open") return `${a.cta.view}:${a.cta.id}`;
  // Both workload signals for one resource keep the PRE-EXISTING `workload:<id>`
  // key so an overload + over-allocated pair still collapses into ONE row. A
  // fall-through to `a.id` here would silently split them.
  if (a.cta.kind === "open-tasks-for") return `workload:${a.cta.resourceId}`;
  return a.id;
}

/** Collapse a flat (already deduped + dismissed-filtered) action list into
 *  per-entity groups, sorted score desc then key asc. */
export function groupNextActions(actions: readonly SuggestedAction[]): ActionGroup[] {
  const byKey = new Map<string, SuggestedAction[]>();
  for (const a of actions) {
    const k = groupKey(a);
    const arr = byKey.get(k);
    if (arr) arr.push(a);
    else byKey.set(k, [a]);
  }
  const groups: ActionGroup[] = [];
  for (const [key, members] of byKey) {
    const sorted = [...members].sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
    const [primary, ...extra] = sorted;
    groups.push({ key, primary, extra, score: primary.score, tier: primary.tier });
  }
  return groups.sort((x, y) => y.score - x.score || x.key.localeCompare(y.key));
}
