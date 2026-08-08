import { describe, expect, test } from "vitest";
import fc from "fast-check";
import {
  ALL_GANTT_STATUSES,
  clampNameColWidth,
  DEFAULT_PREFS,
  diffDays,
  GANTT_MILESTONE_PLACEMENTS,
  GANTT_NAME_COL_MAX,
  GANTT_NAME_COL_MIN,
  GANTT_PREFS_VERSION,
  GANTT_STATUS_VALUES,
  LEFT_GUTTER_PX,
  loadPrefs,
  milestoneSlipDays,
  parseISO,
  savePrefs,
  toISODay,
  type GanttPrefs,
  type GanttSort,
} from "./gantt-engine";
import { PRIORITIES } from "./types";

// The environment is jsdom (vitest.config.ts sets it globally), so
// `window.localStorage` exists here — the prefs properties below need it. No
// per-file docblock is required, matching gantt-engine.test.ts.

const PREFS_KEY = "aipm-cockpit:gantt-prefs";
const DAY_MS = 86_400_000;

// ★ NEVER `fc.date()` — it can emit an Invalid Date whose `.toISOString()`
// throws (repo-standard gotcha, AGENTS.md). Map an integer ms range instead,
// floored to a UTC day boundary. `Math.floor` (not `%`) because the range is
// deliberately pre-epoch at the low end, where `%` yields a negative remainder.
const floorToDay = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS;

const MIN_MS = Date.UTC(1900, 0, 1);
const MAX_MS = Date.UTC(2100, 0, 1);

/** A UTC-midnight Date — the only shape this engine ever produces internally,
 *  since every date it handles comes out of `parseISO`. */
const utcDayArb = fc
  .integer({ min: MIN_MS, max: MAX_MS })
  .map((ms) => new Date(floorToDay(ms)));

/** An arbitrary instant, deliberately NOT day-aligned. */
const instantArb = fc.integer({ min: MIN_MS, max: MAX_MS }).map((ms) => new Date(ms));

const isoDayArb = utcDayArb.map((d) => toISODay(d));

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** ISO-SHAPED but frequently invalid — "2020-13-45", "0000-00-00" and friends.
 *  Junk that merely *looks* like a date is the input class a naive parser
 *  turns into an Invalid Date rather than a null. */
const isoShapedJunkArb = fc
  .tuple(
    fc.integer({ min: 0, max: 9999 }),
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
  )
  .map(([y, m, d]) => `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`);

