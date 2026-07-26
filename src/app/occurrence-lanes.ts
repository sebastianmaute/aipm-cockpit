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
// ★★ STABLE LANES — PER CALL ONLY: a plain "first available lane" greedy
// pack is order-dependent in a way that fragments a series across lanes
// within a single occurrence set. Example: a daily standup (eventId 1) and
// an unrelated one-off meeting (eventId 2) both fall on day one, with the
// one-off sorting EARLIER by time — it takes lane 0 for that date, bumping
// that one standup occurrence to lane 1. Without a tiebreaker, every OTHER
// standup occurrence in the SAME call (no collision, lane 0 still free for
// them) would stay in lane 0 — so one series ends up split across two lanes
// within one render, purely because of an unrelated meeting on one date.
// `preferredLane` fixes exactly that: once a series' FIRST occurrence in
// THIS call lands in a lane, every later occurrence of that SAME eventId in
// THIS call tries that lane first, and a forced fallback (a genuine
// same-date collision) does NOT change the preference — one collision must
// not drag the rest of the series to a different lane for the rest of the
// call.
//
// ★★ WHAT THIS DOES NOT FIX: `preferredLane` is a local Map, built fresh on
// every call and discarded when it returns — it carries no memory ACROSS
// calls. The orchestrator (resource-calendar.tsx) recomputes `lanes` via a
// `useMemo` that reruns on every window change, i.e. a brand-new call with a
// brand-new Map each time. So a series can still land in a DIFFERENT lane
// than it had in the previous window — e.g. it sits alone in lane 0, the
// user navigates to a wider window where an earlier-sorting same-date
// meeting now exists, and it moves to lane 1 for that render. This module
// does not track "the lane this series usually prefers" durably; it only
// prevents fragmentation WITHIN one already-computed occurrence set. Closing
// the cross-window case would mean the CALLER owns and threads a preference
// map across renders (e.g. a `useRef` in the orchestrator) — this function
// would stay pure (no clock, no memory), but a sticky preference carried
// across windows can itself pin a series to a lane that's wrong for a later
// window, so that tradeoff hasn't been taken here; tracked as a follow-up.
import type { Occurrence } from "./recurrence";

/** Assign occurrences to lanes so no lane holds two occurrences on the same
 *  date. Walks the input in order; each occurrence prefers the lane its OWN
 *  series (eventId) last landed in DURING THIS CALL, falling back to the
 *  first lane with nothing on that date when the preferred one is
 *  unavailable or the series is new to this call. Opens a new lane only when
 *  no existing lane qualifies. The preference does NOT persist across calls
 *  — see the module doc comment. */
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
