import { describe, it, expect } from "vitest";
import { recurrenceText } from "./calendar-recurrence-text";
import { sanitizeCalendarEvent } from "./calendar-event";

describe("recurrenceText", () => {
  it("describes a plain daily rule", () => {
    expect(recurrenceText({ freq: "daily", interval: 1 })).toBe("Every day");
  });

  it("uses the interval when it is not 1", () => {
    expect(recurrenceText({ freq: "daily", interval: 3 })).toBe("Every 3 days");
  });

  it("names the weekdays of a weekly rule", () => {
    expect(recurrenceText({ freq: "weekly", interval: 1, byDay: ["MO", "WE"] })).toBe(
      "Every week on MO, WE",
    );
  });

  it("describes a monthly rule by day of month", () => {
    expect(recurrenceText({ freq: "monthly", interval: 2, byMonthDay: 15 })).toBe(
      "Every 2 months on day 15",
    );
  });

  it("describes a monthly rule by ordinal weekday", () => {
    expect(
      recurrenceText({ freq: "monthly", interval: 1, byDay: { ordinal: -1, day: "FR" } }),
    ).toBe("Every month on the last FR");
  });

  // ★ Needs a `startDate` now: `until` is validated against it (C2), so a call
  // with no startDate is genuinely ambiguous and OMITS the clause (see the
  // "omit, don't guess" tests below) rather than printing it unconditionally
  // as the pre-fix code did. `startDate` here precedes the until date, so the
  // range check passes and this is the "as before" case.
  it("appends an until date", () => {
    expect(
      recurrenceText({ freq: "daily", interval: 1, until: "2026-12-01" }, "2026-01-01"),
    ).toBe("Every day until 2026-12-01");
  });

  it("appends an occurrence count", () => {
    expect(recurrenceText({ freq: "daily", interval: 1, count: 10 })).toBe(
      "Every day, 10 times",
    );
  });

  // ★★ THE NEGATIVE CONTROL. This function is fed by a MODEL patch, so it will
  // meet shapes the type says are impossible. Returning "" for those is what
  // lets the descriptor fall back to its own empty rendering instead of
  // printing "undefined" onto the review card.
  it("returns an empty string for anything that is not a rule", () => {
    expect(recurrenceText(null)).toBe("");
    expect(recurrenceText(undefined)).toBe("");
    expect(recurrenceText({ freq: "hourly", interval: 1 } as never)).toBe("");
    expect(recurrenceText({ interval: 2 } as never)).toBe("");
    // I2: a freq that collides with an Object.prototype member must not walk
    // the prototype chain and pass as a "valid" freq — `in` would accept it
    // and then crash destructuring FREQ_UNIT["toString"] as [one, many].
    expect(recurrenceText({ freq: "toString", interval: 1 } as never)).toBe("");
    expect(recurrenceText({ freq: "constructor", interval: 1 } as never)).toBe("");
  });

  // ★★★ PREVIEW⟺WRITE PARITY. `sanitizeRecurrence` (calendar-event.ts) runs
  // `interval` through `intInRange(r.interval, 1, 52, 1)`: only an integer in
  // 1..52 survives, everything else is clamped to 1. A model patch is
  // pre-sanitize, so this projection must clamp identically or the review
  // card can show a value the write will not actually store.
  it("clamps a non-integer interval to 1, same as the write path", () => {
    expect(recurrenceText({ freq: "daily", interval: 0.5 })).toBe("Every day");
  });

  it("clamps an interval over 52 to 1, same as the write path", () => {
    expect(recurrenceText({ freq: "daily", interval: 60 })).toBe("Every day");
  });

  it("clamps a fractional interval over 1 to 1, same as the write path", () => {
    expect(recurrenceText({ freq: "daily", interval: 2.5 })).toBe("Every day");
  });

  it("accepts 52 as the top of the valid interval range", () => {
    expect(recurrenceText({ freq: "weekly", interval: 52 })).toBe("Every 52 weeks");
  });

  it("clamps 53 (one past the valid range) to 1", () => {
    expect(recurrenceText({ freq: "weekly", interval: 53 })).toBe("Every week");
  });

  // I1: `intInRange` coerces via `toNumber`, which accepts strings and
  // booleans — a model emitting a quoted number is not exotic, and the old
  // `typeof === "number"` gate rejected it outright (silently clamping to 1
  // while the write stored the real value).
  it("accepts a string-typed interval, same coercion as the write path", () => {
    expect(recurrenceText({ freq: "daily", interval: "3" })).toBe("Every 3 days");
  });

  // ★★★ OMIT, DON'T GUESS (byMonthDay). Out of range, the write stores a day
  // derived from the event's startDate (`intInRange(r.byMonthDay, 1, 31,
  // fallbackDom)` in calendar-event.ts's sanitizeRecurrence) — a value this
  // module has no way to see without the caller passing `startDate`.
  // Printing a guessed day would be a false claim about the write; omitting
  // the clause is a true but incomplete one, and that is the safe direction.
  // The "recurrence" field itself still shows on the card either way — only
  // the day-of-month clause is dropped. DO NOT "complete" this with a guessed
  // fallback day.
  it("omits the day clause for a byMonthDay over the valid range (no startDate)", () => {
    expect(recurrenceText({ freq: "monthly", interval: 1, byMonthDay: 99 })).toBe("Every month");
  });

  it("omits the day clause for a byMonthDay of 0 (no startDate)", () => {
    expect(recurrenceText({ freq: "monthly", interval: 1, byMonthDay: 0 })).toBe("Every month");
  });

  it("omits the day clause for a non-integer byMonthDay (no startDate)", () => {
    expect(recurrenceText({ freq: "monthly", interval: 1, byMonthDay: 15.5 })).toBe("Every month");
  });

  // With `startDate` supplied, the fallback becomes exactly computable — same
  // formula as `sanitizeRecurrence`'s `fallbackDom`.
  it("resolves the byMonthDay fallback exactly when startDate is given", () => {
    expect(
      recurrenceText({ freq: "monthly", interval: 1, byMonthDay: 99 }, "2026-01-15"),
    ).toBe("Every month on day 15");
  });

  // C1: byDay wins over byMonthDay — mirrors sanitizeRecurrence's own comment
  // on this precedence. The old code checked byMonthDay FIRST, so a
  // co-present valid ordinal-weekday was never reached; the write stores the
  // ordinal rule and drops byMonthDay entirely.
  it("prefers a valid ordinal weekday over a co-present byMonthDay", () => {
    expect(
      recurrenceText({
        freq: "monthly",
        interval: 1,
        byMonthDay: 15,
        byDay: { ordinal: 2, day: "TU" },
      }),
    ).toBe("Every month on the 2 TU");
  });

  // C4: an invalid ordinal or a non-weekday `day` rejects the WHOLE byDay
  // shape (never partially honoured), falling through to byMonthDay exactly
  // as sanitizeRecurrence does.
  it("falls back to byMonthDay when the ordinal is out of the valid set", () => {
    expect(
      recurrenceText({
        freq: "monthly",
        interval: 1,
        byDay: { ordinal: 7, day: "MO" },
        byMonthDay: 20,
      }),
    ).toBe("Every month on day 20");
  });

  it("falls back to byMonthDay when the weekday is not real", () => {
    expect(
      recurrenceText({
        freq: "monthly",
        interval: 1,
        byDay: { ordinal: 1, day: "ZZ" },
        byMonthDay: 5,
      }),
    ).toBe("Every month on day 5");
  });

  // C5: the weekly byDay list is filtered to real weekdays, DEDUPED, and
  // reordered into canonical MO..SU order — exactly what
  // `WEEKDAYS.filter((d) => raw.some(...))` produces. Echoing the raw array's
  // order/duplicates/invalid entries would describe a series the write does
  // not produce.
  it("filters, dedupes and canonically orders a weekly byDay list", () => {
    expect(
      recurrenceText({ freq: "weekly", interval: 1, byDay: ["XX", "WE", "MO", "MO"] }),
    ).toBe("Every week on MO, WE");
  });

  // C3: count is clamped to an integer 1..500, count's own exact twin of the
  // interval fix — the same class we already fixed once and left here.
  it("drops a count over the valid range instead of overstating it", () => {
    expect(recurrenceText({ freq: "daily", interval: 1, count: 1000 })).toBe("Every day");
  });

  // C2: a rejected `until` (out of range against startDate) lets `count`
  // survive — mirrors sanitizeRecurrence's "at most one range terminator"
  // rule exactly, including which one wins.
  it("falls back to count when until is before startDate", () => {
    expect(
      recurrenceText(
        { freq: "daily", interval: 1, until: "2020-01-01", count: 5 },
        "2026-01-01",
      ),
    ).toBe("Every day, 5 times");
  });

  it("prefers a valid until at or after startDate over a co-present count", () => {
    expect(
      recurrenceText(
        { freq: "daily", interval: 1, until: "2026-12-01", count: 5 },
        "2026-01-01",
      ),
    ).toBe("Every day until 2026-12-01");
  });

  // The date-FORMAT half of the until check needs no startDate: a
  // syntactically bad until is known-rejected either way.
  it("falls back to count when until is not a parseable ISO date", () => {
    expect(
      recurrenceText({ freq: "daily", interval: 1, until: "not-a-date", count: 7 }),
    ).toBe("Every day, 7 times");
  });

  // ★★★ OMIT, DON'T GUESS (until/count precedence). A syntactically valid
  // `until` with NO startDate is genuinely ambiguous — it might survive the
  // write, might not — so the entire range clause is dropped rather than
  // guessing which of until/count would win.
  it("omits the whole range clause for an ambiguous until with no startDate", () => {
    expect(
      recurrenceText({ freq: "daily", interval: 1, until: "2026-12-01", count: 5 }),
    ).toBe("Every day");
  });
});