describe("gantt-engine — date properties", () => {
  test("toISODay → parseISO round-trips to the same UTC day", () => {
    fc.assert(
      fc.property(utcDayArb, (day) => {
        const iso = toISODay(day);
        const back = parseISO(iso);
        expect(back).not.toBeNull();
        // Same instant, and the string form is a fixed point of the round trip.
        expect(back!.getTime()).toBe(day.getTime());
        expect(toISODay(back!)).toBe(iso);
      }),
      { numRuns: 30 },
    );
  });

  test("parseISO reads a non-aligned instant as its UTC day, not the host day", () => {
    // ★ The timezone trap. `toISODay` is all-UTC, so parseISO must land on the
    //   UTC calendar day of the instant regardless of the runner's zone. The
    //   oracle is arithmetic on the epoch (floor to a day boundary), never
    //   another Date-API call that could share the same bug.
    fc.assert(
      fc.property(instantArb, (instant) => {
        const parsed = parseISO(instant.toISOString());
        expect(parsed).not.toBeNull();
        expect(parsed!.getTime()).toBe(floorToDay(instant.getTime()));
      }),
      { numRuns: 30 },
    );
  });

  test("parseISO is total: null or a UTC-midnight Date, never an Invalid Date", () => {
    const inputArb = fc.oneof(
      fc.string(),
      isoShapedJunkArb,
      isoDayArb,
      fc.constantFrom<string | undefined | null>("", undefined, null),
    );
    fc.assert(
      fc.property(inputArb, (input) => {
        // Any throw here fails the property — totality is asserted by calling.
        const out = parseISO(input);
        if (out === null) return;
        expect(Number.isFinite(out.getTime())).toBe(true);
        // Normalized to the start of a UTC day. Written as a subtraction, not
        // `% DAY_MS`: a PRE-EPOCH multiple gives `-0`, and `toBe` is Object.is,
        // so the modulo form fails on "1969-12-31" for a date that is in fact
        // perfectly aligned. `x - x` is always `+0`.
        expect(out.getTime() - floorToDay(out.getTime())).toBe(0);
      }),
      { numRuns: 30 },
    );
  });

  test("diffDays is exactly antisymmetric on day-aligned dates", () => {
    fc.assert(
      fc.property(utcDayArb, utcDayArb, (a, b) => {
        // Stated as a sum rather than `toBe(-diffDays(b, a))`: for two equal
        // dates the negation is `-0` and `toBe` is Object.is, which rejects it
        // against `+0`. The sum form is the same claim without the -0 hazard
        // (`0 + -0` is `+0`), and it reports the actual drift on failure.
        expect(diffDays(a, b) + diffDays(b, a)).toBe(0);
      }),
      { numRuns: 30 },
    );
  });

  test("diffDays on NON-aligned instants sums to 0 or 1, never less", () => {
    // ★ Antisymmetry is NOT universal, and this pins why the property above is
    //   scoped to day-aligned dates rather than being weaker than it looks.
    //   `diffDays` is `Math.round`, which breaks ties AWAY from -Infinity:
    //   round(0.5) === 1 but round(-0.5) === -0, so an exact half-day gap gives
    //   diffDays(a,b) + diffDays(b,a) === 1. Every date this engine handles
    //   comes from `parseISO` and is therefore midnight-aligned, so the exact
    //   form holds in production; this records the boundary rather than
    //   claiming it never exists.
    fc.assert(
      fc.property(instantArb, instantArb, (a, b) => {
        const sum = diffDays(a, b) + diffDays(b, a);
        expect([0, 1]).toContain(sum);
      }),
      { numRuns: 30 },
    );
  });

  test("diffDays is zero iff same day, and additive through any intermediate", () => {
    fc.assert(
      fc.property(utcDayArb, utcDayArb, utcDayArb, (a, b, c) => {
        // Zero exactly when the two dates name the same calendar day.
        expect(diffDays(a, b) === 0).toBe(toISODay(a) === toISODay(b));
        // Additivity: a → b → c must cost the same as a → c.
        expect(diffDays(a, c)).toBe(diffDays(a, b) + diffDays(b, c));
      }),
      { numRuns: 30 },
    );
  });

  test("milestoneSlipDays: sign convention, antisymmetry, null for junk", () => {
    fc.assert(
      fc.property(isoDayArb, isoDayArb, (baseline, live) => {
        const slip = milestoneSlipDays(baseline, live);
        expect(slip).not.toBeNull();
        expect(Number.isNaN(slip as number)).toBe(false);
        // Positive = slipped later. ISO day strings sort lexicographically the
        // same way they sort chronologically, so the string comparison is an
        // independent oracle for the sign.
        if (live > baseline) expect(slip!).toBeGreaterThan(0);
        else if (live < baseline) expect(slip!).toBeLessThan(0);
        else expect(slip!).toBe(0);
        // Swapping the arguments negates the slip — sum form, for the `-0`
        // reason spelled out on the diffDays antisymmetry property.
        expect(milestoneSlipDays(live, baseline)! + slip!).toBe(0);
      }),
      { numRuns: 30 },
    );
  });

  test("milestoneSlipDays returns null (never NaN) when either side is unparseable", () => {
    const junkArb = fc
      .oneof(fc.string(), isoShapedJunkArb)
      .filter((s) => parseISO(s) === null);
    fc.assert(
      fc.property(junkArb, isoDayArb, fc.boolean(), (junk, good, junkFirst) => {
        const out = junkFirst
          ? milestoneSlipDays(junk, good)
          : milestoneSlipDays(good, junk);
        expect(out).toBeNull();
      }),
      { numRuns: 30 },
    );
  });
});

