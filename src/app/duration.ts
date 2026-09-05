/** Jira-style working-time basis. */
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 8;
const DAYS_PER_WEEK = 5;

const MIN_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR;
const MIN_PER_WEEK = DAYS_PER_WEEK * MIN_PER_DAY;
const UNIT_MIN: Record<string, number> = { w: MIN_PER_WEEK, d: MIN_PER_DAY, h: MINUTES_PER_HOUR, m: 1 };

/** Parse "2w 3d 4h 30m" → total minutes. Empty → null. Invalid → null. */
export function parseDuration(input: string): number | null {
  const s = (input ?? "").trim().toLowerCase();
  if (!s) return null;
  if (!/^(\d+\s*[wdhm]\s*)+$/.test(s)) return null;
  let total = 0;
  for (const m of s.matchAll(/(\d+)\s*([wdhm])/g)) {
    total += parseInt(m[1], 10) * UNIT_MIN[m[2]];
  }
  return total;
}

/** Format minutes → "2w 3d 4h"; omit zero units; 0 → "". */
export function formatDuration(minutes: number): string {
  if (!minutes || minutes <= 0) return "";
  let rem = Math.round(minutes);
  const parts: string[] = [];
  for (const [unit, size] of [["w", MIN_PER_WEEK], ["d", MIN_PER_DAY], ["h", MINUTES_PER_HOUR], ["m", 1]] as const) {
    const n = Math.floor(rem / size);
    if (n > 0) parts.push(`${n}${unit}`);
    rem -= n * size;
  }
  return parts.join(" ");
}

export interface EffortProgress {
  hasEstimate: boolean;
  pct: number;
  over: boolean;
}

/** Time-spent consumption of an estimate (both in minutes). pct is unclamped. */
export function effortProgress(estimateMin?: number, spentMin?: number): EffortProgress {
  const estimate = estimateMin ?? 0;
  const spent = spentMin ?? 0;
  if (estimate <= 0) return { hasEstimate: false, pct: 0, over: false };
  const pct = spent / estimate;
  return { hasEstimate: true, pct, over: pct > 1 };
}

/** Minutes still to do when the user has NOT pinned a remaining value.
 *
 *  Zero with no estimate: "no estimate" means nothing is known to remain, and
 *  returning the spent time instead would claim the task is exactly as far
 *  from done as the work already put into it. Floors at zero — negative
 *  remaining is not a state the UI can render or the user can act on. */
export function derivedRemaining(estimateMin?: number, spentMin?: number): number {
  if (!estimateMin) return 0;
  return Math.max(0, estimateMin - (spentMin ?? 0));
}