// ★★★ THE FIX THAT MATTERS MOST. Composed against the REAL, exported
// `sanitizeCalendarEvent` (calendar-event.ts:138) rather than a second
// hand-copy of the sanitizer's rules — a differential built on a hand-copy
// would excuse exactly the class of defect this file exists to catch, since
// the hand-copy and the projection could drift together. `startDate` is
// passed identically on both sides: the LHS is what the review card would
// show once Task 8 wires `startDate` through; the RHS is what
// `recurrenceText` renders for the value the write path ACTUALLY stored.
describe("recurrenceText matches sanitizeCalendarEvent (differential)", () => {
  const START_DATE = "2026-01-15"; // day-of-month 15, used by the byMonthDay-fallback cases

  function writtenRecurrenceText(raw: unknown, startDate: string): string {
    const event = sanitizeCalendarEvent({
      id: 1,
      title: "Standup",
      startDate,
      recurrence: raw,
    });
    return recurrenceText(event?.recurrence, startDate);
  }

  it("agrees on a plain daily rule", () => {
    const raw = { freq: "daily", interval: 5 };
    expect(recurrenceText(raw, START_DATE)).toBe(writtenRecurrenceText(raw, START_DATE));
  });

  it("agrees on a string-typed interval (I1)", () => {
    const raw = { freq: "daily", interval: "12" };
    expect(recurrenceText(raw, START_DATE)).toBe(writtenRecurrenceText(raw, START_DATE));
  });

  it("agrees on an out-of-range interval clamping to 1", () => {
    const raw = { freq: "daily", interval: 100 };
    expect(recurrenceText(raw, START_DATE)).toBe(writtenRecurrenceText(raw, START_DATE));
  });

  it("agrees on a weekly rule with an unsorted, invalid, duplicate-laden byDay (C5)", () => {
    const raw = { freq: "weekly", interval: 1, byDay: ["SU", "XX", "MO", "MO", "FR"] };
    expect(recurrenceText(raw, START_DATE)).toBe(writtenRecurrenceText(raw, START_DATE));
  });

  it("agrees on a weekly rule with an absent byDay", () => {
    const raw = { freq: "weekly", interval: 2 };
    expect(recurrenceText(raw, START_DATE)).toBe(writtenRecurrenceText(raw, START_DATE));
  });

  // ★★★ `byMonthDay: 20` MUST NOT equal START_DATE's day-of-month (15).
  // Measured, not assumed: at 15 this case stayed GREEN against the C1
  // precedence mutant (byMonthDay checked before byDay) because BOTH sides
  // land on "day 15" for different reasons — the mutant's byMonthDay-first
  // read sees 15 directly, while the correctly-sanitized RHS drops
  // byMonthDay (byDay won) and falls through to the startDate-derived
  // fallback, which is ALSO 15. That is a fixture collision, not the mutant
  // surviving on its merits — 1 failed/38 passed before this fix, 2
  // failed/37 passed after (both sums 39). Picking a value that cannot equal
  // the fallback is what makes this case load-bearing; "tidying" it back to
  // a number matching START_DATE's day silently unpins it again.
  it("agrees that a valid ordinal weekday wins over a co-present byMonthDay (C1)", () => {
    const raw = { freq: "monthly", interval: 1, byMonthDay: 20, byDay: { ordinal: 2, day: "TU" } };
    expect(recurrenceText(raw, START_DATE)).toBe(writtenRecurrenceText(raw, START_DATE));
  });

  it("agrees on an invalid ordinal falling back to a valid byMonthDay (C4)", () => {
    const raw = { freq: "monthly", interval: 1, byDay: { ordinal: 9, day: "MO" }, byMonthDay: 20 };
    expect(recurrenceText(raw, START_DATE)).toBe(writtenRecurrenceText(raw, START_DATE));
  });

  it("agrees on an invalid ordinal AND an invalid byMonthDay falling back to startDate", () => {
    const raw = { freq: "monthly", interval: 1, byDay: { ordinal: 9, day: "MO" }, byMonthDay: 999 };
    expect(recurrenceText(raw, START_DATE)).toBe(writtenRecurrenceText(raw, START_DATE));
  });

  it("agrees that a valid until at or after startDate wins over count", () => {
    const raw = { freq: "daily", interval: 1, until: "2026-12-01", count: 5 };
    expect(recurrenceText(raw, START_DATE)).toBe(writtenRecurrenceText(raw, START_DATE));
  });

  it("agrees that an until before startDate is rejected in favour of count (C2)", () => {
    const raw = { freq: "daily", interval: 1, until: "2020-01-01", count: 5 };
    expect(recurrenceText(raw, START_DATE)).toBe(writtenRecurrenceText(raw, START_DATE));
  });

  it("agrees that a count over the valid range is dropped (C3)", () => {
    const raw = { freq: "daily", interval: 1, count: 600 };
    expect(recurrenceText(raw, START_DATE)).toBe(writtenRecurrenceText(raw, START_DATE));
  });

  it("agrees that an unrecognized freq renders as nothing on both sides", () => {
    const raw = { freq: "hourly", interval: 1 };
    expect(recurrenceText(raw, START_DATE)).toBe(writtenRecurrenceText(raw, START_DATE));
  });

  // (I1) THE `Date.parse` LEG. Both sites here tested `ISO_DATE` alone, so a
  //  regex-SHAPED but unparseable date read as valid on this side and as
  //  rejected on the write's. Added to the DIFFERENTIAL rather than asserted
  //  against a literal string, because a literal is a second hand-copy of the
  //  very rule the hand-copy already got wrong — the point of this block.
  it("agrees that an unparseable until falls through to count", () => {
    const raw = { freq: "daily", interval: 1, until: "2026-13-01", count: 5 };
    expect(recurrenceText(raw, START_DATE)).toBe(writtenRecurrenceText(raw, START_DATE));
  });

  // MEASURED, NOT CHOSEN BY EYE: this case first used "2026-02-30", which
  //  PARSES — `Date.parse` on an ISO date-only string checks the FIELD RANGES
  //  (MM 01-12, DD 01-31) and rolls an out-of-month day over (Feb 30 -> Mar 2),
  //  so both sides agreed with or without the fix and the mutant left it green.
  //  A month field out of range is what the leg actually catches.
  it("agrees that an unparseable until with no count leaves no terminator", () => {
    const raw = { freq: "weekly", interval: 2, until: "2026-13-01" };
    expect(recurrenceText(raw, START_DATE)).toBe(writtenRecurrenceText(raw, START_DATE));
  });

  // §542: since the write refuses a day that overflows its MONTH, the card must
  //  too — "2026-04-31" PARSES (to May 1), so before §542 both sides printed it.
  //  Now the write drops it: the count survives here, and with no count the
  //  series has no terminator at all, which the card must not dress up as one.
  it("agrees that a month-overflowing until falls through to count (§542)", () => {
    const raw = { freq: "daily", interval: 1, until: "2026-04-31", count: 5 };
    expect(recurrenceText(raw, START_DATE)).toBe(writtenRecurrenceText(raw, START_DATE));
    expect(recurrenceText(raw, START_DATE)).toBe("Every day, 5 times"); // presence: not vacuously ""
  });
  it("agrees that a month-overflowing until with no count leaves no terminator (§542)", () => {
    const raw = { freq: "weekly", interval: 2, until: "2026-04-31" };
    expect(recurrenceText(raw, START_DATE)).toBe(writtenRecurrenceText(raw, START_DATE));
  });

  // The `fallbackDayOfMonth` half. An unparseable START makes the write reject
  // the whole event, so a day number derived from it is a guess about a write
  // that never happens — "omit, don't guess" is the rule this module states.
  it("omits the byMonthDay fallback when the startDate itself is unparseable", () => {
    const raw = { freq: "monthly", interval: 1, byMonthDay: 999 };
    expect(recurrenceText(raw, "2026-13-01")).toBe("Every month");
    // Anti-vacuity: with a REAL startDate the same rule still prints the day,
    // so the assertion above is about the parse leg and not about the branch
    // being dead.
    expect(recurrenceText(raw, "2026-07-08")).toBe("Every month on day 8");
  });
});
