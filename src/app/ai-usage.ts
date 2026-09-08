/** ★★ FOUR FIELDS. `cacheWrite` and `cacheRead` mirror Anthropic's
 *  `cache_creation_input_tokens` / `cache_read_input_tokens`; see `ApiUsage`.
 *  ★★★ EVERY READER MUST DEFAULT A MISSING FIELD TO 0 rather than trusting the
 *  shape. Buckets persisted before this change carry only `input`/`output`, and
 *  `undefined + n` is NaN — which does NOT throw, does NOT show up anywhere, and
 *  makes both `crossed80` and `crossed100` permanently false because every
 *  comparison against NaN is false. A silently disabled cap is the worst
 *  outcome available here, so the defaulting lives in ONE helper used by both
 *  functions below rather than being repeated at each call site. */
export type Usage = { input: number; output: number; cacheWrite: number; cacheRead: number };
export type UsageBuckets = Record<string, Usage>; // key: YYYY-MM-DD (local)

const EMPTY_USAGE: Usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };

/** Coerce anything read from storage (or an older build) into a complete Usage.
 *  A non-finite value becomes 0 for the same reason a missing one does. */
export function normalizeUsage(u: Partial<Usage> | undefined): Usage {
  const n = (v: number | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    input: n(u?.input),
    output: n(u?.output),
    cacheWrite: n(u?.cacheWrite),
    cacheRead: n(u?.cacheRead),
  };
}

/** Every billed token in one number — what the caps compare against. */
export function usageTotal(u: Usage): number {
  return u.input + u.output + u.cacheWrite + u.cacheRead;
}

const isoDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const mondayOf = (d: Date): Date => {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (r.getDay() + 6) % 7; // Mon=0
  r.setDate(r.getDate() - dow);
  return r;
};

export function addToBuckets(b: UsageBuckets, when: Date, u: Usage): UsageBuckets {
  const k = isoDate(when);
  const prev = normalizeUsage(b[k] ?? EMPTY_USAGE);
  const add = normalizeUsage(u);
  return {
    ...b,
    [k]: {
      input: prev.input + add.input,
      output: prev.output + add.output,
      cacheWrite: prev.cacheWrite + add.cacheWrite,
      cacheRead: prev.cacheRead + add.cacheRead,
    },
  };
}

export function weekToDate(b: UsageBuckets, now: Date): number {
  const start = mondayOf(now);
  let total = 0;
  for (const [k, u] of Object.entries(b)) {
    const d = new Date(`${k}T00:00:00`);
    if (d >= start && d <= now) total += usageTotal(normalizeUsage(u));
  }
  return total;
}

export function nextWeekReset(now: Date): Date {
  const start = mondayOf(now);
  const next = new Date(start);
  next.setDate(next.getDate() + 7);
  return next;
}
