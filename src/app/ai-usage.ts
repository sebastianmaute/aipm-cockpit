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

/** Billing weight per usage class, as a RATIO against the base input price
 *  rather than as money. Anthropic holds these ratios across its current
 *  models (Sonnet $3/$15, Haiku $1/$5, Opus $15/$75 — all 1:5 input:output;
 *  cache write 1.25x and cache read 0.1x everywhere), so a cost basis built on
 *  them needs NO price table and NO per-model branch, and cannot go stale when
 *  a published rate moves.
 *  ★★ IF A FUTURE MODEL BREAKS THE RATIO these stop being model-free and the
 *  basis has to become model-aware. That is the one thing that would make this
 *  design wrong; see the spec's closing section. */
export const USAGE_COST_WEIGHTS = {
  input: 1,
  cacheWrite: 1.25,
  cacheRead: 0.1,
  output: 5,
} as const;

/** What one recording costs, in units of base input tokens — the number the
 *  caps compare against.
 *
 *  ★★★ THIS REPLACES `usageTotal`, WHICH WAS DELETED RATHER THAN RE-BODIED.
 *  That function summed the four fields unweighted, so a cached turn (billed at
 *  a tenth) consumed exactly as much of a cap as a fresh one. A reader seeing
 *  the name `usageTotal` expects a plain sum, so leaving it callable would let
 *  the raw sum back into a cap comparison by accident; deleting the name makes
 *  that mistake unavailable instead of merely discouraged.
 *
 *  ★★ Normalises first, for the reason `normalizeUsage`'s own docstring gives:
 *  `undefined * weight` is NaN, every comparison against NaN is false, and a
 *  NaN total makes `crossed80`/`crossed100` permanently false — a silently
 *  disabled cap, the worst outcome available here. */
export function usageCostEquivalent(u: Partial<Usage> | undefined): number {
  const n = normalizeUsage(u);
  return (
    n.input * USAGE_COST_WEIGHTS.input +
    n.cacheWrite * USAGE_COST_WEIGHTS.cacheWrite +
    n.cacheRead * USAGE_COST_WEIGHTS.cacheRead +
    n.output * USAGE_COST_WEIGHTS.output
  );
}

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
    // `usageCostEquivalent` normalises internally, so the explicit
    // normalizeUsage call this replaced would have been redundant.
    if (d >= start && d <= now) total += usageCostEquivalent(u);
  }
  return total;
}

export function nextWeekReset(now: Date): Date {
  const start = mondayOf(now);
  const next = new Date(start);
  next.setDate(next.getDate() + 7);
  return next;
}
