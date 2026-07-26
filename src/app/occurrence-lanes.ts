// Greedy lane packing for the meetings band (R5 S5, Task 14). Pure,
// i18n-free, clock-free: one lane renders as one <tr> in the band; an
// occurrence occupies exactly one date cell, so two occurrences collide only
// when they fall on the same date — packing is date-only, independent of
// time-of-day.
//
// Input order decides lane priority (expandOccurrences already sorts by
// date, then time), but the packer itself makes no assumption about order —
// it checks EVERY occurrence already in a lane, not just the last one, so an
// out-of-order input still packs correctly.
//
// ★★ STABLE LANES: a plain "first available lane" greedy pack is
// order-dependent in a way that reshuffles a series' visible row for no
// reason a user can see. Example: a daily standup (eventId 1) normally sits
// alone in lane 0 across the visible window. Widen the window and an
// unrelated one-off meeting (eventId 2) lands on the SAME date as one of the
// standup's occurrences, sorting EARLIER by time — it takes lane 0 for that
// date, bumping that one standup occurrence to lane 1. Without a tiebreaker,
// every OTHER standup occurrence (no collision, lane 0 still free for them)
// stays in lane 0 — so the same series ends up split across two lanes,
// purely because of an unrelated meeting elsewhere. `preferredLane` fixes
// this: once a series' FIRST occurrence lands in a lane, every later
// occurrence of that SAME eventId tries that lane first, and a forced
// fallback (a genuine same-date collision) does NOT change the preference —
// one collision must not permanently drag the series to a different lane
// for every date after it.
import type { Occurrence } from "./recurrence";

/** Assign occurrences to lanes so no lane holds two occurrences on the same
 *  date. Walks the input in order; each occurrence prefers the lane its OWN
 *  series (eventId) last landed in, falling back to the first lane with
 *  nothing on that date when the preferred one is unavailable or the series
 *  is new. Opens a new lane only when no existing lane qualifies. */
export function packOccurrenceLanes(occurrences: readonly Occurrence[]): Occurrence[][] {
  const lanes: Occurrence[][] = [];
  // One Set of taken dates per lane, kept in lockstep with `lanes` — an O(1)
  // membership check per lane instead of re-scanning each lane's contents.
  const takenDates: Set<string>[] = [];
  // eventId -> the lane its first occurrence landed in. Set ONCE per series
  // and never overwritten — see the module doc comment for why a later
  // forced fallback must not shift the preference.
  const preferredLane = new Map<number, number>();

  for (const occ of occurrences) {
    const preferred = preferredLane.get(occ.eventId);
    let placedIndex = -1;

    if (preferred !== undefined && preferred < lanes.length && !takenDates[preferred].has(occ.date)) {
      placedIndex = preferred;
    } else {
      for (let i = 0; i < lanes.length; i++) {
        if (takenDates[i].has(occ.date)) continue;
        placedIndex = i;
        break;
      }
    }

    if (placedIndex === -1) {
      placedIndex = lanes.length;
      lanes.push([]);
      takenDates.push(new Set());
    }

    lanes[placedIndex].push(occ);
    takenDates[placedIndex].add(occ.date);
    if (preferred === undefined) preferredLane.set(occ.eventId, placedIndex);
  }
  return lanes;
}
