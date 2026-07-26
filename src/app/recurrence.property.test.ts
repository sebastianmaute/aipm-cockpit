import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { expandOccurrences, MAX_OCCURRENCES } from "./recurrence";
import { sanitizeCalendarEvent } from "./calendar-event";
import type { CalendarEvent } from "./calendar-event";

// fc.date() can emit an Invalid Date, and .toISOString() then throws — generate
// an integer ms range on a day boundary and map it instead (repo-standard
// gotcha; mirrors date-format.property.test.ts / AGENTS.md).
const DAY_MS = 86_400_000;
const isoDateArb = fc
  .integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2032, 0, 1) })
  .map((ms) => new Date(ms - (ms % DAY_MS)).toISOString().slice(0, 10));

const hhmmArb = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(([h, m]) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);

const weekdayArb = fc.constantFrom("MO", "TU", "WE", "TH", "FR", "SA", "SU");
const ordinalArb = fc.constantFrom(1 as const, 2 as const, 3 as const, 4 as const, -1 as const);

// One of {until, count, neither} — deliberately includes out-of-range interval
// and count values (negative, zero, huge) so the sanitizer's own clamping is
// exercised as a side effect of generating events this way.
const rangeTerminatorArb = fc.oneof(
  fc.record({ until: isoDateArb }),
  fc.record({ count: fc.integer({ min: -5, max: 600 }) }),
  fc.constant({}),
);

function withRange<T extends object>(base: fc.Arbitrary<T>) {
  return fc.tuple(base, rangeTerminatorArb).map(([b, r]) => ({ ...b, ...r }));
}

// Raw (pre-sanitize) recurrence rule shapes. Only sometimes present — a
// non-recurring event is a first-class case for this engine.
function recurrenceRawArb() {
  const daily = withRange(fc.record({
    freq: fc.constant("daily"),
    interval: fc.integer({ min: -5, max: 60 }),
  }));
  const weekly = withRange(fc.record({
    freq: fc.constant("weekly"),
    interval: fc.integer({ min: -5, max: 60 }),
    byDay: fc.option(fc.array(weekdayArb, { maxLength: 4 }), { nil: undefined }),
  }));
  const monthlyNth = withRange(fc.record({
    freq: fc.constant("monthly"),
    interval: fc.integer({ min: -5, max: 24 }),
    byDay: fc.record({ ordinal: ordinalArb, day: weekdayArb }),
  }));
  const monthlyDom = withRange(fc.record({
    freq: fc.constant("monthly"),
    interval: fc.integer({ min: -5, max: 24 }),
    byMonthDay: fc.integer({ min: -5, max: 40 }),
  }));
  return fc.option(fc.oneof(daily, weekly, monthlyNth, monthlyDom), { nil: undefined });
}

function exceptionsRawArb() {
  const skip = fc.record({ date: isoDateArb, kind: fc.constant("skip") });
  const move = fc.record({
    date: isoDateArb,
    kind: fc.constant("move"),
    toDate: isoDateArb,
    toTime: fc.option(hhmmArb, { nil: undefined }),
  });
  return fc.option(fc.array(fc.oneof(skip, move), { maxLength: 6 }), { nil: undefined });
}

const rawEventArb = fc.record({
  id: fc.integer({ min: 1, max: 100_000 }),
  title: fc.string({ minLength: 1, maxLength: 40 }),
  startDate: isoDateArb,
  startTime: hhmmArb,
  durationMinutes: fc.integer({ min: 1, max: 2000 }),
  recurrence: recurrenceRawArb(),
  exceptions: exceptionsRawArb(),
});

/** Only ever produce events the system can actually hold — run the raw shape
 *  through the real sanitizer (the entity/engine contract boundary) and drop
 *  anything it rejects, rather than hand-building a "valid CalendarEvent". */
function eventArb(): fc.Arbitrary<CalendarEvent> {
  return rawEventArb
    .map((raw) => sanitizeCalendarEvent(raw))
    .filter((e): e is CalendarEvent => e !== null);
}