describe("gantt-engine — clampNameColWidth properties", () => {
  test("always lands in [MIN, MAX] as an integer, for ANY double incl. non-finite", () => {
    const widthArb = fc.oneof(
      fc.double(),
      fc.double({ min: -1e9, max: 1e9, noNaN: true }),
      fc.integer({ min: -10_000, max: 10_000 }),
      fc.constantFrom(
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        GANTT_NAME_COL_MIN,
        GANTT_NAME_COL_MAX,
      ),
    );
    fc.assert(
      fc.property(widthArb, (w) => {
        const out = clampNameColWidth(w);
        expect(Number.isInteger(out)).toBe(true);
        expect(out).toBeGreaterThanOrEqual(GANTT_NAME_COL_MIN);
        expect(out).toBeLessThanOrEqual(GANTT_NAME_COL_MAX);
        // Idempotent: re-clamping a clamped width is a no-op. This holds for
        // the non-finite inputs too, because the LEFT_GUTTER_PX fallback is
        // itself inside the range — pinned here so a future default outside
        // the bounds fails loudly rather than silently double-clamping.
        expect(clampNameColWidth(out)).toBe(out);
      }),
      { numRuns: 30 },
    );
  });

  test("the non-finite fallback is the runtime default, and it is in range", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
        (w) => {
          expect(clampNameColWidth(w)).toBe(LEFT_GUTTER_PX);
        },
      ),
      { numRuns: 30 },
    );
    expect(LEFT_GUTTER_PX).toBeGreaterThanOrEqual(GANTT_NAME_COL_MIN);
    expect(LEFT_GUTTER_PX).toBeLessThanOrEqual(GANTT_NAME_COL_MAX);
  });
});

// ---------------------------------------------------------------------------
// Prefs. Every property clears localStorage at the TOP OF EACH RUN, not in a
// `beforeEach` — a beforeEach fires once per test, so without this the runs of
// one property leak into each other and the suite depends on iteration order.
// The same clearing makes the file safe under `npm run test:shuffle`.
//
// ★ Nothing below ever MUTATES a `loadPrefs()` result: it returns DEFAULT_PREFS
//   BY REFERENCE on its SSR / no-blob / non-object / catch paths, so a push into
//   the returned `statuses` would corrupt the module default for every later
//   test in the run.
// ---------------------------------------------------------------------------

const statusesArb = fc.subarray([...GANTT_STATUS_VALUES]);

const prefsArb: fc.Arbitrary<GanttPrefs> = fc.record({
  sort: fc.constantFrom<GanttSort>("auto", "due", "name", "priority", "custom"),
  search: fc.string(),
  statuses: statusesArb,
  priorities: fc.subarray([...PRIORITIES]),
  // parseAssigneeFilters drops blanks and de-dupes, so only distinct non-blank
  // names survive a round trip — generate exactly that set.
  assignees: fc.uniqueArray(
    fc.string().filter((s) => s.trim() !== ""),
    { maxLength: 4 },
  ),
  // `customOrder` keeps only `typeof === "number"` entries; NaN would serialize
  // to JSON `null` and be dropped, so integers are the round-trippable domain.
  customOrder: fc.array(fc.integer(), { maxLength: 6 }),
  showCriticalPath: fc.boolean(),
  showBaseline: fc.boolean(),
  milestonePlacement: fc.constantFrom(...GANTT_MILESTONE_PLACEMENTS),
  showHolidays: fc.boolean(),
  showAbsences: fc.boolean(),
  showDependencies: fc.boolean(),
  showMilestones: fc.boolean(),
  showGrid: fc.boolean(),
});

