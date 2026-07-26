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

import type { Occurrence } from "./recurrence";

/** Assign occurrences to lanes so no lane holds two occurrences on the same
 *  date. Walks the input in order, placing each occurrence in the first lane
 *  with nothing on that date yet; opens a new lane when none qualifies. */
export function packOccurrenceLanes(occurrences: readonly Occurrence[]): Occurrence[][] {
  const lanes: Occurrence[][] = [];
  // One Set of taken dates per lane, kept in lockstep with `lanes` — an O(1)
  // membership check per lane instead of re-scanning each lane's contents.
  const takenDates: Set<string>[] = [];
  for (const occ of occurrences) {
    let placed = false;
    for (let i = 0; i < lanes.length; i++) {
      if (takenDates[i].has(occ.date)) continue;
      lanes[i].push(occ);
      takenDates[i].add(occ.date);
      placed = true;
      break;
    }
    if (!placed) {
      lanes.push([occ]);
      takenDates.push(new Set([occ.date]));
    }
  }
  return lanes;
}
