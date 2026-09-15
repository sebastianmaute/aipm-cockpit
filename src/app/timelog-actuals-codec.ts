// src/app/timelog-actuals-codec.ts — pure, i18n-free AT-REST packing of the
// day-keyed TimeLog aggregate for the per-device actuals cache
// (`timelog-actuals-store.ts`). In memory every consumer keeps reading
// `ActualsAggregate.byBucketDay`; only the stored JSON changes shape.
import type { ActualsAggregate, ActualsByBucketDay, BucketPeriodCell, ResourceDayCell } from "./timelog-actuals";

/** Bumped only when the column layout changes. An entry carrying any other
 *  version is rejected by `isPackedBucketDays` and its cache entry dropped:
 *  that reads as "never fetched", which a re-fetch repairs. */
export const PACKED_DAYS_VERSION = 1 as const;

/** One bucket's day cells as parallel columns, days in ascending order.
 *  - `d`  day-index DELTA per day group (first is absolute; later ones > 0)
 *  - `n`  resource rows in that day group
 *  - `t`  / `tb` the day cell's `hours` / `billableHours` (`tb` omitted when
 *         every value equals `t`)
 *  - `r`  resource index into `PackedBucketDays.res`, one per resource row
 *  - `h`  / `hb` that resource's `hours` / `billableHours` (`hb` omitted when
 *         every value equals `h`)
 *  ★★ The day totals `t`/`tb` are stored even though they equal the sum of the
 *  resource rows: re-summing reproduces them only when every addend is an exact
 *  binary fraction, and a one-ULP drift would make the reloaded aggregate differ
 *  from the fetched one. Measured cost: ~10% of the packed size. */
export type PackedBucketColumns = {
  d: number[];
  n: number[];
  t: number[];
  tb?: number[];
  r: number[];
  h: number[];
  hb?: number[];
};

export type PackedBucketDays = {
  v: typeof PACKED_DAYS_VERSION;
  /** Every day key used by any bucket, ascending. Stored as STRINGS, never as
   *  offsets from a base date: `aggregateActuals` admits any `YYYY-MM-DD`-shaped
   *  key (`9999-99-99` included), and date arithmetic would silently rewrite a
   *  shape-valid non-date such as `2026-02-30`. */
  days: string[];
  /** Every resource id used by any bucket, ascending. */
  res: number[];
  /** bucketId → columns. */
  b: Record<string, PackedBucketColumns>;
};

/** An aggregate as it sits in localStorage: `byBucketDay` packed into
 *  `dayCells`. A legacy `byBucket` entry and a verbose `byBucketDay` entry from
 *  an earlier build are also valid stored aggregates. */
export type StoredAggregate = Omit<ActualsAggregate, "byBucketDay"> & {
  byBucketDay?: ActualsByBucketDay;
  dayCells?: PackedBucketDays;
};

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function allEqual(a: readonly number[], b: readonly number[]): boolean {
  return a.every((v, i) => v === b[i]);
}