describe("gantt-engine — prefs properties", () => {
  test("savePrefs → loadPrefs round-trips every field, including an emptied status filter", () => {
    fc.assert(
      fc.property(prefsArb, (prefs) => {
        window.localStorage.clear();
        savePrefs(prefs);
        expect(loadPrefs()).toEqual(prefs);
      }),
      { numRuns: 30 },
    );
  });

  test("the v1→v2 status migration fires ONLY for a non-v2 blob with an empty filter", () => {
    // ★ THE LANDMINE. Under v2, `statuses: []` means "show nothing"; pre-v2 it
    //   meant "show everything". Conflating the two either opens every existing
    //   user's chart empty (migration missing) or makes "show nothing"
    //   unreachable (migration unconditional).
    const nonV2VersionArb = fc.oneof(
      fc.constant(undefined), // key absent entirely — the original v1 shape
      fc.integer({ min: -5, max: 10 }).filter((n) => n !== GANTT_PREFS_VERSION),
      fc.constant(String(GANTT_PREFS_VERSION)), // "2" — strict-equality miss
    );
    fc.assert(
      fc.property(statusesArb, nonV2VersionArb, (statuses, v) => {
        window.localStorage.clear();
        window.localStorage.setItem(
          PREFS_KEY,
          JSON.stringify({ sort: "auto", statuses, ...(v === undefined ? {} : { v }) }),
        );
        const legacy = loadPrefs().statuses;
        if (statuses.length === 0) {
          expect([...legacy].sort()).toEqual([...ALL_GANTT_STATUSES].sort());
        } else {
          expect(legacy).toEqual(statuses);
        }

        // The SAME list under a v2 stamp is taken at face value — an empty one
        // stays empty.
        window.localStorage.clear();
        window.localStorage.setItem(
          PREFS_KEY,
          JSON.stringify({ sort: "auto", statuses, v: GANTT_PREFS_VERSION }),
        );
        expect(loadPrefs().statuses).toEqual(statuses);
      }),
      { numRuns: 30 },
    );
  });

  test("an untouched project never reads as status-filtered", () => {
    // ★ The corollary that shipped a regression: "is a filter active" must be
    //   `statuses.length < ALL_GANTT_STATUSES.length`, NEVER `> 0`. Asserted
    //   across the no-blob path, the v1-empty path and a fresh save, all three
    //   of which mean "everything ticked".
    const seedArb = fc.constantFrom<"none" | "legacy-empty" | "saved-default">(
      "none",
      "legacy-empty",
      "saved-default",
    );
    fc.assert(
      fc.property(seedArb, (seed) => {
        window.localStorage.clear();
        if (seed === "legacy-empty") {
          window.localStorage.setItem(PREFS_KEY, JSON.stringify({ statuses: [] }));
        } else if (seed === "saved-default") {
          savePrefs({ ...DEFAULT_PREFS, statuses: [...ALL_GANTT_STATUSES] });
        }
        const { statuses } = loadPrefs();
        expect(statuses.length).toBe(ALL_GANTT_STATUSES.length);
        expect(statuses.length < ALL_GANTT_STATUSES.length).toBe(false);
      }),
      { numRuns: 30 },
    );
  });

  test("loadPrefs never throws and always yields a well-formed prefs for ANY stored blob", () => {
    const blobArb = fc.oneof(
      fc.string(),
      fc.json(),
      // Plain objects with hostile field types — every branch of the parser
      // reads a `parsed.<key>` that a corrupt blob can supply as anything.
      fc
        .record(
          {
            v: fc.anything(),
            sort: fc.anything(),
            search: fc.anything(),
            statuses: fc.anything(),
            priorities: fc.anything(),
            assignees: fc.anything(),
            customOrder: fc.anything(),
            showGrid: fc.anything(),
            milestonePlacement: fc.anything(),
          },
          { requiredKeys: [] },
        )
        .map((o) => JSON.stringify(o)),
    );
    fc.assert(
      fc.property(blobArb, (blob) => {
        window.localStorage.clear();
        window.localStorage.setItem(PREFS_KEY, blob);
        const p = loadPrefs();
        // Never mutate `p` — it may BE the module-level DEFAULT_PREFS.
        expect(typeof p.search).toBe("string");
        expect(Array.isArray(p.statuses)).toBe(true);
        for (const s of p.statuses) expect(ALL_GANTT_STATUSES).toContain(s);
        expect(new Set(p.statuses).size).toBe(p.statuses.length);
        for (const pr of p.priorities) expect(PRIORITIES).toContain(pr);
        for (const a of p.assignees) expect(typeof a).toBe("string");
        for (const n of p.customOrder) expect(typeof n).toBe("number");
        expect(GANTT_MILESTONE_PLACEMENTS).toContain(p.milestonePlacement);
        expect(typeof p.showGrid).toBe("boolean");
        expect(typeof p.showCriticalPath).toBe("boolean");
      }),
      { numRuns: 30 },
    );
  });
});