// A dedicated arbitrary for the `count` property below — filtering a generic
// eventArb() on "has a count" inside the property body would waste most runs
// on events without one (recurrence itself is optional, and `until` beats
// `count` when both are supplied), so this constructs count-bearing events
// directly for run density.
function rawEventWithCountArb() {
  const freq = fc.oneof(
    fc.record({ freq: fc.constant("daily"), interval: fc.integer({ min: 1, max: 10 }) }),
    fc.record({
      freq: fc.constant("weekly"), interval: fc.integer({ min: 1, max: 10 }),
      byDay: fc.option(fc.array(weekdayArb, { minLength: 1, maxLength: 4 }), { nil: undefined }),
    }),
    fc.record({
      freq: fc.constant("monthly"), interval: fc.integer({ min: 1, max: 6 }),
      byMonthDay: fc.integer({ min: 1, max: 28 }),
    }),
  );
  return fc.record({
    id: fc.integer({ min: 1, max: 100_000 }),
    title: fc.string({ minLength: 1, maxLength: 40 }),
    startDate: isoDateArb,
    startTime: hhmmArb,
    durationMinutes: fc.integer({ min: 1, max: 2000 }),
    recurrence: fc.tuple(freq, fc.integer({ min: 1, max: 500 })).map(([f, count]) => ({ ...f, count })),
    exceptions: exceptionsRawArb(),
  });
}

function eventWithCountArb(): fc.Arbitrary<CalendarEvent & { recurrence: { count: number } }> {
  return rawEventWithCountArb()
    .map((raw) => sanitizeCalendarEvent(raw))
    .filter((e): e is CalendarEvent & { recurrence: { count: number } } =>
      e !== null && e.recurrence?.count !== undefined);
}

// Window pairs used by every property except the never-throws one: real ISO
// dates, normalized so start <= end (ISO yyyy-mm-dd strings compare
// lexicographically in date order, so plain string comparison is enough).
const validWindowArb = fc
  .tuple(isoDateArb, isoDateArb)
  .map(([a, b]): [string, string] => (a <= b ? [a, b] : [b, a]));

describe("expandOccurrences — properties", () => {
  test("never emits an occurrence before the series start", () => {
    fc.assert(
      fc.property(eventArb(), validWindowArb, (event, [ws, we]) => {
        const { occurrences } = expandOccurrences(event, ws, we);
        for (const o of occurrences) {
          expect(o.originalDate >= event.startDate).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  test("every unmoved occurrence falls inside the requested window (moved ones are exempt)", () => {
    fc.assert(
      fc.property(eventArb(), validWindowArb, (event, [ws, we]) => {
        const { occurrences } = expandOccurrences(event, ws, we);
        for (const o of occurrences) {
          if (o.isMoved) continue;
          expect(o.date >= ws && o.date <= we).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  test("is deterministic, and never returns more than MAX_OCCURRENCES", () => {
    fc.assert(
      fc.property(eventArb(), validWindowArb, (event, [ws, we]) => {
        const a = expandOccurrences(event, ws, we);
        const b = expandOccurrences(event, ws, we);
        expect(b).toEqual(a);
        expect(a.occurrences.length).toBeLessThanOrEqual(MAX_OCCURRENCES);
      }),
      { numRuns: 100 },
    );
  });

  // originalDates reflect the RULE's own generation, which is monotonic in
  // time by construction — but the final `occurrences` array is sorted by
  // DISPLAYED date/time, which a move can legitimately place out of
  // originalDate order (see recurrence.test.ts's reordering-on-move case).
  // So the true invariant here is "no rule-date is ever produced twice" —
  // checking strict array-order monotonicity on originalDate would be a
  // FALSE requirement once a move is present, not a stronger one.
  test("originalDates are unique — no rule-date is ever emitted twice", () => {
    fc.assert(
      fc.property(eventArb(), validWindowArb, (event, [ws, we]) => {
        const { occurrences } = expandOccurrences(event, ws, we);
        const originals = occurrences.map((o) => o.originalDate);
        expect(new Set(originals).size).toBe(originals.length);
      }),
      { numRuns: 100 },
    );
  });

  test("count is a hard upper bound on rule-produced occurrences (<=, not ==, because a skip doesn't refund a slot)", () => {
    fc.assert(
      fc.property(eventWithCountArb(), validWindowArb, (event, [ws, we]) => {
        const { occurrences } = expandOccurrences(event, ws, we);
        expect(occurrences.length).toBeLessThanOrEqual(event.recurrence.count);
      }),
      { numRuns: 100 },
    );
  });

  test("never throws for any generated event and any window pair, including malformed/inverted ones", () => {
    const junkOrIsoArb = fc.oneof(isoDateArb, fc.string({ maxLength: 20 }));
    fc.assert(
      fc.property(eventArb(), junkOrIsoArb, junkOrIsoArb, (event, a, b) => {
        expect(() => expandOccurrences(event, a, b)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });
});
