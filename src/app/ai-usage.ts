export type Usage = { input: number; output: number };
export type UsageBuckets = Record<string, Usage>; // key: YYYY-MM-DD (local)

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
  const prev = b[k] ?? { input: 0, output: 0 };
  return { ...b, [k]: { input: prev.input + u.input, output: prev.output + u.output } };
}

export function weekToDate(b: UsageBuckets, now: Date): number {
  const start = mondayOf(now);
  let total = 0;
  for (const [k, u] of Object.entries(b)) {
    const d = new Date(`${k}T00:00:00`);
    if (d >= start && d <= now) total += u.input + u.output;
  }
  return total;
}

export function nextWeekReset(now: Date): Date {
  const start = mondayOf(now);
  const next = new Date(start);
  next.setDate(next.getDate() + 7);
  return next;
}