export function packBucketDays(byBucketDay: ActualsByBucketDay): PackedBucketDays {
  const daySet = new Set<string>();
  const resSet = new Set<number>();
  for (const cells of Object.values(byBucketDay)) {
    for (const [day, cell] of Object.entries(cells)) {
      daySet.add(day);
      for (const rid of Object.keys(cell.byResource ?? {})) resSet.add(Number(rid));
    }
  }
  const days = [...daySet].sort();
  const res = [...resSet].sort((x, y) => x - y);
  const dayIndex = new Map(days.map((day, i) => [day, i] as const));
  const resIndex = new Map(res.map((id, i) => [id, i] as const));

  const b: Record<string, PackedBucketColumns> = {};
  for (const [bucketId, cells] of Object.entries(byBucketDay)) {
    const d: number[] = [];
    const n: number[] = [];
    const t: number[] = [];
    const tb: number[] = [];
    const r: number[] = [];
    const h: number[] = [];
    const hb: number[] = [];
    let prev = 0;
    for (const day of Object.keys(cells).sort()) {
      const cell = cells[day];
      const index = dayIndex.get(day) ?? 0;
      d.push(index - prev);
      prev = index;
      t.push(cell.hours);
      tb.push(cell.billableHours);
      const rows = Object.entries(cell.byResource ?? {});
      n.push(rows.length);
      for (const [rid, rc] of rows) {
        r.push(resIndex.get(Number(rid)) ?? 0);
        h.push(rc.hours);
        hb.push(rc.billableHours);
      }
    }
    const columns: PackedBucketColumns = { d, n, t, r, h };
    if (!allEqual(t, tb)) columns.tb = tb;
    if (!allEqual(h, hb)) columns.hb = hb;
    b[bucketId] = columns;
  }
  return { v: PACKED_DAYS_VERSION, days, res, b };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteColumn(v: unknown, length: number): v is number[] {
  return Array.isArray(v) && v.length === length && v.every((x) => typeof x === "number" && Number.isFinite(x));
}

function isIndexColumn(v: unknown, bound: number): v is number[] {
  return Array.isArray(v) && v.every((x) => Number.isInteger(x) && (x as number) >= 0 && (x as number) < bound);
}

function isColumns(v: unknown, dayCount: number, resCount: number): v is PackedBucketColumns {
  if (!isPlainObject(v)) return false;
  const { d, n, t, tb, r, h, hb } = v;
  if (!Array.isArray(d) || !Array.isArray(n) || d.length !== n.length) return false;
  // Day indices: absolute first, strictly increasing after, all inside `days`.
  let day = -1;
  for (let i = 0; i < d.length; i += 1) {
    const step = d[i];
    if (!Number.isInteger(step) || step < 0 || (i > 0 && step === 0)) return false;
    day = i === 0 ? step : day + step;
    if (day >= dayCount) return false;
  }
  if (!n.every((x) => Number.isInteger(x) && (x as number) >= 0)) return false;
  const rows = (n as number[]).reduce((s, x) => s + x, 0);
  if (!isFiniteColumn(t, d.length)) return false;
  if (tb !== undefined && !isFiniteColumn(tb, d.length)) return false;
  if (!Array.isArray(r) || r.length !== rows || !isIndexColumn(r, resCount)) return false;
  if (!isFiniteColumn(h, rows)) return false;
  if (hb !== undefined && !isFiniteColumn(hb, rows)) return false;
  return true;
}

/** Shape check for a stored `dayCells` payload. Everything `unpackBucketDays`
 *  indexes is bounds-checked here, so an admitted payload cannot throw or mint
 *  an `undefined` key. A rejected payload drops its cache entry, exactly like an
 *  `aggregates` field of the wrong type does. */
export function isPackedBucketDays(v: unknown): v is PackedBucketDays {
  if (!isPlainObject(v) || v.v !== PACKED_DAYS_VERSION) return false;
  const { days, res, b } = v;
  if (!Array.isArray(days) || !days.every((x) => typeof x === "string" && DAY_KEY_RE.test(x))) return false;
  if (!Array.isArray(res) || !res.every((x) => typeof x === "number" && Number.isFinite(x))) return false;
  if (!isPlainObject(b)) return false;
  return Object.values(b).every((columns) => isColumns(columns, days.length, res.length));
}

export function unpackBucketDays(packed: PackedBucketDays): ActualsByBucketDay {
  const out: ActualsByBucketDay = {};
  for (const [bucketId, col] of Object.entries(packed.b)) {
    const cells: Record<string, BucketPeriodCell> = {};
    let day = 0;
    let row = 0;
    for (let g = 0; g < col.d.length; g += 1) {
      day = g === 0 ? col.d[g] : day + col.d[g];
      const byResource: Record<number, ResourceDayCell> = {};
      for (let k = 0; k < col.n[g]; k += 1) {
        byResource[packed.res[col.r[row]]] = { hours: col.h[row], billableHours: col.hb ? col.hb[row] : col.h[row] };
        row += 1;
      }
      cells[packed.days[day]] = { hours: col.t[g], billableHours: col.tb ? col.tb[g] : col.t[g], byResource };
    }
    out[Number(bucketId)] = cells;
  }
  return out;
}

/** Pack on the way INTO storage. An aggregate without `byBucketDay` (a legacy
 *  period-keyed one, or one already packed) is returned BY IDENTITY. */
export function toStoredAggregate(agg: StoredAggregate): StoredAggregate {
  if (agg.byBucketDay === undefined) return agg;
  const { byBucketDay, ...rest } = agg;
  return { ...rest, dayCells: packBucketDays(byBucketDay) };
}

/** Unpack on the way OUT of storage. The caller must have validated
 *  `dayCells` with `isPackedBucketDays`. An aggregate without `dayCells` (legacy
 *  `byBucket`, or a verbose `byBucketDay` from an earlier build) is returned BY
 *  IDENTITY. */
export function fromStoredAggregate(agg: StoredAggregate): ActualsAggregate {
  if (agg.dayCells === undefined) return agg;
  const { dayCells, ...rest } = agg;
  return { ...rest, byBucketDay: unpackBucketDays(dayCells) };
}
